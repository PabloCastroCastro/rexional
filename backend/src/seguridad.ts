import { createHmac } from 'node:crypto'
import { config } from './config.js'
import { logger } from './logger.js'

// Eventos de seguridad (GH-58): una línea del log por evento, con «seguridad: true» para poder
// filtrarlos (scripts/informe-seguridad.sh). Llevan la IP real y, si se sabe, el usuario; nunca
// contraseñas, tokens ni emails (los que no son de ningún usuario van como resumen, ver resumenEmail).

export type EventoSeguridad =
  | 'login_ok'
  | 'login_fallido'
  | 'login_desde_nuevo_origen'
  | 'cuenta_bloqueada'
  | 'limite_superado'
  | 'origen_rechazado'
  | 'contrasena_cambiada'
  | 'sesion_cerrada'
  | 'csp_violada'
  | 'invitacion_creada'
  | 'invitacion_revocada'

// Los que indican un problema van como aviso; el resto, como información
const AVISOS = new Set<EventoSeguridad>([
  'login_fallido',
  'login_desde_nuevo_origen',
  'cuenta_bloqueada',
  'limite_superado',
  'origen_rechazado',
  'csp_violada',
])

export function registrarEvento(evento: EventoSeguridad, datos: Record<string, unknown> = {}) {
  const linea = { seguridad: true, evento, ...datos }
  if (AVISOS.has(evento)) logger.warn(linea, `Seguridad: ${evento}`)
  else logger.info(linea, `Seguridad: ${evento}`)
}

// IP del cliente: nginx pone en X-Real-IP la del visitante (también con Tailscale Funnel, ver
// proxy/docker-entrypoint.d/35-ip-real.sh). X-Forwarded-For no, porque la puede inventar el cliente
export const ipDe = (cabeceras: Headers) => cabeceras.get('x-real-ip') ?? 'desconocida'

// Navegador, recortado: basta para distinguir dispositivos
export const navegadorDe = (cabeceras: Headers) =>
  (cabeceras.get('user-agent') ?? 'desconocido').slice(0, 200)

// Resumen de un email (HMAC con el secreto de la aplicación): el mismo email da siempre el mismo
// resumen, así se ve si insisten con una cuenta, pero no se puede saber cuál es
export const resumenEmail = (email: string) =>
  createHmac('sha256', config.secretoAuth).update(email).digest('hex').slice(0, 16)

export const normalizarEmail = (email: string) => email.trim().toLowerCase()
