const { Client } = require('ssh2');
const c = new Client();

c.on('ready', () => {
  // Primera query: contar total
  c.exec('echo Temporal01# | sudo -S su - postgres -c "psql -d n8n_db -t -c \\"SELECT COUNT(*) FROM solarwinds_alertas;\\""', {pty:false}, (err,s) => {
    let output = '';
    s.on('data', d => output += d.toString());
    s.on('close', () => {
      console.log('======================================');
      console.log('Total alertas registradas:', output.trim());
      console.log('======================================\n');
      
      // Segunda query: últimas 10 alertas
      c.exec('echo Temporal01# | sudo -S su - postgres -c "psql -d n8n_db -c \\"SELECT id, servidor, ip, estado, fecha_alerta FROM solarwinds_alertas ORDER BY fecha_alerta DESC LIMIT 10;\\""', {pty:false}, (err2,s2) => {
        let out2 = '';
        s2.on('data', d => out2 += d.toString());
        s2.on('close', () => {
          console.log('Últimas 10 alertas:\n');
          console.log(out2);
          c.end();
        });
      });
    });
  });
});

c.on('error', e => {
  console.error('Error SSH:', e.message);
});

c.connect({
  host:'10.114.158.77',
  port:22,
  username:'administrador',
  password:'Temporal01#',
  readyTimeout:20000,
  hostVerifier:()=>true
});
