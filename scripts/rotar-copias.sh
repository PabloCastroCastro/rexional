#!/usr/bin/env bash
# Rotación de las copias de la base de datos de un entorno (docs/operacion.md).
#
#   scripts/rotar-copias.sh /opt/vestuario/backups pro
#
# Conserva todas las copias de hoy y de ayer (las de antes de un despliegue sirven para volver
# atrás) y, de las demás, la última de cada uno de los 7 últimos días, de las 4 últimas semanas y de
# los 6 últimos meses. Borra el resto. Las copias se llaman vestuario-<entorno>-AAAAMMDD-HHMMSS.sql.gz.
#
# VESTUARIO_HOY=AAAAMMDD fija la fecha de hoy (para los tests).

set -euo pipefail

main() {
  local dir=${1:-}
  local entorno=${2:-}
  [[ -d "$dir" && "$entorno" =~ ^(pruebas|pro)$ ]] || error "Uso: $0 DIRECTORIO pruebas|pro"

  local hoy ayer
  hoy=${VESTUARIO_HOY:-$(date '+%Y%m%d')}
  ayer=$(date -d "$hoy -1 day" '+%Y%m%d')

  local -A dias=() semanas=() meses=()
  local copias=()
  mapfile -t copias < <(find "$dir" -maxdepth 1 -type f -name "vestuario-$entorno-*.sql.gz" -printf '%f\n' |
    grep -E "^vestuario-$entorno-[0-9]{8}-[0-9]{6}\.sql\.gz$" | sort -r)

  local copia fecha semana mes conservar
  for copia in "${copias[@]}"; do
    fecha=${copia#"vestuario-$entorno-"}
    fecha=${fecha:0:8}
    semana=$(date -d "$fecha" '+%G%V')
    mes=${fecha:0:6}
    conservar=false
    [[ "$fecha" == "$hoy" || "$fecha" == "$ayer" ]] && conservar=true
    # De la más reciente a la más antigua: la primera de cada día, semana y mes es la última de ellos
    if [[ -z ${dias[$fecha]:-} && ${#dias[@]} -lt 7 ]]; then
      dias[$fecha]=1
      conservar=true
    fi
    if [[ -z ${semanas[$semana]:-} && ${#semanas[@]} -lt 4 ]]; then
      semanas[$semana]=1
      conservar=true
    fi
    if [[ -z ${meses[$mes]:-} && ${#meses[@]} -lt 6 ]]; then
      meses[$mes]=1
      conservar=true
    fi
    if [[ "$conservar" == false ]]; then
      rm -f -- "${dir:?}/$copia"
      echo "Rotación: borrada $copia"
    fi
  done
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
exit
