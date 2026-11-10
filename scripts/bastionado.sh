#!/usr/bin/env bash
# Bastionado del sistema de la Raspberry (docs/servidor.md, «Bastionado del sistema»). Como root:
#
#   sudo scripts/bastionado.sh ssh             SSH solo con clave, sin root y solo el usuario actual
#   sudo scripts/bastionado.sh actualizaciones actualizaciones de seguridad automáticas
#   sudo scripts/bastionado.sh servicios       desactiva rpcbind (NFS), que no se usa
#   sudo scripts/bastionado.sh cortafuegos     carga el cortafuegos, con marcha atrás en 2 minutos
#   sudo scripts/bastionado.sh confirmar       lo deja fijo (también tras reiniciar)
#   sudo scripts/bastionado.sh quitar          lo retira del todo (emergencia)
#   sudo scripts/bastionado.sh comprobar       estado de todo lo anterior y del aislamiento (GH-55)
#
# Los archivos que instala están en scripts/servidor/. Se puede repetir sin problema: cada paso deja
# el sistema igual que si se ejecutara por primera vez.

set -euo pipefail

SERVIDOR=$(dirname "$(readlink -f "$0")")/servidor
TABLA=bastionado
MARCHA_ATRAS=bastionado-marcha-atras
SEGUNDOS_MARCHA_ATRAS=120

main() {
  [[ $EUID -eq 0 ]] || error "Hay que ejecutarlo como root (sudo)"
  case "${1:-}" in
    ssh) ssh_ ;;
    actualizaciones) actualizaciones ;;
    servicios) servicios ;;
    cortafuegos) cortafuegos ;;
    confirmar) confirmar ;;
    quitar) quitar ;;
    comprobar) comprobar ;;
    *) error "Uso: $0 ssh | actualizaciones | servicios | cortafuegos | confirmar | quitar | comprobar" ;;
  esac
}

ssh_() {
  local usuario=${SUDO_USER:-}
  [[ -n "$usuario" && "$usuario" != root ]] || error "Ejecútalo con sudo desde el usuario que administra el servidor"
  local claves
  claves=$(getent passwd "$usuario" | cut -d: -f6)/.ssh/authorized_keys
  [[ -s "$claves" ]] || error "$usuario no tiene claves en $claves: sin ellas no se podría volver a entrar"

  local destino=/etc/ssh/sshd_config.d/10-bastionado.conf
  local anterior
  anterior=$(mktemp)
  [[ -f "$destino" ]] && cp "$destino" "$anterior"
  { cat "$SERVIDOR/ssh-bastionado.conf"; echo; echo "AllowUsers $usuario"; } >"$destino"
  chmod 644 "$destino"

  if ! sshd -t; then
    restaurar "$destino" "$anterior"
    error "La configuración de SSH no es válida: no se ha aplicado"
  fi
  local efectiva
  efectiva=$(sshd -T)
  for opcion in 'passwordauthentication no' 'permitrootlogin no' "allowusers $usuario"; do
    if ! grep -qx "$opcion" <<<"$efectiva"; then
      restaurar "$destino" "$anterior"
      error "Otra configuración gana a «$opcion»: revisa /etc/ssh/sshd_config.d/"
    fi
  done
  rm -f "$anterior"
  systemctl reload ssh
  echo "SSH: solo con clave, sin root y solo $usuario."
  echo "Antes de cerrar esta sesión, comprueba desde otra terminal que puedes entrar."
}

restaurar() {
  if [[ -s "$2" ]]; then mv "$2" "$1"; else rm -f "$1" "$2"; fi
}

actualizaciones() {
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q unattended-upgrades >/dev/null
  install -m 644 "$SERVIDOR/20auto-upgrades" /etc/apt/apt.conf.d/20auto-upgrades
  install -m 644 "$SERVIDOR/52unattended-upgrades-bastionado" /etc/apt/apt.conf.d/52unattended-upgrades-bastionado
  systemctl enable --now apt-daily.timer apt-daily-upgrade.timer >/dev/null
  echo "Actualizaciones de seguridad automáticas activadas. Orígenes permitidos:"
  apt-config dump Unattended-Upgrade::Origins-Pattern | sed 's/^/  /'
}

servicios() {
  systemctl disable --now rpcbind.socket rpcbind.service 2>/dev/null || true
  systemctl mask rpcbind.socket rpcbind.service >/dev/null
  echo "rpcbind desactivado."
}

cortafuegos() {
  command -v nft >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -q nftables >/dev/null
  nft -c -f "$SERVIDOR/cortafuegos.nft" || error "Las reglas no son válidas: no se han aplicado"
  install -d -m 755 /etc/vestuario
  install -m 644 "$SERVIDOR/cortafuegos.nft" /etc/vestuario/cortafuegos.nft

  # Marcha atrás antes de cargarlo: si se pierde el acceso, en 2 minutos el cortafuegos se retira solo
  systemctl stop "$MARCHA_ATRAS.timer" 2>/dev/null || true
  systemctl reset-failed "$MARCHA_ATRAS.service" 2>/dev/null || true
  systemd-run --quiet --unit="$MARCHA_ATRAS" --on-active="$SEGUNDOS_MARCHA_ATRAS" \
    /usr/sbin/nft delete table inet "$TABLA"
  nft -f /etc/vestuario/cortafuegos.nft

  echo "Cortafuegos cargado. Se retirará solo en $SEGUNDOS_MARCHA_ATRAS segundos."
  echo "Comprueba desde otra terminal que entras por SSH y que las aplicaciones responden, y entonces:"
  echo "  sudo $0 confirmar"
}

confirmar() {
  nft list table inet "$TABLA" >/dev/null 2>&1 || error "El cortafuegos no está cargado: ejecuta antes «$0 cortafuegos»"
  systemctl stop "$MARCHA_ATRAS.timer" 2>/dev/null || true
  install -m 644 "$SERVIDOR/vestuario-cortafuegos.service" /etc/systemd/system/vestuario-cortafuegos.service
  systemctl daemon-reload
  systemctl enable vestuario-cortafuegos.service >/dev/null
  # Vuelve a cargar las reglas (cargarlas otra vez las sustituye) y deja el servicio como activo
  systemctl start vestuario-cortafuegos.service
  echo "Cortafuegos fijo: se carga también al arrancar."
}

quitar() {
  systemctl stop "$MARCHA_ATRAS.timer" 2>/dev/null || true
  systemctl disable --now vestuario-cortafuegos.service 2>/dev/null || true
  nft delete table inet "$TABLA" 2>/dev/null || true
  echo "Cortafuegos retirado."
}

comprobar() {
  echo "== SSH"
  sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin|allowusers|x11forwarding) '

  echo "== Actualizaciones automáticas"
  if dpkg -s unattended-upgrades >/dev/null 2>&1; then
    apt-config dump APT::Periodic::Unattended-Upgrade
    systemctl is-active apt-daily-upgrade.timer
    local registro=/var/log/unattended-upgrades/unattended-upgrades.log
    [[ -f "$registro" ]] && tail -n 3 "$registro"
  else
    echo "unattended-upgrades no está instalado"
  fi

  echo "== Cortafuegos"
  if nft list table inet "$TABLA" >/dev/null 2>&1; then
    echo "cargado ($(systemctl is-enabled vestuario-cortafuegos.service 2>/dev/null || echo 'sin fijar'))"
  else
    echo "NO cargado"
  fi
  systemctl is-active --quiet "$MARCHA_ATRAS.timer" && echo "pendiente de confirmar (marcha atrás activa)"

  echo "== Aislamiento de Vestuario"
  local entorno
  for entorno in pruebas pro; do
    if docker ps -q --filter "label=com.docker.compose.project=vestuario-$entorno" | grep -q .; then
      "$(dirname "$(readlink -f "$0")")/comprobar-aislamiento.sh" "$entorno" | tail -n 1 || true
    fi
  done

  echo "== rpcbind"
  systemctl is-enabled rpcbind.socket 2>/dev/null || true

  echo "== Puertos TCP en todas las interfaces"
  ss -tlnH | awk '{print $4}' | grep -E '^(0\.0\.0\.0|\[::\]|\*):' | sort -u | tr '\n' ' '
  echo

  echo "== Reinicio"
  if [[ -f /var/run/reboot-required ]]; then
    echo "PENDIENTE: $(tr '\n' ' ' </var/run/reboot-required.pkgs 2>/dev/null)"
  else
    echo "no hace falta"
  fi
}

error() {
  echo "$1" >&2
  exit 1
}

main "$@"
