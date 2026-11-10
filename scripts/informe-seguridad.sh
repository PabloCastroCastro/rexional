#!/usr/bin/env bash
# Informe de seguridad de un entorno (docs/servidor.md, «Informe de seguridad», GH-58):
#
#   scripts/informe-seguridad.sh pruebas|pro [--desde 24h] [--guardar]
#
# Resume los eventos de seguridad del backend (logins correctos y fallidos, cuentas bloqueadas,
# logins desde un origen nuevo, límites superados, peticiones desde otro origen…) y las peticiones
# que ha rechazado nginx por superar sus límites, en el periodo indicado (por defecto, 24 horas).
# Con --guardar lo deja además en /opt/vestuario/seguridad/ (y conserva los 30 últimos); así lo
# lanza el cron diario.
#
# Los logs son los de Docker (5 archivos de 10 MB por contenedor): si el periodo es muy largo, lo
# más antiguo puede no estar ya.

set -euo pipefail

CONSERVAR=30

main() {
  local entorno=${1:-} desde=24h guardar=false
  [[ "$entorno" == pruebas || "$entorno" == pro ]] || error "Uso: $0 pruebas|pro [--desde 24h] [--guardar]"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --desde) desde=${2:?Falta el periodo de --desde}; shift 2 ;;
      --guardar) guardar=true; shift ;;
      *) error "Opción desconocida: $1" ;;
    esac
  done

  local proyecto="vestuario-$entorno" raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  local backend proxy db
  backend=$(contenedor "$proyecto" backend)
  proxy=$(contenedor "$proyecto" proxy)
  db=$(contenedor "$proyecto" db)

  # Global: la limpieza se ejecuta al salir, cuando las variables locales ya no existen
  temporal=$(mktemp -d)
  trap 'rm -rf "$temporal"' EXIT
  # Nombre y email de los usuarios, para que el informe no sean solo identificadores
  # shellcheck disable=SC2016 # las variables son del contenedor
  docker exec "$db" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -F"|" -c "select id, name, email from \"user\""' \
    >"$temporal/usuarios" 2>/dev/null || true

  local titulo
  titulo="Informe de seguridad · $entorno · últimas $desde · $(date '+%F %H:%M')"
  local informe
  informe=$({
    docker logs --since "$desde" "$backend" 2>&1
    docker logs --since "$desde" "$proxy" 2>&1
  } | python3 "$(dirname "$(readlink -f "$0")")/informe_seguridad.py" "$titulo" "$temporal/usuarios")

  echo "$informe"
  if [[ "$guardar" == true ]]; then
    local dir="$raiz/seguridad"
    mkdir -p "$dir"
    chmod 700 "$dir"
    echo "$informe" >"$dir/informe-$entorno-$(date '+%Y%m%d-%H%M').txt"
    # Los 30 últimos de este entorno
    find "$dir" -maxdepth 1 -name "informe-$entorno-*.txt" | sort -r | tail -n +$((CONSERVAR + 1)) | xargs -r rm -f
  fi
}

contenedor() {
  local id
  id=$(docker ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2")
  [[ -n "$id" ]] || error "No está en marcha el $2 de $1"
  echo "$id"
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
