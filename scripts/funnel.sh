#!/usr/bin/env bash
# Publicación de producción en internet con Tailscale Funnel (GH-56, docs/servidor.md). Como root:
#
#   sudo scripts/funnel.sh activar     publica producción en https://<servidor>:10000
#   sudo scripts/funnel.sh quitar      deja de publicarla al momento (vuelve a ser solo del servidor)
#   sudo scripts/funnel.sh estado      qué se publica y si solo es producción
#
# Funnel solo admite los puertos 443, 8443 y 10000, y en el servidor 443 y 8443 están ocupados. El
# TLS lo termina Tailscale con su certificado, que renueva solo, y reenvía al proxy de producción por
# 127.0.0.1. La configuración se guarda en tailscaled y se mantiene tras reiniciar. Desde el tailnet
# también se entra por el 10000: es el único origen de producción (URL_PUBLICA).

set -euo pipefail

PUERTO_FUNNEL=10000

main() {
  [[ $EUID -eq 0 ]] || error "Hay que ejecutarlo como root (sudo)"
  command -v tailscale >/dev/null || error "No está instalado Tailscale"
  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  ENV="$raiz/pro/.env"
  case "${1:-}" in
    activar) activar ;;
    quitar) quitar ;;
    estado) estado ;;
    *) error "Uso: $0 activar | quitar | estado" ;;
  esac
}

activar() {
  [[ -f "$ENV" ]] || error "Falta $ENV"
  local puerto ip url nombre
  puerto=$(valor PUERTO)
  ip=$(valor IP_PUBLICADA)
  url=$(valor URL_PUBLICA)
  nombre=$(tailscale status --json | python3 -c 'import json, sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')

  [[ -n "$puerto" ]] || error "Falta PUERTO en $ENV"
  [[ "$ip" == 127.0.0.1 ]] ||
    error "Pon IP_PUBLICADA=127.0.0.1 en $ENV y despliega: así solo se entra a producción por Funnel"
  [[ "$url" == "https://$nombre:$PUERTO_FUNNEL" ]] ||
    error "URL_PUBLICA tiene que ser https://$nombre:$PUERTO_FUNNEL en $ENV (y desplegar), no $url"
  ss -tlnH "sport = :$puerto" | awk '{print $4}' | grep -qxF "127.0.0.1:$puerto" ||
    error "Producción no escucha solo en 127.0.0.1:$puerto: despliega con IP_PUBLICADA=127.0.0.1"
  curl --fail --silent --show-error --insecure --max-time 10 "https://127.0.0.1:$puerto/api/health" >/dev/null ||
    error "Producción no responde en https://127.0.0.1:$puerto"

  tailscale funnel --bg --yes --https="$PUERTO_FUNNEL" "https+insecure://127.0.0.1:$puerto"
  echo
  estado
}

quitar() {
  tailscale funnel --https="$PUERTO_FUNNEL" off
  echo "Producción ya no está publicada en internet."
  echo
  estado
}

estado() {
  local salida
  salida=$(tailscale funnel status 2>&1 || true)
  echo "$salida"
  # Lo publicado en internet aparece con «(Funnel on)»
  local publicado
  publicado=$(grep -F '(Funnel on)' <<<"$salida" || true)
  if [[ -z "$publicado" ]]; then
    echo "== Nada publicado en internet"
  elif grep -qv ":$PUERTO_FUNNEL " <<<"$publicado"; then
    echo "== ATENCIÓN: hay algo publicado en internet que no es el puerto $PUERTO_FUNNEL" >&2
    return 1
  else
    echo "== En internet solo está producción (puerto $PUERTO_FUNNEL)"
  fi
}

# Valor de una variable del .env de producción (vacío si no está)
valor() {
  { grep -E "^$1=" "$ENV" || true; } | tail -n 1 | cut -d= -f2-
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
