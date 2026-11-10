#!/bin/sh
# IP real del visitante (GH-58). Con Tailscale Funnel, las peticiones de internet llegan a nginx desde
# el propio servidor: tailscaled se conecta al puerto publicado y Docker las entrega desde la puerta
# de enlace de la red del proxy. La IP del visitante viene en X-Forwarded-For, que Tailscale
# sustituye (no añade) por la suya.
#
# Solo se cree esa cabecera cuando la conexión viene de la puerta de enlace, es decir, del propio
# servidor. Lo que llega de la LAN o del tailnet directamente al puerto publicado conserva su IP y
# su X-Forwarded-For se ignora, así que nadie puede hacerse pasar por otra IP. El resultado
# ($remote_addr) es el que usan los límites de peticiones, el registro y X-Real-IP hacia el backend.
set -eu

puerta=$(ip -4 route show default 2>/dev/null | awk '{print $3; exit}')
if [ -z "$puerta" ]; then
    echo "$0: sin puerta de enlace, la IP real es la de la conexión"
    exit 0
fi

cat > /etc/nginx/conf.d/ip-real.conf <<NGINX
set_real_ip_from $puerta;
real_ip_header X-Forwarded-For;
real_ip_recursive off;
NGINX
echo "$0: X-Forwarded-For solo desde $puerta (el propio servidor)"
