/**
 * enable-debug.js
 * Activa logging detallado en nginx y n8n para capturar el 403
 */
'use strict';
const { Client } = require('ssh2');
const fs = require('fs');

const SSH_USER = 'administrador';
const SSH_PASS = 'Temporal01#';

function runCmd(host, cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let out = '';
    conn.on('ready', () => {
      conn.exec(cmd, { pty: false }, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        stream.on('data', d => { process.stdout.write(d); out += d.toString(); });
        stream.stderr.on('data', d => { process.stdout.write(d); out += d.toString(); });
        stream.on('close', () => { conn.end(); resolve(out); });
      });
    });
    conn.on('error', reject);
    conn.connect({ host, port: 22, username: SSH_USER, password: SSH_PASS, readyTimeout: 30000, hostVerifier: () => true });
  });
}

// Nuevo nginx site config con log detallado
const nginxSiteConf = `server {
    listen 80;
    access_log /var/log/nginx/n8n_debug.log;
    error_log /var/log/nginx/n8n_error.log warn;
    location / {
        proxy_pass http://10.114.158.71:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port 80;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_hide_header X-Frame-Options;
        proxy_intercept_errors off;
    }
}`;

// Nuevo docker-compose para Main1 con LOG_LEVEL verbose
const dockerComposeMain1 = `services:
  n8n:
    image: n8nio/n8n:2.8.4
    container_name: n8n-main1
    restart: always
    network_mode: host
    environment:
      - N8N_HOST=0.0.0.0
      - N8N_PORT=5678
      - EXECUTIONS_MODE=queue
      - QUEUE_BULL_REDIS_HOST=10.114.158.75
      - QUEUE_BULL_REDIS_PORT=6379
      - DB_TYPE=postgresdb
      - DB_POSTGRESDB_HOST=10.114.158.77
      - DB_POSTGRESDB_PORT=5432
      - DB_POSTGRESDB_DATABASE=n8n_db
      - DB_POSTGRESDB_USER=n8n_user
      - DB_POSTGRESDB_PASSWORD=PostgresSQL
      - N8N_ENCRYPTION_KEY=main1VMn8nArtics
      - N8N_SECURE_COOKIE=false
      - N8N_EDITOR_BASE_URL=http://10.115.25.101
      - WEBHOOK_URL=http://10.115.25.101
      - N8N_PROXY_HOPS=1
      - N8N_LOG_LEVEL=verbose
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
    name: n8n_main1_data
`;

async function main() {
  // 1. Actualizar nginx site config
  console.log('\n=== [1/4] Subiendo nueva config de nginx ===');
  const tmpNginx = '/tmp/n8n_site_debug';
  // Solo necesitamos el path remoto, no escribir en local

  const connNginx = new Client();
  await new Promise((resolve, reject) => {
    connNginx.on('ready', () => {
      connNginx.sftp((err, sftp) => {
        if (err) { connNginx.end(); return reject(err); }
        sftp.writeFile(tmpNginx, Buffer.from(nginxSiteConf), { mode: 0o644 }, err2 => {
          connNginx.end();
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
    connNginx.on('error', reject);
    connNginx.connect({ host: '10.115.25.101', port: 22, username: SSH_USER, password: SSH_PASS, readyTimeout: 20000, hostVerifier: () => true });
  });
  console.log('  → Archivo subido a /tmp/n8n_site_debug');

  console.log('\n=== [2/4] Aplicando config nginx y recargando ===');
  await runCmd('10.115.25.101', [
    `echo '${SSH_PASS}' | sudo -S cp ${tmpNginx} /etc/nginx/sites-available/n8n`,
    `echo '${SSH_PASS}' | sudo -S nginx -t`,
    `echo '${SSH_PASS}' | sudo -S systemctl reload nginx`,
    `echo NGINX_RELOADED`,
  ].join(' && '));

  // 2. Actualizar docker-compose de Main1 con LOG_LEVEL verbose
  console.log('\n=== [3/4] Subiendo docker-compose Main1 con verbose logging ===');
  const connN8n = new Client();
  await new Promise((resolve, reject) => {
    connN8n.on('ready', () => {
      connN8n.sftp((err, sftp) => {
        if (err) { connN8n.end(); return reject(err); }
        sftp.writeFile('/tmp/n8n_main1_compose', Buffer.from(dockerComposeMain1), { mode: 0o644 }, err2 => {
          connN8n.end();
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
    connN8n.on('error', reject);
    connN8n.connect({ host: '10.114.158.71', port: 22, username: SSH_USER, password: SSH_PASS, readyTimeout: 20000, hostVerifier: () => true });
  });

  console.log('\n=== [4/4] Aplicando y reiniciando n8n-main1 ===');
  await runCmd('10.114.158.71', [
    `echo '${SSH_PASS}' | sudo -S cp /tmp/n8n_main1_compose /opt/n8n-main1/docker-compose.yml`,
    `cd /opt/n8n-main1 && echo '${SSH_PASS}' | sudo -S docker compose up -d --force-recreate`,
    `sleep 12`,
    `echo '${SSH_PASS}' | sudo -S docker exec n8n-main1 wget -qO- http://localhost:5678/healthz`,
    `echo MAIN1_READY`,
  ].join(' && '));

  console.log('\n✅ Logging habilitado. El usuario puede reproducir el error ahora.');
}

main().catch(e => { console.error(e); process.exit(1); });
