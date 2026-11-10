#!/usr/bin/env bash
# Test del proxy (GH-57): cabeceras de seguridad en todas las respuestas (la aplicación, la API, los
# errores de nginx y el 429 de los límites) y HSTS solo por HTTPS. Arranca la imagen sin backend:
#
#   proxy/test/cabeceras.sh vestuario-proxy:ci DIRECTORIO_CON_CERTIFICADO
#
# El directorio tiene cert.pem y key.pem (autofirmado), con la clave legible por el usuario 101.

set -euo pipefail

imagen=${1:?Uso: $0 IMAGEN DIRECTORIO_CON_CERTIFICADO}
certs=${2:?Falta el directorio (ruta absoluta) con el certificado}
http=18087
https=18088
nombre=vestuario-proxy-cabeceras-$$
fallos=0

docker run -d --rm --name "$nombre" -p "127.0.0.1:$http:8080" -p "127.0.0.1:$https:8443" \
  -e BACKEND_URL=http://127.0.0.1:9 -e HSTS_MAX_AGE=86400 -v "$certs:/etc/nginx/certs:ro" "$imagen" >/dev/null
trap 'docker rm -f "$nombre" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$http/nginx-health" >/dev/null && break
  sleep 1
done

CABECERAS=(
  "x-content-type-options: nosniff"
  "referrer-policy: strict-origin-when-cross-origin"
  "x-frame-options: DENY"
  "cross-origin-opener-policy: same-origin"
  "cross-origin-resource-policy: same-origin"
  "permissions-policy: camera=(), microphone=()"
  "content-security-policy: default-src 'self'; script-src 'self'; style-src 'self';"
  "frame-ancestors 'none'; report-uri /api/csp"
)

# comprobar DESCRIPCIÓN URL [opciones de curl…]
comprobar() {
  local descripcion=$1 url=$2
  shift 2
  local respuesta
  respuesta=$(curl -sk -o /dev/null -D - "$@" "$url" | tr -d '\r' | tr '[:upper:]' '[:lower:]')
  local esperada
  for esperada in "${CABECERAS[@]}"; do
    if ! grep -qF -- "$(tr '[:upper:]' '[:lower:]' <<<"$esperada")" <<<"$respuesta"; then
      echo "  MAL    $descripcion: falta «$esperada»"
      fallos=$((fallos + 1))
      return
    fi
  done
  echo "  bien   $descripcion"
}

hsts() {
  curl -sk -o /dev/null -D - "$1" | tr -d '\r' | { grep -i '^strict-transport-security:' || true; } | cut -d' ' -f2-
}

echo "== Cabeceras de seguridad"
comprobar "la aplicación (index.html)" "http://127.0.0.1:$http/"
comprobar "una ruta de la PWA" "http://127.0.0.1:$http/plantillas/p1"
comprobar "un recurso que no existe" "http://127.0.0.1:$http/assets/no-existe.js"
comprobar "la API sin backend (502)" "http://127.0.0.1:$http/api/clubes"
for _ in $(seq 1 7); do curl -s -o /dev/null -X POST "http://127.0.0.1:$http/api/auth/sign-in/email"; done
comprobar "el 429 del límite de peticiones" "http://127.0.0.1:$http/api/auth/sign-in/email" -X POST
comprobar "por HTTPS" "https://127.0.0.1:$https/"

echo "== HSTS"
valor=$(hsts "https://127.0.0.1:$https/")
if [[ "$valor" == "max-age=86400" ]]; then echo "  bien   por HTTPS: $valor"; else
  echo "  MAL    por HTTPS: «$valor», se esperaba «max-age=86400»"
  fallos=$((fallos + 1))
fi
valor=$(hsts "http://127.0.0.1:$http/")
if [[ -z "$valor" ]]; then echo "  bien   por HTTP no se envía"; else
  echo "  MAL    por HTTP se envía «$valor»"
  fallos=$((fallos + 1))
fi

if [[ $fallos -gt 0 ]]; then
  echo "$fallos comprobaciones fallan" >&2
  exit 1
fi
echo "Proxy: cabeceras de seguridad correctas"
