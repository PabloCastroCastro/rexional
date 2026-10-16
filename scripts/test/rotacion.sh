#!/usr/bin/env bash
# Test de scripts/rotar-copias.sh: con una copia diaria de marzo a octubre, dos copias hoy (la del
# cron y la de un despliegue) y archivos que no son copias de pro, quedan las de hoy y ayer, la
# última de los 7 últimos días, de las 4 últimas semanas y de los 6 últimos meses.

set -euo pipefail

raiz=$(dirname "$(readlink -f "$0")")/..
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

dia=20260301
while [[ "$dia" -le 20261015 ]]; do
  touch "$dir/vestuario-pro-$dia-033000.sql.gz"
  dia=$(date -d "$dia +1 day" '+%Y%m%d')
done
touch "$dir/vestuario-pro-20261016-084228.sql.gz" "$dir/vestuario-pro-20261016-090538.sql.gz"
touch "$dir/vestuario-pruebas-20260401-033000.sql.gz" "$dir/backup.log"

VESTUARIO_HOY=20261016 "$raiz/rotar-copias.sh" "$dir" pro >/dev/null

esperado=$(
  cat <<'FIN'
backup.log
vestuario-pro-20260531-033000.sql.gz
vestuario-pro-20260630-033000.sql.gz
vestuario-pro-20260731-033000.sql.gz
vestuario-pro-20260831-033000.sql.gz
vestuario-pro-20260927-033000.sql.gz
vestuario-pro-20260930-033000.sql.gz
vestuario-pro-20261004-033000.sql.gz
vestuario-pro-20261010-033000.sql.gz
vestuario-pro-20261011-033000.sql.gz
vestuario-pro-20261012-033000.sql.gz
vestuario-pro-20261013-033000.sql.gz
vestuario-pro-20261014-033000.sql.gz
vestuario-pro-20261015-033000.sql.gz
vestuario-pro-20261016-084228.sql.gz
vestuario-pro-20261016-090538.sql.gz
vestuario-pruebas-20260401-033000.sql.gz
FIN
)
archivos() {
  find "$dir" -mindepth 1 -printf '%f\n' | LC_ALL=C sort
}
quedan=$(archivos)

if [[ "$quedan" != "$esperado" ]]; then
  echo "La rotación no deja lo esperado:"
  diff <(echo "$esperado") <(echo "$quedan") || true
  exit 1
fi

# Repetirla no borra nada más
VESTUARIO_HOY=20261016 "$raiz/rotar-copias.sh" "$dir" pro >/dev/null
[[ "$(archivos)" == "$esperado" ]] || {
  echo "La segunda rotación ha borrado copias"
  exit 1
}
echo "Rotación correcta"
