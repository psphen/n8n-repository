/**
 * fix-logging.js
 * Sube la config de nginx con upstream_status y corrige el log level de n8n a debug
 */
'use strict';
const { Client } = require('ssh2');

const SSH_USER = 'administrador';
const SSH_PASS = 'Temporal01#';
const SUDO = `echo '${SSH_PASS}' | sudo -S`;

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

function uploadContent(host, content, remotePath) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { conn.end(); return reject(err); }
        sftp.writeFile(remotePath, Buffer.from(content), { mode: 0o644 }, err2 => {
          conn.end();
          if (err2) return reject(err2);
          resolve();
        });
      });
    });
    conn.on('error', reject);
    conn.connect({ host, port: 22, username: SSH_USER, password: SSH_PASS, readyTimeout: 20000, hostVerifier: () => true });
  });
}

// nginx site con log_format que incluye upstream_status y metodo completo
const nginxConf = `log_format n8nlog '$remote_addr [$time_local] "$request" $status upstream:$upstream_status bytes:$bytes_sent';

server {
    listen 80;
    access_log /var/log/nginx/n8n_debug.log n8nlog;
    error_log  /var/log/nginx/n8n_error.log warn;

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
    }
}
`;

// Docker compose Main1 con log level debug (valor válido en n8n 2.x)
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
      - N8N_LOG_LEVEL=debug
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
    name: n8n_main1_data
`;

async function main() {
  console.log('\n=== [1/5] Subiendo nueva config nginx a LB ===');
  await uploadContent('10.115.25.101', nginxConf, '/tmp/n8n_nginx_site');

  console.log('\n=== [2/5] Aplicando config nginx ===');
  await runCmd('10.115.25.101', [
    `${SUDO} cp /tmp/n8n_nginx_site /etc/nginx/sites-available/n8n`,
    `${SUDO} nginx -t`,
    `${SUDO} systemctl reload nginx`,
    `echo NGINX_OK`,
  ].join(' && '));

  console.log('\n=== [3/5] Subiendo docker-compose Main1 con debug ===');
  await uploadContent('10.114.158.71', dockerComposeMain1, '/tmp/n8n_main1_compose');

  console.log('\n=== [4/5] Aplicando y reiniciando n8n-main1 ===');
  await runCmd('10.114.158.71', [
    `${SUDO} cp /tmp/n8n_main1_compose /opt/n8n-main1/docker-compose.yml`,
    `cd /opt/n8n-main1 && ${SUDO} docker compose up -d --force-recreate`,
    `sleep 15`,
    `${SUDO} docker exec n8n-main1 wget -qO- http://localhost:5678/healthz`,
    `echo MAIN1_READY`,
  ].join(' && '));

  console.log('\n=== [5/5] Verificando ===');
  await runCmd('10.114.158.71', [
    `${SUDO} docker exec n8n-main1 env | grep N8N_LOG_LEVEL`,
    `${SUDO} docker ps --filter name=n8n-main1 --format "{{.Names}} {{.Status}}"`,
  ].join(' && '));

  console.log('\n✅ Listo. Reproduce el error ahora y luego avísame para leer los logs.');
}

main().catch(e => { console.error(e); process.exit(1); });
