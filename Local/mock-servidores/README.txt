=================================================================
MOCK SERVERS - SIMULACIÓN DE SERVIDORES POSITIVA
Conectados al n8n Local para pruebas de monitoreo
=================================================================

📊 RESUMEN DE SERVIDORES SIMULADOS
=================================================================

Este docker-compose simula 4 servidores reales de la infraestructura
de POSITIVA basados en datos de SolarWinds:

┌─────────────────────────────────────────────────────────────┐
│ SERVIDORES ACTIVOS (UP)                                     │
└─────────────────────────────────────────────────────────────┘

1. BOGOTA_CASA_MATRIZ_PPAL
   ├─ IP Mock:      172.30.0.10
   ├─ IP Real:      192.168.1.2
   ├─ Puerto:       9001
   ├─ NodeID:       3
   ├─ Tipo:         Cisco C8200-1N-4T Chassis
   ├─ Vendor:       HPE
   ├─ Status:       UP ✅
   └─ URL:          http://localhost:9001

2. BOGOTA_CASA_MATRIZ_BKP
   ├─ IP Mock:      172.30.0.11
   ├─ IP Real:      192.168.1.3
   ├─ Puerto:       9002
   ├─ NodeID:       1
   ├─ Tipo:         Cisco C8200-1N-4T Chassis
   ├─ Vendor:       HPE
   ├─ Status:       UP ✅
   └─ URL:          http://localhost:9002

┌─────────────────────────────────────────────────────────────┐
│ SERVIDORES CAÍDOS (DOWN)                                    │
└─────────────────────────────────────────────────────────────┘

3. DVR_TUNJA
   ├─ IP Mock:      172.30.0.20
   ├─ IP Real:      10.0.120.5
   ├─ NodeID:       338
   ├─ Tipo:         Unknown
   ├─ Status:       DOWN ❌ (contenedor exit 1)
   ├─ Simulación:   Servidor completamente caído
   └─ Ping:         No responde

4. CALI_LIMONAR_PPAL
   ├─ IP Mock:      172.30.0.21
   ├─ IP Real:      10.0.30.4
   ├─ Puerto:       9003
   ├─ NodeID:       597
   ├─ Tipo:         Cisco C1111
   ├─ Status:       DOWN ⚠️ (responde HTTP 503)
   ├─ Simulación:   Servidor responde pero con error
   └─ URL:          http://localhost:9003 (503 Error)

=================================================================
🚀 INSTRUCCIONES DE USO
=================================================================

1. LEVANTAR LOS SERVIDORES MOCK
   --------------------------------
   cd ~/n8n-repository/Local/mock-servidores
   docker compose up -d

2. VERIFICAR QUE ESTÁN CORRIENDO
   --------------------------------
   docker compose ps

   Deberías ver:
   - bogota-matriz-ppal  →  Up (healthy)
   - bogota-matriz-bkp   →  Up (healthy)
   - dvr-tunja           →  Exited (simulando DOWN)
   - cali-limonar        →  Up (pero responde 503)

3. PROBAR CONECTIVIDAD
   --------------------------------
   # Servidores UP (deberían responder 200 OK)
   curl -I http://localhost:9001
   curl -I http://localhost:9002

   # Servidor DOWN con 503
   curl -I http://localhost:9003

   # Ping a IPs internas (desde contenedor n8n)
   docker exec n8n-local-main1 ping -c 2 172.30.0.10
   docker exec n8n-local-main1 ping -c 2 172.30.0.11
   docker exec n8n-local-main1 ping -c 2 172.30.0.20  # No responde
   docker exec n8n-local-main1 ping -c 2 172.30.0.21

4. VER LOGS
   --------------------------------
   docker compose logs -f

5. DETENER SERVIDORES
   --------------------------------
   docker compose down

=================================================================
🔧 INTEGRACIÓN CON N8N LOCAL
=================================================================

Para monitorear estos servidores desde tu n8n local:

OPCIÓN A: Conectar redes Docker
--------------------------------
# Conectar la red mock-positiva con la red de n8n
docker network connect mock-positiva n8n-local-main1
docker network connect mock-positiva n8n-local-main2
docker network connect mock-positiva n8n-local-worker-1

# Ahora n8n puede hacer ping a 172.30.0.10, 172.30.0.11, etc.

OPCIÓN B: Crear workflow de monitoreo
--------------------------------------
En n8n, crea un workflow:

1. Schedule Trigger (cada 1 min)
2. HTTP Request:
   - GET http://172.30.0.10 → debería ser 200 OK
   - GET http://172.30.0.11 → debería ser 200 OK
   - GET http://172.30.0.21 → debería ser 503 Error
3. IF nodo: si status != 200 → Alerta
4. PostgreSQL: guardar resultado
5. Webhook: enviar alerta a Slack/Teams

OPCIÓN C: Usar Execute Command para ping
-----------------------------------------
1. Nodo Execute Command
2. Command: ping -c 1 172.30.0.10
3. Si exit code != 0 → Servidor caído

=================================================================
📋 DATOS PARA IMPORTAR A POSTGRESQL (OPCIONAL)
=================================================================

Si quieres guardar estos servidores en una tabla de inventario:

CREATE TABLE servidores_mock (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(255),
  ip_mock VARCHAR(50),
  ip_real VARCHAR(50),
  puerto INT,
  node_id INT,
  tipo VARCHAR(255),
  vendor VARCHAR(100),
  status VARCHAR(20),
  fecha_creacion TIMESTAMP DEFAULT NOW()
);

INSERT INTO servidores_mock (nombre, ip_mock, ip_real, puerto, node_id, tipo, vendor, status) VALUES
('BOGOTA_CASA_MATRIZ_PPAL', '172.30.0.10', '192.168.1.2', 9001, 3, 'Cisco C8200-1N-4T Chassis', 'HPE', 'UP'),
('BOGOTA_CASA_MATRIZ_BKP', '172.30.0.11', '192.168.1.3', 9002, 1, 'Cisco C8200-1N-4T Chassis', 'HPE', 'UP'),
('DVR_TUNJA', '172.30.0.20', '10.0.120.5', NULL, 338, 'Unknown', NULL, 'DOWN'),
('CALI_LIMONAR_PPAL', '172.30.0.21', '10.0.30.4', 9003, 597, 'Cisco C1111', NULL, 'DOWN');

=================================================================
🎯 ESCENARIOS DE PRUEBA
=================================================================

1. MONITOREO BÁSICO
   - Verificar que los servidores UP respondan
   - Detectar que DVR Tunja no responde ping
   - Detectar que Cali devuelve 503

2. ALERTAS
   - Crear ticket cuando un servidor cambia de UP a DOWN
   - Enviar notificación cuando hay error HTTP 503

3. RECUPERACIÓN
   - Levantar DVR Tunja manualmente:
     docker compose up -d dvr-tunja
     (fallará de nuevo por el exit 1, pero puedes cambiar el comando)

4. FALLOS PROGRAMADOS
   - Detener un servidor UP:
     docker stop bogota-matriz-ppal
   - n8n debería detectarlo y alertar

=================================================================
📝 NOTAS TÉCNICAS
=================================================================

- Red Docker:        172.30.0.0/16
- Subnet name:       mock-positiva
- Healthchecks:      Solo en servidores UP
- Restart policy:    DVR Tunja = "no", demás = "always"
- Web servers:       nginx:alpine
- Simulación DOWN:   Exit code 1 o HTTP 503

=================================================================
✅ CHECKLIST DE VALIDACIÓN
=================================================================

[ ] docker compose up -d ejecutado sin errores
[ ] 4 contenedores creados (2 Up, 1 Exited, 1 Up con error)
[ ] http://localhost:9001 abre la página de Bogotá Principal
[ ] http://localhost:9002 abre la página de Bogotá Backup
[ ] http://localhost:9003 muestra error 503
[ ] Ping a 172.30.0.10 y 172.30.0.11 responde
[ ] Ping a 172.30.0.20 no responde (DVR Tunja caído)
[ ] n8n local puede conectarse a estos servidores
[ ] Workflow de monitoreo detecta correctamente UP/DOWN

=================================================================

Última actualización: 31 Marzo 2026
Basado en datos reales de SolarWinds POSITIVA
