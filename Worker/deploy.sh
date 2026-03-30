#!/bin/bash
# deploy.sh - Despliega n8n Worker en n8n-worker (10.114.158.76)
# Ejecutar desde WSL, Git Bash o Linux con sshpass instalado

set -e

SERVER_IP="10.114.158.76"
SERVER_USER="administrador"
SERVER_PASS="Temporal01#"
REMOTE_DIR="/opt/n8n-worker"

echo "=== Desplegando n8n Worker en $SERVER_IP ==="

# Verificar sshpass
if ! command -v sshpass &> /dev/null; then
    echo "ERROR: sshpass no encontrado. Instalar con: sudo apt-get install sshpass"
    exit 1
fi

# 1. Instalar Docker si no está presente
echo "[1/5] Verificando Docker..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    if ! command -v docker &> /dev/null; then
        echo 'Instalando Docker...'
        curl -fsSL https://get.docker.com | sudo sh
        sudo systemctl enable docker
        sudo systemctl start docker
    else
        echo 'Docker ya está instalado.'
    fi
"

# 2. Crear directorio remoto
echo "[2/5] Creando directorio $REMOTE_DIR..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" \
    "sudo mkdir -p $REMOTE_DIR && sudo chown $SERVER_USER:$SERVER_USER $REMOTE_DIR"

# 3. Copiar docker-compose.yml
echo "[3/5] Copiando docker-compose.yml..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no \
    docker-compose.yml "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/docker-compose.yml"

# 4. Detener servicio n8n worker existente
echo "[4/5] Deteniendo n8n worker systemd existente..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    sudo systemctl stop n8n 2>/dev/null || true
    sudo systemctl disable n8n 2>/dev/null || true
    echo 'Servicio n8n worker detenido.'
"

# 5. Levantar contenedor Docker
echo "[5/5] Levantando contenedor n8n Worker..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    cd $REMOTE_DIR
    sudo docker compose pull
    sudo docker compose up -d
    
    echo 'Esperando que el worker arranque...'
    sleep 10
    
    echo ''
    echo '--- Estado del contenedor ---'
    sudo docker compose ps
    
    echo ''
    echo '--- Logs iniciales (verificar conexión a Redis y Postgres) ---'
    sudo docker compose logs --tail=25
"

echo ""
echo "=== n8n Worker desplegado exitosamente en $SERVER_IP ==="
echo "    Concurrencia: 10 flujos simultáneos"
echo "    Sin interfaz web (modo worker puro)"
