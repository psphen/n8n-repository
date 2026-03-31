// ============================================================
// Script para registrar servidores mock en SolarWinds
// ============================================================
const https = require('https');

// ============================================================
// CONFIGURACIÓN
// ============================================================
const SOLARWINDS_HOST = '192.168.10.154';
const SOLARWINDS_PORT = 17778;
const SOLARWINDS_USER = 'Admin';
const SOLARWINDS_PASS = '@Admin123!';

// Servidores a registrar
const SERVIDORES = [
  {
    caption: 'BOGOTA_CASA_MATRIZ_PPAL_MOCK',
    ip: '172.30.0.10',
    dns: 'bogota-principal-mock.positiva.col',
    location: 'Docker Mock Network - Bogotá'
  },
  {
    caption: 'BOGOTA_CASA_MATRIZ_BKP_MOCK',
    ip: '172.30.0.11',
    dns: 'bogota-backup-mock.positiva.col',
    location: 'Docker Mock Network - Bogotá Backup'
  },
  {
    caption: 'DVR_TUNJA_MOCK',
    ip: '172.30.0.20',
    dns: 'dvr-tunja-mock.positiva.col',
    location: 'Docker Mock Network - Tunja (DOWN)'
  },
  {
    caption: 'CALI_LIMONAR_PPAL_MOCK',
    ip: '172.30.0.21',
    dns: 'cali-limonar-mock.positiva.col',
    location: 'Docker Mock Network - Cali (503 Error)'
  }
];

// ============================================================
// FUNCIÓN PARA CREAR NODO EN SOLARWINDS
// ============================================================
function crearNodo(servidor) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${SOLARWINDS_USER}:${SOLARWINDS_PASS}`).toString('base64');
    
    const data = JSON.stringify({
      IPAddress: servidor.ip,
      Caption: servidor.caption,
      DNS: servidor.dns,
      Location: servidor.location,
      EngineID: 1,
      ObjectSubType: 'ICMP',
      Status: 1,
      StatusDescription: 'Node is responding normally'
    });

    const options = {
      hostname: SOLARWINDS_HOST,
      port: SOLARWINDS_PORT,
      path: '/SolarWinds/InformationService/v3/Json/Create/Orion.Nodes',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const result = JSON.parse(body);
            console.log(`✅ ${servidor.caption} registrado - URI: ${result}`);
            resolve(result);
          } catch (e) {
            console.log(`✅ ${servidor.caption} registrado`);
            resolve(body);
          }
        } else {
          console.error(`❌ Error ${res.statusCode} al registrar ${servidor.caption}`);
          console.error(`   Respuesta: ${body}`);
          reject(new Error(`HTTP ${res.statusCode}`));
        }
      });
    });

    req.on('error', (e) => {
      console.error(`❌ Error de conexión al registrar ${servidor.caption}: ${e.message}`);
      reject(e);
    });

    req.write(data);
    req.end();
  });
}

// ============================================================
// EJECUTAR REGISTRO
// ============================================================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  Registrando servidores mock en SolarWinds                ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  console.log(`SolarWinds: https://${SOLARWINDS_HOST}:${SOLARWINDS_PORT}`);
  console.log(`Usuario: ${SOLARWINDS_USER}\n`);

  for (const servidor of SERVIDORES) {
    try {
      await crearNodo(servidor);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1seg entre cada registro
    } catch (error) {
      console.error(`Error procesando ${servidor.caption}:`, error.message);
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║  Proceso completado                                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('\nPara verificar en SolarWinds, ejecuta:\n');
  console.log(`curl -k -u "${SOLARWINDS_USER}:${SOLARWINDS_PASS}" \\`);
  console.log(`  "https://${SOLARWINDS_HOST}:17774/SolarWinds/InformationService/v3/Json/Query?query=SELECT+Caption,+IP_Address,+Status+FROM+Orion.Nodes+WHERE+Caption+LIKE+'%MOCK%'"`);
}

main().catch(console.error);
