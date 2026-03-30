const { Client } = require('ssh2');

const SSH_LB   = { host: '10.115.25.101', port: 22, username: 'administrador', password: 'Temporal01#', readyTimeout: 15000, hostVerifier: () => true };
const SSH_M1   = { host: '10.114.158.71',  port: 22, username: 'administrador', password: 'Temporal01#', readyTimeout: 15000, hostVerifier: () => true };
const SSH_M2   = { host: '10.114.158.72',  port: 22, username: 'administrador', password: 'Temporal01#', readyTimeout: 15000, hostVerifier: () => true };

function ssh(cfg, cmd) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let out = '';
    c.on('ready', () => {
      c.exec(cmd, { pty: false }, (err, s) => {
        if (err) return reject(err);
        s.on('data', d => out += d);
        s.stderr.on('data', d => out += d);
        s.on('close', () => { c.end(); resolve(out.trim()); });
      });
    });
    c.on('error', reject);
    c.connect(cfg);
  });
}

function testHttps(host, port, path, method, body) {
  return new Promise((resolve) => {
    const opts = {
      host, port, path, method,
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.headers['Content-Length'] = Buffer.byteLength(body);
    const req = require('https').request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 100) }));
    });
    req.on('error', e => resolve({ status: 'ERROR', body: e.message }));
    req.setTimeout(8000, () => { resolve({ status: 'TIMEOUT', body: '' }); req.destroy(); });
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  console.log('\n=== PASO 1: Generando certificado SSL autofirmado en Load Balancer ===');
  const certCmd = `
    echo 'Temporal01#' | sudo -S bash -c '
      mkdir -p /etc/nginx/ssl &&
      openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/n8n.key \
        -out /etc/nginx/ssl/n8n.crt \
        -subj "/C=CO/ST=Bogota/L=Bogota/O=Artics/CN=10.115.25.101" &&
      ls -la /etc/nginx/ssl/
    '
  `;
  const certOut = await ssh(SSH_LB, certCmd);
  console.log(certOut);
  if (!certOut.includes('n8n.crt')) throw new Error('Error generando certificado');
  console.log('✅ Certificado generado');

  console.log('\n=== PASO 2: Configurando nginx con HTTPS en puerto 443 ===');
  const nginxConf = `
server {
    listen 80;
    # Redirigir HTTP a HTTPS
    return 301 https://\\$host\\$request_uri;
}

server {
    listen 443 ssl;
    ssl_certificate /etc/nginx/ssl/n8n.crt;
    ssl_certificate_key /etc/nginx/ssl/n8n.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    access_log /var/log/nginx/n8n_debug.log;

    # Canal de push (WebSocket)
    location /rest/push {
        proxy_pass http://10.114.158.71:5678;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \\$host;
        proxy_set_header X-Forwarded-Port 443;
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
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection "keep-alive";
        proxy_set_header Host \\$host;
        proxy_set_header X-Real-IP \\$remote_addr;
        proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host \\$host;
        proxy_set_header X-Forwarded-Port 443;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        proxy_send_timeout 300;
        proxy_hide_header X-Frame-Options;
    }
}`;

  const writeNginx = `echo 'Temporal01#' | sudo -S bash -c 'cat > /etc/nginx/sites-enabled/default << '"'"'NGINXEOF'"'"'
${nginxConf}
NGINXEOF
nginx -t && systemctl reload nginx && echo NGINX_OK'`;

  const nginxOut = await ssh(SSH_LB, writeNginx);
  console.log(nginxOut);
  if (!nginxOut.includes('NGINX_OK')) throw new Error('Error configurando nginx: ' + nginxOut);
  console.log('✅ nginx HTTPS configurado');

  console.log('\n=== PASO 3: Probando si PATCH pasa por HTTPS (sin WAF) ===');
  await new Promise(r => setTimeout(r, 2000));
  const patchTest = await testHttps('10.115.25.101', 443, '/rest/workflows/test123', 'PATCH', JSON.stringify({name:'test'}));
  console.log('PATCH via HTTPS ->', patchTest.status, patchTest.body.substring(0, 80));

  if (patchTest.status === 403) {
    console.log('\n❌ WAF también intercepta HTTPS. No se puede resolver sin acceso al WAF.');
    console.log('   Debes contactar al administrador del WAF para añadir excepción al método PATCH.');
    return;
  }
  console.log('\n✅ PATCH pasa por HTTPS! El WAF no intercepta SSL.');

  console.log('\n=== PASO 4: Actualizando n8n Main1 y Main2 con URL HTTPS ===');

  // Leer compose actual Main1
  const readM1 = await ssh(SSH_M1, 'cat /opt/n8n-main1/docker-compose.yml');
  const newM1 = readM1
    .replace(/N8N_EDITOR_BASE_URL=http:\/\/10\.115\.25\.101/g, 'N8N_EDITOR_BASE_URL=https://10.115.25.101')
    .replace(/N8N_WEBHOOK_URL=http:\/\/10\.115\.25\.101/g, 'N8N_WEBHOOK_URL=https://10.115.25.101')
    .replace(/N8N_PROXY_HOPS=1/g, 'N8N_PROXY_HOPS=1\n      - N8N_SSL_KEY=/dev/null\n      - N8N_PROTOCOL=https');

  // Escribir Main1
  const writeM1 = `echo 'Temporal01#' | sudo -S bash -c 'cat > /tmp/dc_m1.yml << '"'"'EOF'"'"'
${newM1}
EOF
mv /tmp/dc_m1.yml /opt/n8n-main1/docker-compose.yml'`;
  await ssh(SSH_M1, writeM1);

  const restartM1 = `echo 'Temporal01#' | sudo -S bash -c 'cd /opt/n8n-main1 && docker compose up -d --force-recreate 2>&1 | tail -5'`;
  const r1 = await ssh(SSH_M1, restartM1);
  console.log('Main1 restart:', r1);

  // Leer compose actual Main2
  const readM2 = await ssh(SSH_M2, 'cat /opt/n8n-main2/docker-compose.yml');
  const newM2 = readM2
    .replace(/N8N_EDITOR_BASE_URL=http:\/\/10\.115\.25\.101/g, 'N8N_EDITOR_BASE_URL=https://10.115.25.101')
    .replace(/N8N_WEBHOOK_URL=http:\/\/10\.115\.25\.101/g, 'N8N_WEBHOOK_URL=https://10.115.25.101');

  const writeM2 = `echo 'Temporal01#' | sudo -S bash -c 'cat > /tmp/dc_m2.yml << '"'"'EOF'"'"'
${newM2}
EOF
mv /tmp/dc_m2.yml /opt/n8n-main2/docker-compose.yml'`;
  await ssh(SSH_M2, writeM2);

  const restartM2 = `echo 'Temporal01#' | sudo -S bash -c 'cd /opt/n8n-main2 && docker compose up -d --force-recreate 2>&1 | tail -5'`;
  const r2 = await ssh(SSH_M2, restartM2);
  console.log('Main2 restart:', r2);

  console.log('\n=== PASO 5: Verificando estado final ===');
  await new Promise(r => setTimeout(r, 8000));
  const health = await testHttps('10.115.25.101', 443, '/healthz', 'GET', null);
  console.log('HTTPS health check ->', health.status, health.body);

  const patchFinal = await testHttps('10.115.25.101', 443, '/rest/workflows/test123', 'PATCH', JSON.stringify({name:'test'}));
  console.log('PATCH final via HTTPS ->', patchFinal.status, patchFinal.body.substring(0, 80));

  if (patchFinal.status !== 403) {
    console.log('\n✅ SOLUCIÓN COMPLETA');
    console.log('   Accede a n8n en: https://10.115.25.101');
    console.log('   El navegador mostrará aviso de certificado autofirmado — acepta la excepción una sola vez.');
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
