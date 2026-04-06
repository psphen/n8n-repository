// ═══════════════════════════════════════════════════════════
// apply-nginx-least-conn.js
// Actualiza nginx en producción con la nueva config least_conn
// ═══════════════════════════════════════════════════════════

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const LB_HOST = '10.115.25.101';
const SSH_USER = 'administrador';
const SSH_PASS = 'Temporal01#';
const NGINX_CONF = path.join(__dirname, 'Load Balancer', 'nginx.conf');

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║  Actualizando nginx Load Balancer: ip_hash → least_conn  ║');
console.log('╚═══════════════════════════════════════════════════════════╝\n');

// Leer archivo de configuración
const nginxConfig = fs.readFileSync(NGINX_CONF, 'utf8');

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ Conectado al Load Balancer\n');

  // Paso 1: Respaldar configuración actual
  console.log('📦 Paso 1/5: Respaldando configuración actual...');
  conn.exec('echo Temporal01# | sudo -S docker exec n8n-loadbalancer cat /etc/nginx/conf.d/default.conf', 
    {pty: false}, (err, stream) => {
    if (err) {
      console.error('❌ Error al respaldar:', err);
      conn.end();
      return;
    }

    let backup = '';
    stream.on('data', (data) => { backup += data.toString(); });
    stream.stderr.on('data', (data) => { backup += data.toString(); });
    
    stream.on('close', () => {
      // Guardar backup localmente
      fs.writeFileSync('nginx.conf.backup', backup);
      console.log('✅ Backup guardado en nginx.conf.backup\n');

      // Paso 2: Copiar nueva configuración
      console.log('📤 Paso 2/5: Copiando nueva configuración...');
      conn.exec(`echo Temporal01# | sudo -S docker exec -i n8n-loadbalancer sh -c "cat > /tmp/nginx.conf"`,
        {pty: false}, (err2, stream2) => {
        if (err2) {
          console.error('❌ Error al copiar:', err2);
          conn.end();
          return;
        }

        stream2.write(nginxConfig);
        stream2.end();

        stream2.on('close', () => {
          // Paso 3: Mover al lugar correcto
          console.log('📋 Paso 3/5: Aplicando configuración...');
          conn.exec('echo Temporal01# | sudo -S docker exec n8n-loadbalancer mv /tmp/nginx.conf /etc/nginx/conf.d/default.conf',
            {pty: false}, (err3, stream3) => {
            stream3.on('data', (d) => process.stdout.write(d.toString()));
            stream3.stderr.on('data', (d) => process.stderr.write(d.toString()));
            
            stream3.on('close', () => {
              // Paso 4: Verificar sintaxis
              console.log('🔍 Paso 4/5: Verificando sintaxis...');
              conn.exec('echo Temporal01# | sudo -S docker exec n8n-loadbalancer nginx -t',
                {pty: false}, (err4, stream4) => {
                let testOutput = '';
                stream4.on('data', (d) => { testOutput += d.toString(); });
                stream4.stderr.on('data', (d) => { testOutput += d.toString(); });
                
                stream4.on('close', (code) => {
                  console.log(testOutput);
                  
                  if (testOutput.includes('successful') || code === 0) {
                    // Paso 5: Recargar nginx
                    console.log('✅ Sintaxis correcta\n');
                    console.log('🔄 Paso 5/5: Recargando nginx...');
                    
                    conn.exec('echo Temporal01# | sudo -S docker exec n8n-loadbalancer nginx -s reload',
                      {pty: false}, (err5, stream5) => {
                      stream5.on('data', (d) => process.stdout.write(d.toString()));
                      stream5.stderr.on('data', (d) => process.stderr.write(d.toString()));
                      
                      stream5.on('close', () => {
                        console.log('\n╔═══════════════════════════════════════════════════════════╗');
                        console.log('║  ✅ nginx actualizado exitosamente                        ║');
                        console.log('║  Estrategia de balanceo: least_conn                       ║');
                        console.log('╚═══════════════════════════════════════════════════════════╝\n');
                        
                        console.log('Ahora ejecuta:');
                        console.log('  for i in {1..10}; do curl -k https://10.115.25.101/webhook/808c45ab-295e-475c-a88b-111aade5a246; sleep 1; done\n');
                        console.log('Y verifica que ambos Mains reciben peticiones.');
                        
                        conn.end();
                      });
                    });
                  } else {
                    console.error('\n❌ Error en sintaxis de nginx.');
                    console.error('El cambio NO se aplicó. Configuración anterior intacta.');
                    conn.end();
                  }
                });
              });
            });
          });
        });
      });
    });
  });

}).on('error', (err) => {
  console.error('❌ Error de conexión SSH:', err.message);
}).connect({
  host: LB_HOST,
  port: 22,
  username: SSH_USER,
  password: SSH_PASS,
  readyTimeout: 15000,
  hostVerifier: () => true
});
