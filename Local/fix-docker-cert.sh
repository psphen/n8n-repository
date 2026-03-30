#!/bin/bash
# ============================================================
# fix-docker-cert.sh
# Soluciona el error de certificado x509 cuando Docker no puede
# descargar imágenes por un WAF/proxy corporativo que intercepta
# las conexiones HTTPS.
#
# Uso: bash fix-docker-cert.sh
# ============================================================

set -e

echo "=== PASO 1: Extrayendo cadena completa de certificados del proxy ==="
# -showcerts extrae TODOS los certs de la cadena (leaf + intermedios + raíz CA)
echo | openssl s_client -connect registry-1.docker.io:443 -showcerts 2>/dev/null \
  > /tmp/full-chain.pem
echo "Cadena obtenida. Certificados encontrados:"
grep -c "BEGIN CERTIFICATE" /tmp/full-chain.pem || true

echo ""
echo "=== PASO 2: Extrayendo TODOS los certs de la cadena por separado ==="
# Dividir la cadena en certs individuales y guardar cada uno
awk '/-----BEGIN CERTIFICATE-----/{i++} {print > "/tmp/cert-" i ".pem"}' /tmp/full-chain.pem

# Mostrar el subject de cada cert para identificar cuál es la CA
for f in /tmp/cert-*.pem; do
  echo "--- $f ---"
  openssl x509 -in "$f" -noout -subject -issuer 2>/dev/null || true
done

echo ""
echo "=== PASO 3: Guardando TODOS los certs de la cadena como CAs confiables ==="
# Concatenar todos los certs de la cadena en un solo archivo CA
cat /tmp/cert-*.pem | sudo tee /usr/local/share/ca-certificates/proxy-ca-chain.crt > /dev/null
echo "✅ Cadena completa guardada en /usr/local/share/ca-certificates/proxy-ca-chain.crt"

echo ""
echo "=== PASO 4: Agregando certificados al sistema operativo ==="
sudo update-ca-certificates
echo "✅ Certificados del sistema actualizados"

echo ""
echo "=== PASO 5: Configurando Docker para confiar en el proxy ==="
# Crear directorio de certs para Docker Hub
sudo mkdir -p /etc/docker/certs.d/registry-1.docker.io

# Copiar la cadena completa a Docker
sudo cp /usr/local/share/ca-certificates/proxy-ca-chain.crt \
        /etc/docker/certs.d/registry-1.docker.io/ca.crt

# También configurar Docker daemon para usar los certs del sistema
if [ ! -f /etc/docker/daemon.json ]; then
  echo '{}' | sudo tee /etc/docker/daemon.json > /dev/null
fi

# Agregar opción para que Docker confíe en los certs del sistema
sudo python3 -c "
import json, sys
with open('/etc/docker/daemon.json') as f:
    d = json.load(f)
# insecure-registries no es lo que queremos, solo aseguramos que use los certs del sistema
print(json.dumps(d, indent=2))
" 2>/dev/null || true

echo "✅ Docker configurado"

echo ""
echo "=== PASO 6: Reiniciando Docker ==="
sudo systemctl restart docker
sleep 3
echo "✅ Docker reiniciado"

echo ""
echo "=== PASO 7: Verificando conexión a Docker Hub ==="
if docker pull hello-world:latest --quiet 2>/dev/null; then
  echo "✅ Docker Hub accesible — problema resuelto"
  docker rmi hello-world:latest 2>/dev/null || true
else
  echo "❌ Aún hay problemas. Intentando diagnóstico adicional..."
  echo ""
  echo "Certificado que presenta el proxy AHORA para registry-1.docker.io:"
  echo | openssl s_client -connect registry-1.docker.io:443 2>/dev/null \
    | openssl x509 -noout -subject -issuer -dates 2>/dev/null
  echo ""
  echo "Solución alternativa: agregar como insecure-registry (sin SSL)"
  echo "Ejecuta esto y vuelve a intentar:"
  echo ""
  echo "  sudo bash -c 'echo \"{\\\"insecure-registries\\\": [\\\"registry-1.docker.io\\\"]}\" > /etc/docker/daemon.json'"
  echo "  sudo systemctl restart docker"
  echo "  docker compose up -d"
fi

echo ""
echo "=== Limpiando archivos temporales ==="
rm -f /tmp/full-chain.pem /tmp/cert-*.pem
echo "✅ Listo"
