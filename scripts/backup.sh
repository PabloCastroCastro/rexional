#!/usr/bin/env bash
# Copia de seguridad de un entorno (docs/operacion.md).
#
#   scripts/backup.sh pro
#
# 1. Base de datos: pg_dump comprimido desde el contenedor de PostgreSQL, comprobado antes de darlo
#    por bueno, en /opt/vestuario/backups/vestuario-<entorno>-AAAAMMDD-HHMMSS.sql.gz.
# 2. Subidas (escudos, fotos y vídeos): copia incremental del volumen en
#    /opt/vestuario/backups/subidas-<entorno>/; solo se copian los archivos nuevos o cambiados.
# 3. Rotación de las copias de la base de datos (scripts/rotar-copias.sh).
# 4. Espacio en disco: avisa si quedan menos de VESTUARIO_MIN_LIBRE_GB (5 por defecto).
#
# Lo usan deploy.sh (antes de desplegar en pro) y el cron diario, que lo apunta todo en
# /opt/vestuario/backups/backup.log. Los fallos salen con «ERROR» y los avisos con «AVISO». Desde
# ahí, el PC se trae las copias (scripts/traer-copias.ps1): así hay una copia fuera del servidor.

set -euo pipefail

main() {
  local entorno=${1:-pro}
  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}
  local minimo=${VESTUARIO_MIN_LIBRE_GB:-5}
  local dir="$raiz/$entorno"
  local destino="$raiz/backups"
  local scripts
  scripts=$(dirname "$(readlink -f "$0")")

  [[ "$entorno" =~ ^(pruebas|pro)$ ]] || error "Uso: $0 pruebas | pro"
  [[ -d "$dir" ]] || error "No existe $dir"
  mkdir -p "$destino"
  registro "Copia de $entorno"

  # 1. Base de datos
  local archivo
  archivo="$destino/vestuario-$entorno-$(date '+%Y%m%d-%H%M%S').sql.gz"
  temporal="$archivo.parcial"
  # Usuario y base de datos del propio contenedor: no hace falta leer el .env
  (cd "$dir" && docker compose -p "vestuario-$entorno" -f docker-compose.yml -f docker-compose.servidor.yml \
    exec -T db sh -c 'pg_dump --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB"') | gzip >"$temporal" ||
    error "pg_dump ha fallado"
  # Una copia que no se puede descomprimir o sin datos no sirve: se descarta
  gzip --test "$temporal" || error "La copia está dañada"
  zcat "$temporal" | grep -q 'PostgreSQL database dump complete' || error "La copia está incompleta"
  mv "$temporal" "$archivo"
  chmod 600 "$archivo"
  registro "Base de datos: $archivo ($(du -h "$archivo" | cut -f1))"

  # 2. Subidas: el volumen, de solo lectura, en un contenedor con el usuario del servidor (el mismo
  # uid que el del backend). cp -u copia solo lo nuevo o cambiado; lo borrado se conserva en la copia.
  local subidas="$destino/subidas-$entorno"
  mkdir -p "$subidas"
  docker run --rm --user "$(id -u):$(id -g)" --entrypoint cp \
    -v "vestuario-${entorno}_uploads:/origen:ro" -v "$subidas:/destino" \
    postgres:18-alpine -a -u /origen/. /destino/ ||
    error "La copia de las subidas ha fallado"
  registro "Subidas: $subidas ($(du -sh "$subidas" | cut -f1))"

  # 3. Rotación
  "$scripts/rotar-copias.sh" "$destino" "$entorno"

  # 4. Espacio libre
  local libre
  libre=$(df -BG --output=avail "$raiz" | tail -1 | tr -dc '0-9')
  if ((libre < minimo)); then
    registro "AVISO: quedan $libre GB libres en el disco del servidor (mínimo $minimo GB)"
  else
    registro "Disco: $libre GB libres"
  fi
}

registro() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

error() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: $1" >&2
  rm -f "${temporal:-}"
  exit 1
}

temporal=''
main "$@"
exit
