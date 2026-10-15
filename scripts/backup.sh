#!/usr/bin/env bash
# Copia de seguridad de la base de datos de un entorno (docs/servidor.md).
#
#   scripts/backup.sh pro        /opt/vestuario/backups/vestuario-pro-AAAAMMDD-HHMMSS.sql.gz
#
# pg_dump comprimido desde el contenedor de PostgreSQL, comprobado antes de darlo por bueno. Borra
# las copias de ese entorno de más de 14 días. Lo usan deploy.sh (antes de desplegar en pro) y el
# cron diario. Provisional hasta las copias completas del ciclo 8 (base de datos y medios, fuera del
# servidor).

set -euo pipefail

main() {
  local entorno=${1:-pro}
  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  local dias=${VESTUARIO_DIAS_COPIAS:-14}
  local dir="$raiz/$entorno"
  local destino="$raiz/backups"

  [[ "$entorno" =~ ^(pruebas|pro)$ ]] || error "Uso: $0 pruebas | pro"
  [[ -d "$dir" ]] || error "No existe $dir"
  mkdir -p "$destino"

  local archivo
  archivo="$destino/vestuario-$entorno-$(date '+%Y%m%d-%H%M%S').sql.gz"
  local temporal="$archivo.parcial"

  # Usuario y base de datos del propio contenedor: no hace falta leer el .env
  (cd "$dir" && docker compose -p "vestuario-$entorno" -f docker-compose.yml -f docker-compose.servidor.yml \
    exec -T db sh -c 'pg_dump --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"') | gzip >"$temporal"

  # Una copia que no se puede descomprimir o sin datos no sirve: se descarta
  gzip --test "$temporal" || error "La copia está dañada"
  zcat "$temporal" | grep -q 'PostgreSQL database dump complete' || error "La copia está incompleta"
  mv "$temporal" "$archivo"
  chmod 600 "$archivo"
  echo "Copia de seguridad: $archivo ($(du -h "$archivo" | cut -f1))"

  find "$destino" -name "vestuario-$entorno-*.sql.gz" -mtime "+$dias" -print -delete
}

error() {
  echo "$1" >&2
  rm -f "${temporal:-}"
  exit 1
}

main "$@"
exit
