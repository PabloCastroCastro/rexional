#!/usr/bin/env bash
# Test de scripts/informe_seguridad.py: con logs de ejemplo del backend y del proxy, el informe cuenta
# cada tipo de evento, pone nombre a los usuarios y no se confunde con las líneas que no son eventos.

set -euo pipefail

raiz=$(dirname "$(readlink -f "$0")")/..
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT

echo 'u1|Ana|ana@club.test' >"$dir/usuarios"
cat >"$dir/logs" <<'FIN'
{"level":30,"time":"2026-11-10T08:00:00Z","msg":"Petición","metodo":"GET","estado":200}
{"level":30,"time":"2026-11-10T08:01:00Z","seguridad":true,"evento":"login_ok","usuarioId":"u1","ip":"10.0.0.1"}
{"level":40,"time":"2026-11-10T08:02:00Z","seguridad":true,"evento":"login_fallido","emailResumen":"abc123","ip":"203.0.113.9","fallos":1}
{"level":40,"time":"2026-11-10T08:02:10Z","seguridad":true,"evento":"login_fallido","emailResumen":"abc123","ip":"203.0.113.9","fallos":2}
{"level":40,"time":"2026-11-10T08:02:20Z","seguridad":true,"evento":"login_fallido","usuarioId":"u1","ip":"203.0.113.9","fallos":1}
{"level":40,"time":"2026-11-10T08:03:00Z","seguridad":true,"evento":"cuenta_bloqueada","emailResumen":"abc123","ip":"203.0.113.9","fallos":5,"segundos":60}
{"level":40,"time":"2026-11-10T08:04:00Z","seguridad":true,"evento":"login_desde_nuevo_origen","usuarioId":"u1","ip":"198.51.100.4","navegador":"Firefox","ipNueva":true,"navegadorNuevo":false}
{"level":40,"time":"2026-11-10T08:05:00Z","seguridad":true,"evento":"limite_superado","limite":"general","usuarioId":"u1","ip":"10.0.0.1","metodo":"GET","ruta":"/api/clubes"}
{"level":30,"time":"2026-11-10T08:06:00Z","seguridad":true,"evento":"sesion_cerrada","usuarioId":"u1","ip":"10.0.0.1"}
no es json {
2026/11/10 08:07:00 [warn] 22#22: *9 limiting requests, excess: 5.120 by zone "login", client: 203.0.113.9, server: _, request: "POST /api/auth/sign-in/email HTTP/1.1"
2026/11/10 08:07:01 [warn] 22#22: *10 limiting requests, excess: 5.300 by zone "login", client: 203.0.113.9, server: _, request: "POST /api/auth/sign-in/email HTTP/1.1"
FIN

informe=$(python3 "$raiz/informe_seguridad.py" "Informe de prueba" "$dir/usuarios" <"$dir/logs")

fallos=0
espera() {
  if grep -qF -- "$1" <<<"$informe"; then
    echo "  bien   $1"
  else
    echo "  MAL    falta «$1»"
    fallos=$((fallos + 1))
  fi
}
espera "Avisos: 3"
espera "Logins correctos: 1 (1 usuarios)"
espera "Logins fallidos: 3"
espera "     2  email desconocido (abc123)"
espera "     1  Ana <ana@club.test>"
espera "     3  203.0.113.9"
espera "Cuentas bloqueadas: 1"
espera "Logins desde un origen nuevo: 1"
espera "Ana <ana@club.test> desde 198.51.100.4 (IP nueva): Firefox"
espera "Límites superados en el backend: 1"
espera "general: Ana <ana@club.test> GET /api/clubes"
espera "Límites superados en nginx (peticiones rechazadas): 2"
espera "     2  203.0.113.9 (login)"
espera "Sesiones cerradas: 1"

if [[ $fallos -gt 0 ]]; then
  echo "$informe"
  exit 1
fi
echo "Informe de seguridad correcto"
