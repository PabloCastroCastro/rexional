#!/usr/bin/env bash
# Comprueba desde dentro de los contenedores de un entorno que Vestuario está aislado del resto del
# servidor (docs/servidor.md, «Aislamiento de Vestuario», GH-55):
#
#   scripts/comprobar-aislamiento.sh pruebas|pro
#
# Desde el backend y el proxy intenta abrir conexiones TCP al servidor (por la puerta de enlace de
# sus redes, por la IP de la LAN y por la de Tailscale), a los contenedores de otras aplicaciones, al
# router y a internet, y desde el proxy a la base de datos. Todas tienen que fallar. Como control, el
# proxy tiene que llegar al backend y el backend a la base de datos. Sale con error si algo no está como debe.

set -euo pipefail

ESPERA=3

main() {
  local entorno=${1:-}
  [[ "$entorno" == pruebas || "$entorno" == pro ]] || error "Uso: $0 pruebas | pro"
  local proyecto="vestuario-$entorno"

  local backend proxy
  backend=$(contenedor "$proyecto" backend)
  proxy=$(contenedor "$proyecto" proxy)

  # Destinos que escuchan seguro, para que «no se llega» signifique bloqueado y no cerrado
  local lan tailscale router
  lan=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
  router=$(ip -4 route show default | awk '{print $3; exit}')
  tailscale=$(tailscale ip -4 2>/dev/null | head -1 || true)
  local puerto_ssh=22

  fallos=0
  echo "== Control (tiene que llegar)"
  probar si "$proxy" "proxy → backend" backend 3000
  probar si "$backend" "backend → db" db 5432

  echo "== Aislamiento (no tiene que llegar)"
  probar no "$proxy" "proxy → db" db 5432

  for c in "$backend" "$proxy"; do
    local nombre
    nombre=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$c")
    local red
    for red in $(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$c"); do
      local puerta
      puerta=$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' "$red")
      [[ -n "$puerta" ]] && probar no "$c" "$nombre → servidor por $red ($puerta:$puerto_ssh)" "$puerta" "$puerto_ssh"
    done
    probar no "$c" "$nombre → servidor por la LAN ($lan:$puerto_ssh)" "$lan" "$puerto_ssh"
    [[ -n "$tailscale" ]] && probar no "$c" "$nombre → servidor por Tailscale ($tailscale:$puerto_ssh)" "$tailscale" "$puerto_ssh"
    local publicado
    for publicado in $(puertos_ajenos "$proyecto"); do
      probar no "$c" "$nombre → puerto publicado de otra aplicación ($lan:$publicado)" "$lan" "$publicado"
    done
    local ajeno
    ajeno=$(contenedor_ajeno "$proyecto")
    # shellcheck disable=SC2086 # «IP PUERTO» son dos argumentos
    [[ -n "$ajeno" ]] && probar no "$c" "$nombre → contenedor de otra aplicación (${ajeno% *})" ${ajeno}
    probar no "$c" "$nombre → router ($router:80)" "$router" 80
    probar no "$c" "$nombre → internet (1.1.1.1:443)" 1.1.1.1 443
  done

  if [[ $fallos -gt 0 ]]; then
    echo "$fallos comprobaciones no son como deben" >&2
    exit 1
  fi
  echo "Vestuario ($entorno) está aislado"
}

# probar si|no CONTENEDOR DESCRIPCIÓN HOST PUERTO
probar() {
  local esperado=$1 c=$2 descripcion=$3 host=$4 puerto=$5 resultado
  if docker exec "$c" nc -z -w "$ESPERA" "$host" "$puerto" >/dev/null 2>&1; then resultado=si; else resultado=no; fi
  if [[ "$resultado" == "$esperado" ]]; then
    echo "  bien   $descripcion"
  else
    echo "  MAL    $descripcion (esperado: $esperado llega)"
    fallos=$((fallos + 1))
  fi
}

contenedor() {
  local id
  id=$(docker ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2")
  [[ -n "$id" ]] || error "No está en marcha el $2 de $1"
  echo "$id"
}

# Puertos TCP que publican en el host los contenedores de otros proyectos
puertos_ajenos() {
  docker ps --format '{{.Label "com.docker.compose.project"}} {{.Ports}}' |
    awk -v propio="$1" '$1 != propio' |
    grep -oE '0\.0\.0\.0:[0-9]+->' | grep -oE '[0-9]+' | sort -un
}

# IP y un puerto en el que escucha un contenedor de otro proyecto («IP PUERTO»), si lo hay
contenedor_ajeno() {
  local id
  for id in $(docker ps -q); do
    [[ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id")" == "$1" ]] && continue
    local ip puerto
    ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' "$id" | awk '{print $1}')
    puerto=$(docker inspect -f '{{range $p, $v := .Config.ExposedPorts}}{{$p}} {{end}}' "$id" | grep -oE '^[0-9]+/tcp' | head -1)
    if [[ -n "$ip" && -n "$puerto" ]]; then
      echo "$ip ${puerto%/tcp}"
      return
    fi
  done
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
