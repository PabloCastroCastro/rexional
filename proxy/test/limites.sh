#!/usr/bin/env bash
# Test del proxy (GH-58): IP real y límites de peticiones por IP. Arranca la imagen sin backend (las
# peticiones a /api que pasan el límite dan 502, las que no, 429):
#
#   proxy/test/limites.sh vestuario-proxy:ci
#
# - Desde el propio servidor (el puerto publicado, por la puerta de enlace de Docker), nginx se cree
#   X-Forwarded-For: es lo que hace Tailscale Funnel
# - Desde otro contenedor, la cabecera se ignora y vale la IP de la conexión
# - El login y las invitaciones admiten una ráfaga de 5 por IP y luego responden 429 con el error de
#   la API; otra IP tiene su propio límite

set -euo pipefail

imagen=${1:?Uso: $0 IMAGEN}
puerto=18089
nombre=vestuario-proxy-test-$$
fallos=0

docker run -d --rm --name "$nombre" -p "127.0.0.1:$puerto:8080" -e BACKEND_URL=http://127.0.0.1:9 "$imagen" >/dev/null
trap 'docker rm -f "$nombre" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  curl -sf "http://127.0.0.1:$puerto/nginx-health" >/dev/null && break
  sleep 1
done

comprobar() {
  if [[ "$2" == "$3" ]]; then
    echo "  bien   $1"
  else
    echo "  MAL    $1: «$2», se esperaba «$3»"
    fallos=$((fallos + 1))
  fi
}

ultima_ip() {
  docker logs "$nombre" 2>/dev/null | grep "$1" | tail -1 | awk '{print $1}'
}

echo "== IP real"
curl -s -o /dev/null -H 'X-Forwarded-For: 203.0.113.7' "http://127.0.0.1:$puerto/?desde-servidor"
sleep 1
comprobar "desde el servidor se cree X-Forwarded-For" "$(ultima_ip desde-servidor)" 203.0.113.7

ip_contenedor=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$nombre")
otra=$(docker run --rm alpine sh -c "ip -4 addr show eth0 | awk '/inet /{split(\$2, a, \"/\"); print a[1]}'; wget -q -O /dev/null --header 'X-Forwarded-For: 203.0.113.8' 'http://$ip_contenedor:8080/?desde-contenedor' 2>/dev/null || true")
sleep 1
comprobar "desde otro contenedor se ignora X-Forwarded-For" "$(ultima_ip desde-contenedor)" "$otra"

echo "== Límite del login por IP"
login() {
  curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Forwarded-For: $1" \
    -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$puerto/api/auth/sign-in/email"
}
estados=""
for _ in $(seq 1 8); do estados+="$(login 198.51.100.1) "; done
comprobar "ráfaga de 5 (más la primera) y después 429" "$estados" "502 502 502 502 502 502 429 429 "
comprobar "otra IP tiene su propio límite" "$(login 198.51.100.2)" 502

echo "== Límite de las invitaciones por IP"
invitacion() {
  curl -s -o /dev/null -w '%{http_code}' -X POST -H "X-Forwarded-For: $1" \
    -H 'Content-Type: application/json' -d '{}' "http://127.0.0.1:$puerto/api/invitaciones/aceptar"
}
estados=""
for _ in $(seq 1 8); do estados+="$(invitacion 198.51.100.3) "; done
comprobar "invitaciones: ráfaga de 5 (más la primera) y después 429" "$estados" "502 502 502 502 502 502 429 429 "
comprobar "invitaciones: otra IP tiene su propio límite" "$(invitacion 198.51.100.4)" 502

cuerpo=$(curl -s -X POST -H 'X-Forwarded-For: 198.51.100.1' "http://127.0.0.1:$puerto/api/auth/sign-in/email")
comprobar "el 429 lleva el error de la API" "$(grep -o '"codigo":"[a-z_]*"' <<<"$cuerpo")" '"codigo":"demasiadas_peticiones"'

if [[ $fallos -gt 0 ]]; then
  echo "$fallos comprobaciones fallan" >&2
  exit 1
fi
echo "Proxy: IP real y límites correctos"
