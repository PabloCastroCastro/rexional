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

# HSTS (GH-57): afecta a todo el nombre del servidor, en cualquier puerto, también a las otras
# aplicaciones que compartan el nombre. Sin includeSubDomains ni preload; HSTS_MAX_AGE en segundos
HSTS_MAX_AGE=${HSTS_MAX_AGE:-86400}
case "$HSTS_MAX_AGE" in
    '' | *[!0-9]*) echo "$0: HSTS_MAX_AGE debe ser un número de segundos" >&2; exit 1 ;;
esac

# TLS con la configuración «intermediate» de Mozilla (sin los DHE, que necesitan parámetros propios)
cat > /etc/nginx/conf.d/https.conf <<NGINX
server {
    listen 8443 ssl;
    http2 on;
    server_name _;

    ssl_certificate /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:5m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    add_header Strict-Transport-Security "max-age=$HSTS_MAX_AGE" always;
    include /etc/nginx/conf.d/vestuario.inc;
}
NGINX
echo "$0: HTTPS en 8443 con el certificado de $CERTS (HSTS de $HSTS_MAX_AGE s)"
