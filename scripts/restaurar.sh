#!/usr/bin/env bash
# Restaura una copia de seguridad en un entorno (docs/operacion.md).
#
#   scripts/restaurar.sh pruebas /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz
#   scripts/restaurar.sh pro     /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz --produccion
#
# Para el backend, vacía la base de datos del entorno, carga la copia y vuelve a arrancar el backend,
# que aplica las migraciones que falten si la copia es de una versión anterior. Con
# --subidas DIRECTORIO, también copia las subidas (p. ej. /opt/vestuario/backups/subidas-pro) al
# volumen del entorno. En producción hay que pedirlo expresamente con --produccion: se pierde todo
# lo posterior a la copia (antes, haz una copia con scripts/backup.sh pro).

set -euo pipefail

main() {
  local entorno=${1:-}
  local copia=${2:-}
  shift 2 || true
  local produccion=false subidas=''
  while (($#)); do
    case "$1" in
      --produccion) produccion=true ;;
      --subidas)
        subidas=${2:-}
        shift
        ;;
      *) error "Opción desconocida: $1" ;;
    esac
    shift
  done

  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  [[ "$entorno" =~ ^(pruebas|pro)$ && -n "$copia" ]] ||
    error "Uso: $0 pruebas|pro COPIA.sql.gz [--subidas DIRECTORIO] [--produccion]"
  [[ "$entorno" != pro || "$produccion" == true ]] ||
    error "Restaurar en producción borra lo posterior a la copia: añade --produccion si es lo que quieres"
  [[ -f "$copia" ]] || error "No existe la copia $copia"
  [[ -z "$subidas" || -d "$subidas" ]] || error "No existe el directorio de subidas $subidas"
  gzip --test "$copia" || error "La copia está dañada"
  zcat "$copia" | grep -q 'PostgreSQL database dump complete' || error "La copia está incompleta"

  local dir="$raiz/$entorno"
  [[ -d "$dir" ]] || error "No existe $dir"
  cd "$dir"
  local compose=(docker compose -p "vestuario-$entorno" -f docker-compose.yml -f docker-compose.servidor.yml)
  registro "Restaurando $(basename "$copia") en $entorno"
  "${compose[@]}" up -d --wait db
  "${compose[@]}" stop backend

  # Base de datos nueva y vacía, y la copia dentro. Las variables se expanden en el contenedor.
  # shellcheck disable=SC2016
  "${compose[@]}" exec -T db sh -c \
    'dropdb --force -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
  # shellcheck disable=SC2016
  zcat "$copia" | "${compose[@]}" exec -T db sh -c \
    'psql -v ON_ERROR_STOP=1 -q -U "$POSTGRES_USER" "$POSTGRES_DB"' >/dev/null
  registro "Base de datos restaurada"

  if [[ -n "$subidas" ]]; then
    docker run --rm --user "$(id -u):$(id -g)" --entrypoint cp \
      -v "$(readlink -f "$subidas"):/origen:ro" -v "vestuario-${entorno}_uploads:/destino" \
      postgres:18-alpine -a /origen/. /destino/
    registro "Subidas restauradas desde $subidas"
  fi

  "${compose[@]}" up -d --wait --wait-timeout 180
  local puerto
  puerto=$(grep -E '^PUERTO=' .env | cut -d= -f2)
  curl -fsSk "https://localhost:$puerto/api/health" | grep -q '"estado":"ok"' ||
    error "El entorno no responde bien después de restaurar"
  registro "Restaurado: $entorno responde"
}

registro() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
  exit 1
}

main "$@"
exit
