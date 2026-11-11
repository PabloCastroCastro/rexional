#!/usr/bin/env python3
"""Resumen de los eventos de seguridad (GH-58) a partir de los logs, para scripts/informe-seguridad.sh.

Lee por la entrada estándar los logs del backend (JSON, una línea por evento; los de seguridad llevan
"seguridad": true) y del proxy (los «limiting requests» de nginx) y escribe el informe en texto.

    python3 informe_seguridad.py TÍTULO [USUARIOS] < logs

USUARIOS es un archivo opcional con «id|nombre|email» por línea, para poner nombre a los usuarios.
"""

import json
import re
import sys
from collections import Counter, defaultdict

NGINX_LIMITE = re.compile(r'limiting requests.*?by zone "(?P<zona>[^"]+)", client: (?P<ip>[^,]+),')


def leer_usuarios(ruta):
    usuarios = {}
    if not ruta:
        return usuarios
    with open(ruta, encoding="utf-8") as f:
        for linea in f:
            partes = linea.rstrip("\n").split("|")
            if len(partes) >= 3:
                usuarios[partes[0]] = f"{partes[1]} <{partes[2]}>"
    return usuarios


def leer(lineas):
    eventos, nginx = [], []
    for linea in lineas:
        linea = linea.strip()
        if linea.startswith("{"):
            try:
                datos = json.loads(linea)
            except json.JSONDecodeError:
                continue
            if datos.get("seguridad") is True and "evento" in datos:
                eventos.append(datos)
            continue
        m = NGINX_LIMITE.search(linea)
        if m:
            nginx.append((m.group("zona"), m.group("ip")))
    return eventos, nginx


def informe(titulo, eventos, nginx, usuarios):
    def quien(e):
        if e.get("usuarioId"):
            return usuarios.get(e["usuarioId"], f"usuario {e['usuarioId']}")
        if e.get("emailResumen"):
            return f"email desconocido ({e['emailResumen']})"
        return "desconocido"

    def persona(usuario_id):
        return usuarios.get(usuario_id, f"usuario {usuario_id}") if usuario_id else "?"

    por_tipo = defaultdict(list)
    for e in eventos:
        por_tipo[e["evento"]].append(e)

    salida = [titulo, "=" * len(titulo), ""]
    alertas = sum(
        len(por_tipo[t])
        for t in ("cuenta_bloqueada", "login_desde_nuevo_origen", "limite_superado", "origen_rechazado",
                  "csp_violada")
    )
    salida.append(f"Avisos: {alertas}" + ("" if alertas else " (nada que revisar)"))
    salida.append("")

    ok = por_tipo["login_ok"]
    salida.append(f"Logins correctos: {len(ok)} ({len({quien(e) for e in ok})} usuarios)")

    fallidos = por_tipo["login_fallido"]
    salida.append(f"Logins fallidos: {len(fallidos)}")
    for nombre, n in Counter(quien(e) for e in fallidos).most_common(10):
        salida.append(f"  {n:>4}  {nombre}")
    ips = Counter(e.get("ip", "?") for e in fallidos)
    if ips:
        salida.append("  Por IP:")
        for ip, n in ips.most_common(10):
            salida.append(f"  {n:>4}  {ip}")

    seccion(salida, "Cuentas bloqueadas", por_tipo["cuenta_bloqueada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} desde {e.get('ip', '?')}: "
                      f"{e.get('fallos')} fallos, {e.get('segundos')} s")
    seccion(salida, "Logins desde un origen nuevo", por_tipo["login_desde_nuevo_origen"],
            lambda e: f"{e.get('time', '')}  {quien(e)} desde {e.get('ip', '?')}"
                      f"{' (IP nueva)' if e.get('ipNueva') else ''}"
                      f"{' (navegador nuevo)' if e.get('navegadorNuevo') else ''}: {e.get('navegador', '')}")
    seccion(salida, "Límites superados en el backend", por_tipo["limite_superado"],
            lambda e: f"{e.get('time', '')}  {e.get('limite')}: "
                      f"{quien(e) if e.get('usuarioId') else e.get('ip', '?')} "
                      f"{e.get('metodo', '')} {e.get('ruta', '')}".rstrip())

    salida.append("")
    salida.append(f"Límites superados en nginx (peticiones rechazadas): {len(nginx)}")
    for (zona, ip), n in Counter(nginx).most_common(10):
        salida.append(f"  {n:>4}  {ip} ({zona})")

    seccion(salida, "Peticiones desde otro origen", por_tipo["origen_rechazado"],
            lambda e: f"{e.get('time', '')}  {e.get('origen')} desde {e.get('ip', '?')}: "
                      f"{e.get('metodo')} {e.get('ruta')}")
    seccion(salida, "Violaciones de la CSP", por_tipo["csp_violada"],
            lambda e: f"{e.get('time', '')}  {e.get('directiva')}: {e.get('bloqueado')} "
                      f"en {e.get('pagina')} desde {e.get('ip', '?')}")
    seccion(salida, "Contraseñas cambiadas", por_tipo["contrasena_cambiada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} desde {e.get('ip', '?')}")
    salida.append("")
    salida.append(f"Sesiones cerradas: {len(por_tipo['sesion_cerrada'])}")
    seccion(salida, "Invitaciones creadas", por_tipo["invitacion_creada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} invita como {e.get('rol')} "
                      f"a {e.get('emailResumen', '?')}")
    seccion(salida, "Invitaciones revocadas", por_tipo["invitacion_revocada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} revoca la de {e.get('emailResumen', '?')}")
    seccion(salida, "Invitaciones aceptadas", por_tipo["invitacion_aceptada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} entra como {e.get('rol')}")
    seccion(salida, "Cuentas creadas", por_tipo["cuenta_creada"],
            lambda e: f"{e.get('time', '')}  {quien(e)} desde {e.get('ip', '?')}")
    seccion(salida, "Roles cambiados", por_tipo["rol_cambiado"],
            lambda e: f"{e.get('time', '')}  {quien(e)} pone a {persona(e.get('miembroId'))} "
                      f"como {e.get('rol')}")
    seccion(salida, "Accesos retirados", por_tipo["acceso_retirado"],
            lambda e: f"{e.get('time', '')}  {quien(e)} retira a {persona(e.get('miembroId'))}")
    seccion(salida, "Administradores del club retirados", por_tipo["admin_club_retirado"],
            lambda e: f"{e.get('time', '')}  {quien(e)} retira a {persona(e.get('retiradoId'))}")
    return "\n".join(salida) + "\n"


def seccion(salida, titulo, eventos, linea):
    salida.append("")
    salida.append(f"{titulo}: {len(eventos)}")
    for e in eventos[-20:]:
        salida.append(f"  {linea(e)}")
    if len(eventos) > 20:
        salida.append(f"  … y {len(eventos) - 20} más antes")


def main():
    if len(sys.argv) < 2:
        sys.exit(f"Uso: {sys.argv[0]} TÍTULO [USUARIOS] < logs")
    usuarios = leer_usuarios(sys.argv[2] if len(sys.argv) > 2 else None)
    eventos, nginx = leer(sys.stdin)
    sys.stdout.write(informe(sys.argv[1], eventos, nginx, usuarios))


if __name__ == "__main__":
    main()
