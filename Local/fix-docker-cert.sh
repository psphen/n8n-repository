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
echo | openssl s_client -connect registry-1.docker.io:443 -showcerts 2>/dev/null \
  > /tmp/full-chain.pem

COUNT=$(grep -c "BEGIN CERTIFICATE" /tmp/full-chain.pem 2>/dev/null || echo "0")
echo "Certificados encontrados en la cadena: $COUNT"

echo ""
echo "=== PASO 2: Separando y guardando cada certificado ==="
# Separar cada cert individualmente
awk '
  /-----BEGIN CERTIFICATE-----/ { n++; f="/tmp/proxy-cert-" n ".pem" }
  f { print > f }
  /-----END CERTIFICATE-----/ { close(f); f="" }
' /tmp/full-chain.pem

# Mostrar info de cada cert encontrado
for f in /tmp/proxy-cert-*.pem; do
  [ -f "$f" ] || continue
  SUBJ=$(openssl x509 -in "$f" -noout -subject 2>/dev/null | sed 's/subject=//')
  ISSU=$(openssl x509 -in "$f" -noout -issuer  2>/dev/null | sed 's/issuer=//')
  echo "  Cert: $SUBJ"
  echo "  Firmado por: $ISSU"
  echo ""
done

echo "=== PASO 3: Agregando TODOS los certs de la cadena al sistema ==="
sudo cp /tmp/proxy-cert-*.pem /usr/local/share/ca-certificates/ 2>/dev/null || true
# Renombrar a .crt que es lo que acepta update-ca-certificates
for f in /usr/local/share/ca-certificates/proxy-cert-*.pem; do
  [ -f "$f" ] && sudo mv "$f" "${f%.pem}.crt" 2>/dev/null || true
done
sudo update-ca-certificates
echo "✅ Certificados del sistema actualizados"

echo ""
echo "=== PASO 4: Agregando certs directamente a Docker por registro ==="
sudo mkdir -p /etc/docker/certs.d/registry-1.docker.io
cat /tmp/proxy-cert-*.pem 2>/dev/null | sudo tee /etc/docker/certs.d/registry-1.docker.io/ca.crt > /dev/null
echo "✅ Certs agregados a Docker"

echo ""
echo "=== PASO 5: Configurando Docker para aceptar cert del WAF ==="
# insecure-registries: Docker sigue usando HTTPS pero acepta
# certificados firmados por CAs desconocidas (el WAF corporativo)
sudo bash -c 'cat > /etc/docker/daemon.json << '"'"'EOF'"'"'
{
  "insecure-registries": ["registry-1.docker.io"]
}
EOF'
echo "✅ daemon.json configurado"

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
  echo ""
  echo "Ahora puedes levantar n8n con:"
  echo "   docker compose up -d"
else
  echo "❌ Aún hay problemas. Diagnóstico:"
  echo ""
  echo "Cert que presenta el WAF en este momento:"
  echo | openssl s_client -connect registry-1.docker.io:443 2>/dev/null \
    | openssl x509 -noout -subject -issuer 2>/dev/null
  echo ""
  echo "Prueba manual — ejecuta esto y comparte el resultado:"
  echo "   curl -vk https://registry-1.docker.io/v2/ 2>&1 | head -40"
fi

echo ""
echo "=== Limpiando temporales ==="
rm -f /tmp/full-chain.pem /tmp/proxy-cert-*.pem
echo "Listo."
