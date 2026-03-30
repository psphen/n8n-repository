/**
 * fix-push-websocket.js
 * Fix del canal push y write lock:
 * 1. Nginx: map para Connection correcto (WS vs SSE/HTTP)
 * 2. n8n Main1: N8N_PUSH_BACKEND=websocket para push estable
 * 3. Separar location /rest/push en nginx con proxy_buffering off
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

// Nginx: location separada para /rest/push con WebSocket correcto y sin buffering
// Map en nginx.conf para manejar Connection header según si es WS o HTTP normal
const nginxConf = `server {
    listen 80;
    access_log /var/log/nginx/n8n_debug.log;

    # Canal de push (WebSocket) - sin buffering, timeout largo
    location /rest/push {
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
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
    }

    # Resto de peticiones HTTP normales
    location / {
        proxy_pass http://10.114.158.71:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "keep-alive";
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

// Docker compose Main1 con N8N_PUSH_BACKEND=websocket y log level debug removido
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
      - N8N_PUSH_BACKEND=websocket
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
    name: n8n_main1_data
`;

// Docker compose Main2 (mismo fix)
const dockerComposeMain2 = `services:
  n8n:
    image: n8nio/n8n:2.8.4
    container_name: n8n-main2
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
      - N8N_PUSH_BACKEND=websocket
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  n8n_data:
    name: n8n_main2_data
`;

async function main() {
  // 1. Nginx fix
  console.log('\n=== [1/6] Subiendo nueva config nginx ===');
  await uploadContent('10.115.25.101', nginxConf, '/tmp/n8n_nginx_fix');

  console.log('\n=== [2/6] Aplicando nginx ===');
  await runCmd('10.115.25.101', [
    `${SUDO} cp /tmp/n8n_nginx_fix /etc/nginx/sites-available/n8n`,
    `${SUDO} nginx -t`,
    `${SUDO} systemctl reload nginx`,
    `echo NGINX_OK`,
  ].join(' && '));

  // 2. Main1 con websocket push
  console.log('\n=== [3/6] Subiendo docker-compose Main1 con WebSocket push ===');
  await uploadContent('10.114.158.71', dockerComposeMain1, '/tmp/n8n_main1_ws');

  console.log('\n=== [4/6] Reiniciando Main1 ===');
  await runCmd('10.114.158.71', [
    `${SUDO} cp /tmp/n8n_main1_ws /opt/n8n-main1/docker-compose.yml`,
    `cd /opt/n8n-main1 && ${SUDO} docker compose up -d --force-recreate`,
    `sleep 15`,
    `${SUDO} docker exec n8n-main1 wget -qO- http://localhost:5678/healthz`,
    `echo MAIN1_READY`,
  ].join(' && '));

  // 3. Main2 con websocket push
  console.log('\n=== [5/6] Subiendo docker-compose Main2 con WebSocket push ===');
  await uploadContent('10.114.158.72', dockerComposeMain2, '/tmp/n8n_main2_ws');

  console.log('\n=== [6/6] Reiniciando Main2 ===');
  await runCmd('10.114.158.72', [
    `${SUDO} cp /tmp/n8n_main2_ws /opt/n8n-main2/docker-compose.yml`,
    `cd /opt/n8n-main2 && ${SUDO} docker compose up -d --force-recreate`,
    `sleep 15`,
    `${SUDO} docker exec n8n-main2 wget -qO- http://localhost:5678/healthz`,
    `echo MAIN2_READY`,
  ].join(' && '));

  console.log('\n✅ Fix aplicado. Prueba ahora en incógnito.');
}

main().catch(e => { console.error(e); process.exit(1); });
