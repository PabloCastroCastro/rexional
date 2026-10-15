#!/usr/bin/env bash
# Despliegue de Vestuario en el servidor (docs/servidor.md).
#
#   scripts/deploy.sh pruebas           lo último de develop, en /opt/vestuario/pruebas
#   scripts/deploy.sh pro v1.0.0        ese tag, en /opt/vestuario/pro, con copia de seguridad antes
#
# Compila las imágenes, levanta los servicios (el backend aplica las migraciones al arrancar), espera
# a que estén sanos y comprueba /api/health por HTTPS. Apunta cada despliegue, bien o mal, en
# /opt/vestuario/deploys.log.
#
# Todo va dentro de main y se llama al final: bash lee el script entero antes de ejecutarlo, así que
# el checkout que cambia este mismo archivo no afecta al despliegue en curso.

set -euo pipefail

main() {
  local entorno=${1:-}
  local tag=${2:-}
  local raiz=${VESTUARIO_RAIZ:-/opt/vestuario}

  case "$entorno" in
    pruebas) [[ -z "$tag" ]] || error "pruebas despliega siempre lo último de develop, sin tag" ;;
    pro) [[ "$tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || error "Uso: $0 pro vX.Y.Z" ;;
    *) error "Uso: $0 pruebas | $0 pro vX.Y.Z" ;;
  esac

  local dir="$raiz/$entorno"
  [[ -d "$dir/.git" ]] || error "No existe el clon de $entorno en $dir"
  [[ -f "$dir/.env" ]] || error "Falta $dir/.env (copia .env.example y rellénalo)"
  cd "$dir"

  local registro="$raiz/deploys.log"
  local proyecto="vestuario-$entorno"
  local compose=(docker compose -p "$proyecto" -f docker-compose.yml -f docker-compose.servidor.yml)
  local puerto
  puerto=$(grep -E '^PUERTO=' .env | cut -d= -f2)
  [[ -n "$puerto" ]] || error "Falta PUERTO en $dir/.env"

  local anterior
  anterior=$(git rev-parse --short HEAD)
  # Si algo falla a partir de aquí, queda apuntado en el registro
  trap 'apuntar "$registro" "$entorno" "${ref:-?}" "$anterior" FALLO; echo "El despliegue ha fallado" >&2' ERR

  echo "== Código"
  git fetch --quiet --tags origin
  local ref
  if [[ "$entorno" == pruebas ]]; then
    ref=develop
    git checkout --quiet develop
    git reset --quiet --hard origin/develop
  else
    ref=$tag
    git rev-parse --quiet --verify "refs/tags/$tag" >/dev/null || error "No existe el tag $tag"
    echo "== Copia de seguridad antes de desplegar"
    if "${compose[@]}" ps --status running --services | grep -qx db; then
      "$dir/scripts/backup.sh" pro
    else
      echo "Primer despliegue: aún no hay base de datos que copiar"
    fi
    git checkout --quiet "tags/$tag"
  fi
  echo "$anterior → $(git rev-parse --short HEAD) ($ref)"

  echo "== Imágenes y servicios"
  "${compose[@]}" up -d --build --wait --wait-timeout 300 --remove-orphans

  echo "== Comprobación"
  # El certificado es del nombre del servidor en Tailscale, no de localhost: -k solo aquí
  curl --fail --silent --show-error --insecure --max-time 10 "https://localhost:$puerto/api/health"
  echo

  apuntar "$registro" "$entorno" "$ref" "$anterior" OK
  trap - ERR
  echo "Desplegado $entorno ($ref)"
}

error() {
  echo "$1" >&2
  exit 1
}

# fecha · entorno · ref · commit anterior → commit actual · resultado
apuntar() {
  printf '%s\t%s\t%s\t%s → %s\t%s\n' "$(date '+%F %T')" "$2" "$3" "$4" \
    "$(git rev-parse --short HEAD 2>/dev/null || echo '?')" "$5" >>"$1"
}

main "$@"
exit
