#!/bin/sh
# HTTPS en 8443 si hay certificado montado en /etc/nginx/certs (cert.pem y key.pem): en el servidor,
# el certificado de Tailscale (ver docs/servidor.md). Sin certificado, solo HTTP en 8080, como en la
# CI y en local. Se ejecuta al arrancar, después de procesar las plantillas.
set -eu

CERTS=/etc/nginx/certs
if [ ! -s "$CERTS/cert.pem" ] || [ ! -s "$CERTS/key.pem" ]; then
    echo "$0: sin certificado en $CERTS, solo HTTP en 8080"
    exit 0
fi

cat > /etc/nginx/conf.d/https.conf <<'NGINX'
server {
    listen 8443 ssl;
    http2 on;
    server_name _;

    ssl_certificate /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:5m;
    ssl_session_timeout 1d;

    include /etc/nginx/conf.d/vestuario.inc;
}
NGINX
echo "$0: HTTPS en 8443 con el certificado de $CERTS"
