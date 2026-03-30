#!/bin/bash
# deploy.sh - Despliega PostgreSQL en n8n-postgres (10.114.158.77)
# IMPORTANTE: Este script hace backup de la DB antes de dockerizar
# Ejecutar desde WSL, Git Bash o Linux con sshpass instalado

set -e

SERVER_IP="10.114.158.77"
SERVER_USER="administrador"
SERVER_PASS="Temporal01#"
REMOTE_DIR="/opt/n8n-postgres"
BACKUP_FILE="/tmp/n8n_db_backup_$(date +%Y%m%d_%H%M%S).sql"

echo "=== Desplegando PostgreSQL en $SERVER_IP ==="

# Verificar sshpass
if ! command -v sshpass &> /dev/null; then
    echo "ERROR: sshpass no encontrado. Instalar con: sudo apt-get install sshpass"
    exit 1
fi

# 1. Hacer backup de la base de datos ANTES de cualquier cambio
echo "[1/7] Haciendo backup de n8n_db en el servidor..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    echo 'Creando backup de n8n_db...'
    sudo -u postgres pg_dump n8n_db > $BACKUP_FILE
    echo 'Backup creado en: $BACKUP_FILE'
    ls -lh $BACKUP_FILE
"

# 2. Instalar Docker si no está presente
echo "[2/7] Verificando Docker..."
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

# 3. Crear directorio remoto
echo "[3/7] Creando directorio $REMOTE_DIR..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" \
    "sudo mkdir -p $REMOTE_DIR && sudo chown $SERVER_USER:$SERVER_USER $REMOTE_DIR"

# 4. Copiar archivos
echo "[4/7] Copiando archivos..."
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no \
    docker-compose.yml "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/docker-compose.yml"
sshpass -p "$SERVER_PASS" scp -o StrictHostKeyChecking=no \
    pg_hba.conf "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/pg_hba.conf"

# 5. Detener PostgreSQL existente
echo "[5/7] Deteniendo PostgreSQL existente..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    sudo systemctl stop postgresql 2>/dev/null || true
    sudo systemctl disable postgresql 2>/dev/null || true
    echo 'Servicio postgresql detenido.'
"

# 6. Levantar contenedor Docker
echo "[6/7] Levantando contenedor PostgreSQL..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    cd $REMOTE_DIR
    sudo docker compose pull
    sudo docker compose up -d
    
    echo 'Esperando que PostgreSQL esté listo...'
    RETRIES=15
    until sudo docker exec n8n-postgres pg_isready -U n8n_user 2>/dev/null || [ \$RETRIES -eq 0 ]; do
        echo \"  Esperando... (\$RETRIES intentos restantes)\"
        sleep 3
        RETRIES=\$((RETRIES-1))
    done
    
    if [ \$RETRIES -eq 0 ]; then
        echo 'ERROR: PostgreSQL no respondió a tiempo.'
        sudo docker compose logs postgres
        exit 1
    fi
    echo 'PostgreSQL listo.'
"

# 7. Restaurar backup
echo "[7/7] Restaurando backup de n8n_db..."
sshpass -p "$SERVER_PASS" ssh -o StrictHostKeyChecking=no "$SERVER_USER@$SERVER_IP" "
    echo 'Restaurando datos desde $BACKUP_FILE...'
    cat $BACKUP_FILE | sudo docker exec -i n8n-postgres psql -U n8n_user -d n8n_db
    echo 'Restauración completada.'
    
    echo ''
    echo '--- Estado del contenedor ---'
    cd $REMOTE_DIR && sudo docker compose ps
    
    echo ''
    echo '--- Verificación tablas n8n ---'
    sudo docker exec n8n-postgres psql -U n8n_user -d n8n_db -c \"\\dt\" 2>/dev/null | head -20
"

echo ""
echo "=== PostgreSQL desplegado exitosamente en $SERVER_IP:5432 ==="
echo "    Backup disponible en el servidor: $BACKUP_FILE"
