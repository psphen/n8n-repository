const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOSTS = {
  lb:   '10.115.25.101',
  main1: '10.114.158.71',
  main2: '10.114.158.72',
};
const CREDS = { port: 22, username: 'administrador', password: 'Temporal01#', readyTimeout: 15000, hostVerifier: () => true };

function ssh(host, cmd) {
  return new Promise((resolve, reject) => {
    const c = new Client();
    let out = '';
    c.on('ready', () => c.exec(cmd, { pty: false }, (err, s) => {
      if (err) return reject(err);
      s.on('data', d => out += d);
      s.stderr.on('data', d => out += d);
      s.on('close', () => { c.end(); resolve(out.trim()); });
    }));
    c.on('error', reject);
    c.connect({ host, ...CREDS });
  });
}

function testHttps(path, method) {
  return new Promise((resolve) => {
    const req = require('https').request({
      host: HOSTS.lb, port: 443, path, method,
      rejectUnauthorized: false,
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve({ status: res.statusCode, body: data.substring(0, 80) }));
    });
    req.on('error', e => resolve({ status: 'ERROR', body: e.message }));
    req.setTimeout(8000, () => { resolve({ status: 'TIMEOUT', body: '' }); req.destroy(); });
    req.end();
  });
}

async function uploadFile(host, localPath, remotePath) {
  const content = fs.readFileSync(localPath, 'utf8');
  const tmpPath = `/tmp/_n8n_${Date.now()}.yml`;
  // Escapar single quotes en el contenido
  const escaped = content.replace(/'/g, "'\\''");
  const cmd = `echo 'Temporal01#' | sudo -S bash -c 'printf '"'"'%s'"'"' '"'"'${escaped}'"'"' > ${tmpPath} && mv ${tmpPath} ${remotePath} && echo UPLOAD_OK'`;
  const result = await ssh(host, cmd);
  if (!result.includes('UPLOAD_OK')) throw new Error(`Upload failed to ${host}:${remotePath}\n${result}`);
}

async function main() {
  // ── PASO 1: nginx con upstream Main1 + Main2 ──────────────────────────
  console.log('\n=== PASO 1: Actualizando nginx con load balancing Main1 + Main2 ===');

  const nginxConf = fs.readFileSync(path.join(__dirname, 'Load Balancer', 'nginx.conf'), 'utf8');
  const escaped = nginxConf.replace(/'/g, "'\\''");
  const nginxCmd = `echo 'Temporal01#' | sudo -S bash -c '
    printf '"'"'%s'"'"' '"'"'${escaped}'"'"' > /etc/nginx/sites-enabled/default &&
    nginx -t && systemctl reload nginx && echo NGINX_OK
  '`;
  const nginxOut = await ssh(HOSTS.lb, nginxCmd);
  console.log(nginxOut);
  if (!nginxOut.includes('NGINX_OK')) throw new Error('nginx falló: ' + nginxOut);
  console.log('✅ nginx actualizado con upstream Main1 + Main2');

  // ── PASO 2: Actualizar Main1 ──────────────────────────────────────────
  console.log('\n=== PASO 2: Actualizando Main1 ===');
  await uploadFile(HOSTS.main1,
    path.join(__dirname, 'Main 1', 'docker-compose.yml'),
    '/opt/n8n-main1/docker-compose.yml'
  );
  const r1 = await ssh(HOSTS.main1,
    `echo 'Temporal01#' | sudo -S bash -c 'cd /opt/n8n-main1 && docker compose up -d --force-recreate 2>&1 | tail -5'`
  );
  console.log(r1);
  console.log('✅ Main1 actualizado');

  // ── PASO 3: Actualizar Main2 ──────────────────────────────────────────
  console.log('\n=== PASO 3: Actualizando Main2 ===');
  await uploadFile(HOSTS.main2,
    path.join(__dirname, 'Main 2', 'docker-compose.yml'),
    '/opt/n8n-main2/docker-compose.yml'
  );
  const r2 = await ssh(HOSTS.main2,
    `echo 'Temporal01#' | sudo -S bash -c 'cd /opt/n8n-main2 && docker compose up -d --force-recreate 2>&1 | tail -5'`
  );
  console.log(r2);
  console.log('✅ Main2 actualizado');

  // ── PASO 4: Esperar y verificar ambos ─────────────────────────────────
  console.log('\n=== PASO 4: Verificando ambos main nodes ===');
  await new Promise(r => setTimeout(r, 10000));

  const [h1, h2, patchTest] = await Promise.all([
    ssh(HOSTS.main1, 'curl -s http://localhost:5678/healthz'),
    ssh(HOSTS.main2, 'curl -s http://localhost:5678/healthz'),
    testHttps('/rest/workflows/test123', 'PATCH'),
  ]);

  console.log('Main1 health:', h1);
  console.log('Main2 health:', h2);
  console.log('PATCH via LB (HTTPS):', patchTest.status, patchTest.body);

  // Verificar que el LB está enviando tráfico a ambos
  console.log('\n=== PASO 5: Verificando distribución de tráfico ===');
  const accessLog = await ssh(HOSTS.lb, 'tail -5 /var/log/nginx/n8n_access.log 2>/dev/null || echo "(log vacío)"');
  console.log('nginx access log:', accessLog);

  const upstreamCheck = await ssh(HOSTS.main1,
    `echo 'Temporal01# | sudo -S docker exec n8n-main1 env | grep -E "EDITOR_BASE_URL|PROTOCOL|PROXY_HOPS|PUSH_BACKEND" 2>/dev/null'`
  );
  console.log('\nMain1 env vars clave:');
  const envOut = await ssh(HOSTS.main1,
    `echo 'Temporal01#' | sudo -S docker exec n8n-main1 env 2>/dev/null | grep -E "EDITOR_BASE_URL|PROTOCOL|PROXY_HOPS|PUSH_BACKEND"`
  );
  console.log(envOut);

  const envOut2 = await ssh(HOSTS.main2,
    `echo 'Temporal01#' | sudo -S docker exec n8n-main2 env 2>/dev/null | grep -E "EDITOR_BASE_URL|PROTOCOL|PROXY_HOPS|PUSH_BACKEND"`
  );
  console.log('Main2 env vars clave:');
  console.log(envOut2);

  if (h1.includes('"ok"') && h2.includes('"ok"') && patchTest.status !== 403) {
    console.log('\n✅ TODO OK — Main1 y Main2 operando juntos, PATCH pasa sin bloqueo del WAF');
    console.log('   Accede en: https://10.115.25.101');
  } else {
    console.log('\n⚠️  Revisar resultados arriba');
  }
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
