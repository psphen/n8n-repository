# Mock Servers - Positiva

10 servidores simulados que replican la infraestructura de Positiva para pruebas locales de monitoreo con n8n y SolarWinds.

## Servidores Incluidos

| Nombre | IP | Puerto | Servicio |
|--------|-------|---------|----------|
| posmvdc1.positiva.col | 172.20.0.11 | 8081 | nginx web |
| positivadb05.positiva.col | 172.20.0.12 | 5432 | PostgreSQL |
| jboss1.positiva.col | 172.20.0.13 | - | Alpine (SSH) |
| posredis.positiva.col | 172.20.0.14 | 6379 | Redis |
| posmvbackups.positiva.col | 172.20.0.15 | - | Ubuntu + SSH |
| sapalt.positiva.col | 172.20.0.16 | - | Alpine |
| weblogic1.positiva.col | 172.20.0.17 | 8082 | nginx web |
| posfileserver.positiva.col | 172.20.0.18 | - | Alpine + Samba |
| os-worker1.openshift4.positiva.gov.co | 172.20.0.19 | - | Alpine |
| aranda.positiva.gov.co | 172.20.0.20 | 8083 | nginx web |

## Uso

### 1. Levantar los servidores:
```bash
cd Mock-Servers
docker compose up -d
```

### 2. Verificar que están corriendo:
```bash
docker compose ps
```

### 3. Probar conectividad:
```bash
# Ping a un servidor
ping 172.20.0.11

# Ver web de posmvdc1
curl http://localhost:8081

# Ver web de aranda
curl http://localhost:8083
```

### 4. Monitorear desde n8n:

Crea un workflow que:
- Cada 5 minutos hace ping a cada IP `172.20.0.11-20`
- Verifica servicios HTTP en puertos 8081, 8082, 8083
- Guarda resultados en PostgreSQL
- Alerta si alguno no responde

### 5. Importar a SolarWinds:

Usa la API SWIS para agregar cada servidor:
```javascript
// En n8n nodo HTTP Request
POST https://tu-solarwinds:17778/SolarWinds/InformationService/v3/Json/Create/Orion.Nodes
{
  "IPAddress": "172.20.0.11",
  "Caption": "posmvdc1.positiva.col",
  "EngineID": 1,
  "ObjectSubType": "ICMP"
}
```

### 6. DNS Local (opcional):

Agrega a `C:\Windows\System32\drivers\etc\hosts`:
```
172.20.0.11  posmvdc1.positiva.col
172.20.0.12  positivadb05.positiva.col
172.20.0.13  jboss1.positiva.col
172.20.0.14  posredis.positiva.col
172.20.0.15  posmvbackups.positiva.col
172.20.0.16  sapalt.positiva.col
172.20.0.17  weblogic1.positiva.col
172.20.0.18  posfileserver.positiva.col
172.20.0.19  os-worker1.openshift4.positiva.gov.co
172.20.0.20  aranda.positiva.gov.co
```

Luego podrás hacer:
```bash
ping posmvdc1.positiva.col
curl http://aranda.positiva.gov.co:8083
```

## Detener los servidores:
```bash
docker compose down
```

## Ver logs de un servidor:
```bash
docker logs posmvdc1.positiva.col --tail 50 -f
```

---

**Ventajas:**
- Sin VPN: acceso local directo
- Rápido: levanta en 30 segundos
- Escalable: agrega más servicios editando `docker-compose.yml`
- Realista: responden a ping, HTTP, tienen IPs fijas

**Listo para:** pruebas de workflows n8n, importación a SolarWinds, simulación de incidentes.
