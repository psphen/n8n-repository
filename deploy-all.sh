#!/bin/bash
# deploy-all.sh - Despliega TODA la infraestructura n8n en orden correcto
#
# ORDEN DE DESPLIEGUE:
#   1. Redis        (10.114.158.75)  - Cola de trabajos
#   2. PostgreSQL   (10.114.158.77)  - Base de datos (con backup previo)
#   3. n8n Main 1   (10.114.158.71)  - Nodo principal
#   4. n8n Worker   (10.114.158.76)  - Ejecutor de flujos
#   5. n8n Main 2   (10.114.158.72)  - Nodo backup
#
# REQUISITOS:
#   - sshpass instalado: sudo apt-get install sshpass
#   - Ejecutar desde el directorio raíz del proyecto (donde está este script)
#
# USO:
#   chmod +x deploy-all.sh
#   ./deploy-all.sh

set -e

echo "============================================================"
echo "  DESPLIEGUE COMPLETO INFRAESTRUCTURA N8N - POSITIVA/ARTICS"
echo "============================================================"
echo ""

# Verificar sshpass
if ! command -v sshpass &> /dev/null; then
    echo "ERROR: sshpass no encontrado."
    echo "Instalar en Ubuntu/WSL: sudo apt-get install sshpass"
    echo "Instalar en macOS:      brew install sshpass"
    exit 1
fi

# Función helper para mostrar resultados
paso_ok() { echo "  [OK] $1"; }
paso_err() { echo "  [ERROR] $1"; exit 1; }

# ─────────────────────────────────────────────
# PASO 1: REDIS (10.114.158.75)
# ─────────────────────────────────────────────
echo "------------------------------------------------------------"
echo "PASO 1/5: Redis  →  10.114.158.75"
echo "------------------------------------------------------------"
cd "$(dirname "$0")/Redis"
bash deploy.sh
paso_ok "Redis desplegado"
cd "$(dirname "$0")"

echo ""
echo "Esperando 5 segundos antes del siguiente servicio..."
sleep 5

# ─────────────────────────────────────────────
# PASO 2: POSTGRESQL (10.114.158.77)
# ─────────────────────────────────────────────
echo "------------------------------------------------------------"
echo "PASO 2/5: PostgreSQL  →  10.114.158.77  (con backup previo)"
echo "------------------------------------------------------------"
cd "$(dirname "$0")/Postgres"
bash deploy.sh
paso_ok "PostgreSQL desplegado"
cd "$(dirname "$0")"

echo ""
echo "Esperando 10 segundos para asegurar que PostgreSQL esté listo..."
sleep 10

# ─────────────────────────────────────────────
# PASO 3: N8N MAIN 1 (10.114.158.71)
# ─────────────────────────────────────────────
echo "------------------------------------------------------------"
echo "PASO 3/5: n8n Main 1  →  10.114.158.71"
echo "------------------------------------------------------------"
cd "$(dirname "$0")/Main 1"
bash deploy.sh
paso_ok "n8n Main 1 desplegado"
cd "$(dirname "$0")"

echo ""
echo "Esperando 15 segundos para que n8n ejecute migraciones de DB..."
sleep 15

# ─────────────────────────────────────────────
# PASO 4: WORKER (10.114.158.76)
# ─────────────────────────────────────────────
echo "------------------------------------------------------------"
echo "PASO 4/5: n8n Worker  →  10.114.158.76"
echo "------------------------------------------------------------"
cd "$(dirname "$0")/Worker"
bash deploy.sh
paso_ok "n8n Worker desplegado"
cd "$(dirname "$0")"

echo ""
echo "Esperando 5 segundos..."
sleep 5

# ─────────────────────────────────────────────
# PASO 5: N8N MAIN 2 (10.114.158.72) - BACKUP
# ─────────────────────────────────────────────
echo "------------------------------------------------------------"
echo "PASO 5/5: n8n Main 2 (backup)  →  10.114.158.72"
echo "------------------------------------------------------------"
cd "$(dirname "$0")/Main 2"
bash deploy.sh
paso_ok "n8n Main 2 desplegado"
cd "$(dirname "$0")"

# ─────────────────────────────────────────────
# RESUMEN FINAL
# ─────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  DESPLIEGUE COMPLETADO"
echo "============================================================"
echo ""
echo "  Servicio          IP                  Puerto"
echo "  ─────────────────────────────────────────────"
echo "  Load Balancer     10.115.25.101        80"
echo "  n8n Main 1        10.114.158.71        5678"
echo "  n8n Main 2        10.114.158.72        5678  (backup)"
echo "  Redis             10.114.158.75        6379"
echo "  n8n Worker        10.114.158.76        -"
echo "  PostgreSQL        10.114.158.77        5432"
echo ""
echo "  Acceso a n8n UI:  http://10.115.25.101"
echo ""
echo "  Comandos útiles en cada servidor:"
echo "    sudo docker compose ps"
echo "    sudo docker compose logs -f"
echo "    sudo docker compose restart"
echo "============================================================"
