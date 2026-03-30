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

echo "=== PASO 1: Extrayendo certificado del proxy para registry-1.docker.io ==="
echo | openssl s_client -connect registry-1.docker.io:443 -showcerts 2>/dev/null \
  | openssl x509 -outform PEM \
  | sudo tee /usr/local/share/ca-certificates/proxy-ca.crt > /dev/null
echo "✅ Certificado guardado en /usr/local/share/ca-certificates/proxy-ca.crt"

echo ""
echo "=== PASO 2: Agregando certificado al sistema operativo ==="
sudo update-ca-certificates
echo "✅ Certificados del sistema actualizados"

echo ""
echo "=== PASO 3: Agregando certificado específicamente a Docker ==="
sudo mkdir -p /etc/docker/certs.d/registry-1.docker.io
sudo cp /usr/local/share/ca-certificates/proxy-ca.crt \
        /etc/docker/certs.d/registry-1.docker.io/ca.crt
echo "✅ Certificado agregado a Docker"

echo ""
echo "=== PASO 4: Reiniciando Docker ==="
sudo systemctl restart docker
echo "✅ Docker reiniciado"

echo ""
echo "=== PASO 5: Verificando que Docker puede conectarse a Docker Hub ==="
docker pull hello-world:latest --quiet && echo "✅ Docker Hub accesible" || echo "❌ Aún hay problemas de conexión"

echo ""
echo "=== LISTO: Ahora puedes levantar n8n con: ==="
echo "   docker compose up -d"
