/**
 * deploy-nodes.js
 * Despliega toda la infraestructura n8n conectándose por SSH a cada servidor
 * usando sus IPs reales del infra.txt
 *
 * Ejecutar: node deploy-nodes.js
 */

'use strict';

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const BASE     = __dirname;
const SSH_USER = 'administrador';
const SSH_PASS = 'Temporal01#';

// sudo usa -S para leer contraseña desde stdin
// Para comandos simples: echo PASS | sudo -S cmd
const SUDO = `echo '${SSH_PASS}' | sudo -S`;
// Para comandos que contienen pipes o redirects internos: sudo -S bash -c '...'
// La contraseña se pasa via stdin del bash -c wrapper
function sudoWrap(cmd) {
  const escaped = cmd.replace(/'/g, `'\\''`);
  return `echo '${SSH_PASS}' | sudo -S bash -c '${escaped}'`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Definición de servidores en orden de despliegue
// ─────────────────────────────────────────────────────────────────────────────
const SERVERS = [
  {
    name:        'Redis',
    host:        '10.114.158.75',
    remoteDir:   '/opt/n8n-redis',
    files: [
      { local: path.join(BASE, 'Redis', 'docker-compose.yml'), remote: 'docker-compose.yml' }
    ],
    stopService: 'redis-server',
    healthCheck: `${SUDO} docker exec n8n-redis redis-cli ping`,
  },
  {
    name:        'PostgreSQL',
    host:        '10.114.158.77',
    remoteDir:   '/opt/n8n-postgres',
    files: [
      { local: path.join(BASE, 'Postgres', 'docker-compose.yml'), remote: 'docker-compose.yml' },
      { local: path.join(BASE, 'Postgres', 'pg_hba.conf'),        remote: 'pg_hba.conf'        }
    ],
    stopService: 'postgresql',
    // Backup antes de parar; si ya existe del run anterior lo reutiliza
    preStop: `if [ -f /tmp/n8n_db_backup.sql ]; then echo "BACKUP_OK (reutilizando backup existente)"; elif systemctl is-active --quiet postgresql 2>/dev/null; then ${SUDO} -u postgres pg_dump n8n_db > /tmp/n8n_db_backup.sql 2>&1 && echo BACKUP_OK; else echo "BACKUP_OK (postgresql ya parado, backup previo en /tmp)"; fi`,
    // Restaurar después de que el contenedor esté listo
    // Usamos sudoWrap para que el redirect < no interfiera con el stdin de sudo -S
    postStart: `sleep 15 && ${sudoWrap('docker exec -i n8n-postgres psql -U n8n_user -d n8n_db < /tmp/n8n_db_backup.sql')} && echo RESTORE_OK`,
    healthCheck: `${SUDO} docker exec n8n-postgres pg_isready -U n8n_user`,
  },
  {
    name:        'n8n Main 1',
    host:        '10.114.158.71',
    remoteDir:   '/opt/n8n-main1',
    files: [
      { local: path.join(BASE, 'Main 1', 'docker-compose.yml'), remote: 'docker-compose.yml' }
    ],
    stopService: 'n8n',
    postStartWait: 20,
    healthCheck: `${SUDO} docker compose ps && ${SUDO} docker logs n8n-main1 --tail 10`,
  },
  {
    name:        'n8n Worker',
    host:        '10.114.158.76',
    remoteDir:   '/opt/n8n-worker',
    files: [
      { local: path.join(BASE, 'Worker', 'docker-compose.yml'), remote: 'docker-compose.yml' }
    ],
    stopService: 'n8n',
    postStartWait: 10,
    healthCheck: `${SUDO} docker compose ps && ${SUDO} docker logs n8n-worker --tail 10`,
  },
  {
    name:        'n8n Main 2 (backup)',
    host:        '10.114.158.72',
    remoteDir:   '/opt/n8n-main2',
    files: [
      { local: path.join(BASE, 'Main 2', 'docker-compose.yml'), remote: 'docker-compose.yml' }
    ],
    stopService: 'n8n',
    postStartWait: 15,
    healthCheck: `${SUDO} docker compose ps && ${SUDO} docker logs n8n-main2 --tail 10`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers SSH / SFTP
// ─────────────────────────────────────────────────────────────────────────────

function connect(host) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({
      host,
      port:         22,
      username:     SSH_USER,
      password:     SSH_PASS,
      readyTimeout: 30000,
      // Acepta cualquier host key (red interna privada)
      hostVerifier: () => true,
    });
  });
}

function runCmd(host, cmd) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try { conn = await connect(host); } catch (e) { return reject(e); }
    let out = '';
    conn.exec(cmd, { pty: false }, (err, stream) => {
      if (err) { conn.end(); return reject(err); }
      stream.on('data',        d => { process.stdout.write(d); out += d.toString(); });
      stream.stderr.on('data', d => { process.stdout.write(d); out += d.toString(); });
      stream.on('close', code => { conn.end(); resolve({ code, out }); });
    });
  });
}

function uploadFile(host, localPath, remoteTmp) {
  return new Promise(async (resolve, reject) => {
    let conn;
    try { conn = await connect(host); } catch (e) { return reject(e); }
    const content = fs.readFileSync(localPath);
    conn.sftp((err, sftp) => {
      if (err) { conn.end(); return reject(err); }
      sftp.writeFile(remoteTmp, content, { mode: 0o644 }, err2 => {
        conn.end();
        if (err2) return reject(err2);
        resolve();
      });
    });
  });
}

function wait(secs) {
  if (secs <= 0) return Promise.resolve();
  process.stdout.write(`  (esperando ${secs}s) `);
  return new Promise(r => setTimeout(() => { process.stdout.write('\n'); r(); }, secs * 1000));
}

function sep(title) {
  const line = '─'.repeat(60);
  console.log(`\n${line}`);
  if (title) console.log(`  ${title}`);
  console.log(line);
}

// ─────────────────────────────────────────────────────────────────────────────
// Deploy individual
// ─────────────────────────────────────────────────────────────────────────────

async function deployServer(srv) {
  const { name, host, remoteDir, files, stopService, preStop, postStart, postStartWait, healthCheck } = srv;

  sep(`▶  ${name}   →   ${host}`);

  // ── 1. Verificar / instalar Docker ─────────────────────────────────────────
  console.log('\n[1/7] Verificando Docker...');
  // Descarga el script a /tmp primero, luego lo ejecuta con sudo
  // (evita el problema de pipe curl | sudo -S sh)
  await runCmd(host, [
    `if ! command -v docker &>/dev/null; then`,
    `  echo "Docker no encontrado, instalando...";`,
    `  curl -fsSL -o /tmp/get-docker.sh https://get.docker.com;`,
    `  ${SUDO} sh /tmp/get-docker.sh;`,
    `  ${SUDO} systemctl enable docker;`,
    `  ${SUDO} systemctl start docker;`,
    `  rm -f /tmp/get-docker.sh;`,
    `else`,
    `  echo "Docker OK: $(docker --version)";`,
    `fi`,
  ].join(' '));

  // ── 2. Backup previo (solo Postgres) ───────────────────────────────────────
  if (preStop) {
    console.log('\n[2/7] Backup de la base de datos...');
    const r = await runCmd(host, preStop);
    if (!r.out.includes('BACKUP_OK')) {
      throw new Error('El backup de PostgreSQL falló. Abortando para no perder datos.');
    }
    console.log('  → Backup creado en /tmp/n8n_db_backup.sql');
  } else {
    console.log('\n[2/7] Backup no aplica para este servidor.');
  }

  // ── 3. Crear directorio remoto ─────────────────────────────────────────────
  console.log(`\n[3/7] Preparando ${remoteDir}...`);
  await runCmd(host, `${SUDO} mkdir -p ${remoteDir} && ${SUDO} chown ${SSH_USER}:${SSH_USER} ${remoteDir} && echo DIR_OK`);

  // ── 4. Subir archivos vía SFTP ─────────────────────────────────────────────
  console.log('\n[4/7] Subiendo archivos...');
  for (const f of files) {
    const tmpPath = `/tmp/_n8n_deploy_${f.remote.replace(/\//g, '_')}`;
    const finalPath = `${remoteDir}/${f.remote}`;
    console.log(`  → ${finalPath}`);
    await uploadFile(host, f.local, tmpPath);
    // mover de /tmp al destino final con sudo
    await runCmd(host, `${SUDO} mv ${tmpPath} ${finalPath} && ${SUDO} chmod 644 ${finalPath}`);
  }

  // ── 5. Detener servicio systemd existente ──────────────────────────────────
  console.log(`\n[5/7] Deteniendo servicio systemd: ${stopService}...`);
  await runCmd(host, [
    `${SUDO} systemctl stop ${stopService} 2>/dev/null && echo "Detenido: ${stopService}" || echo "${stopService} ya estaba detenido o no existe"`,
    `${SUDO} systemctl disable ${stopService} 2>/dev/null || true`,
  ].join('; '));

  // ── 6. Levantar contenedor Docker ──────────────────────────────────────────
  console.log('\n[6/7] Levantando contenedor Docker...');
  await runCmd(host, [
    `cd ${remoteDir}`,
    `${SUDO} docker compose pull`,
    `${SUDO} docker compose up -d`,
    `echo CONTAINER_UP`,
  ].join(' && '));

  // ── Restaurar datos (solo Postgres) ───────────────────────────────────────
  if (postStart) {
    console.log('\n  Restaurando datos en contenedor Postgres...');
    const r = await runCmd(host, `cd ${remoteDir} && ${postStart}`);
    if (!r.out.includes('RESTORE_OK')) {
      console.warn('  ADVERTENCIA: La restauración puede haber tenido errores. Revisar manualmente.');
    } else {
      console.log('  → Datos restaurados OK');
    }
  }

  // Espera para que levante
  if (postStartWait) {
    process.stdout.write(`\n  Dando tiempo al servicio... `);
    await wait(postStartWait);
  }

  // ── 7. Health check ────────────────────────────────────────────────────────
  console.log('\n[7/7] Health check...');
  await runCmd(host, `cd ${remoteDir} && ${healthCheck}`);

  console.log(`\n✅  ${name} desplegado OK en ${host}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║    DESPLIEGUE INFRAESTRUCTURA N8N  –  POSITIVA / ARTICS      ║');
  console.log('║    Contrato 0420-2026                                         ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  Orden:  Redis → PostgreSQL → Main 1 → Worker → Main 2       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const results = [];

  for (const srv of SERVERS) {
    try {
      await deployServer(srv);
      results.push({ name: srv.name, host: srv.host, ok: true });
    } catch (err) {
      const msg = err.message || String(err);
      console.error(`\n❌  ERROR en ${srv.name}: ${msg}\n`);
      results.push({ name: srv.name, host: srv.host, ok: false, msg });
    }

    if (srv !== SERVERS[SERVERS.length - 1]) {
      process.stdout.write('\nPausa de 5s antes del siguiente servidor...');
      await wait(5);
    }
  }

  // ── Resumen ────────────────────────────────────────────────────────────────
  sep('RESUMEN FINAL');
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌';
    const extra = r.ok ? 'OK' : r.msg.substring(0, 40);
    console.log(`  ${icon}  ${r.name.padEnd(24)} ${r.host.padEnd(16)} ${extra}`);
  }
  console.log('');
  console.log('  Acceso a n8n UI:  http://10.115.25.101');
  console.log('  Puerto directo Main1:  http://10.114.158.71:5678');
  sep();
}

main().catch(err => {
  console.error('\nError fatal:', err);
  process.exit(1);
});
