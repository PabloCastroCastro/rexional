#!/usr/bin/env bash
# Certificado HTTPS de Tailscale para el servidor (docs/servidor.md). Se ejecuta como root.
#
#   sudo scripts/renovar-cert.sh raspberry.tu-tailnet.ts.net
#
# Lo pide (o lo renueva: caduca a los 90 días) con tailscale cert, lo deja en /opt/vestuario/certs
# con la clave legible solo por el usuario 101 (nginx sin privilegios del proxy) y recarga nginx en
# los entornos que estén en marcha. Lo lanza un cron semanal; tailscale cert solo lo cambia cuando
# toca renovarlo.

set -euo pipefail

main() {
  local dominio=${1:-}
  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  local certs="$raiz/certs"

  [[ "$dominio" == *.ts.net ]] || error "Uso: $0 nombre-del-servidor.tu-tailnet.ts.net"
  [[ $EUID -eq 0 ]] || error "Hay que ejecutarlo como root (sudo)"

  mkdir -p "$certs"
  tailscale cert --cert-file "$certs/cert.pem" --key-file "$certs/key.pem" "$dominio"
  chown 101:101 "$certs/key.pem"
  chmod 600 "$certs/key.pem"
  chmod 644 "$certs/cert.pem"
  echo "Certificado de $dominio en $certs ($(openssl x509 -enddate -noout -in "$certs/cert.pem"))"

  local entorno
  for entorno in pruebas pro; do
    [[ -f "$raiz/$entorno/.env" ]] || continue
    local compose=(docker compose -p "vestuario-$entorno" -f docker-compose.yml -f docker-compose.servidor.yml)
    if (cd "$raiz/$entorno" && "${compose[@]}" ps --status running --services | grep -qx proxy); then
      (cd "$raiz/$entorno" && "${compose[@]}" exec -T proxy nginx -s reload)
      echo "nginx recargado en $entorno"
    fi
  done
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
exit
