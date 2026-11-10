import { and, eq, ne, or } from 'drizzle-orm'
import type { Context } from 'hono'
import { auth } from './auth.js'
import { config } from './config.js'
import { db } from './db/cliente.js'
import { session, user } from './db/schema/index.js'
import { cuerpoError } from './errores.js'
import { logger } from './logger.js'
import { ipDe, navegadorDe, normalizarEmail, registrarEvento, resumenEmail } from './seguridad.js'

// Rutas de Better Auth (/api/auth/*) con lo que Better Auth no hace (GH-58):
// - Bloqueo temporal y progresivo de un email tras varios fallos seguidos de login: además del límite
//   por IP, así no sirve ir cambiando de IP. Se aplica igual exista o no la cuenta, para no revelar
//   qué emails existen, y nunca es permanente, para que nadie pueda bloquear a otro a propósito.
// - Eventos de seguridad: login correcto y fallido, cuenta bloqueada, límite de intentos por IP,
//   login desde un origen nuevo, cambio de contraseña y cierre de sesión.

const MINUTO = 60_000
const BLOQUEO_MAXIMO = 15 * MINUTO
// Pasado este tiempo sin fallos, un email vuelve a empezar de cero
const OLVIDO = 24 * 60 * MINUTO

type Intentos = { fallos: number; bloqueadoHasta: number; ultimo: number }
const intentos = new Map<string, Intentos>()

// Bloqueo tras el fallo número n: 1 minuto al llegar al umbral y el doble en cada fallo siguiente,
// hasta 15 minutos
export function duracionBloqueo(fallos: number, umbral = config.limites.fallosLoginBloqueo) {
  if (fallos < umbral) return 0
  return Math.min(MINUTO * 2 ** (fallos - umbral), BLOQUEO_MAXIMO)
}

function intentosDe(email: string, ahora: number) {
  if (intentos.size > 10_000) {
    for (const [clave, i] of intentos) if (ahora - i.ultimo > OLVIDO) intentos.delete(clave)
  }
  const actual = intentos.get(email)
  if (actual && ahora - actual.ultimo <= OLVIDO) return actual
  const nuevo = { fallos: 0, bloqueadoHasta: 0, ultimo: ahora }
  intentos.set(email, nuevo)
  return nuevo
}

export const reiniciarBloqueosParaTests = () => intentos.clear()

export async function manejarAutenticacion(c: Context) {
  const ruta = c.req.path.replace(/^\/api\/auth/, '')
  if (c.req.method === 'POST' && ruta === '/sign-in/email') return iniciarSesion(c)
  if (c.req.method === 'POST' && (ruta === '/sign-out' || ruta === '/change-password')) {
    return conUsuario(c, ruta === '/sign-out' ? 'sesion_cerrada' : 'contrasena_cambiada')
  }
  return auth.handler(c.req.raw)
}

async function iniciarSesion(c: Context) {
  const cabeceras = c.req.raw.headers
  const ip = ipDe(cabeceras)
  const email = await emailDelCuerpo(c.req.raw)
  // Sin email no hay nada que bloquear: Better Auth responde con su error de validación
  if (!email) return auth.handler(c.req.raw)

  const ahora = Date.now()
  const estado = intentosDe(email, ahora)
  if (estado.bloqueadoHasta > ahora) {
    const segundos = Math.ceil((estado.bloqueadoHasta - ahora) / 1000)
    return c.json(cuerpoError('demasiados_intentos', mensajeBloqueo(segundos)), 429, {
      'Retry-After': String(segundos),
    })
  }

  const respuesta = await auth.handler(c.req.raw)
  estado.ultimo = Date.now()

  if (respuesta.status === 200) {
    intentos.delete(email)
    const datos = (await respuesta.clone().json()) as { token?: string; user?: { id?: string } }
    const usuarioId = datos.user?.id
    registrarEvento('login_ok', { usuarioId, ip })
    if (usuarioId && datos.token) {
      await comprobarOrigen(usuarioId, datos.token, ip, navegadorDe(cabeceras)).catch((error) =>
        logger.error({ err: error }, 'No se ha podido comprobar el origen del login'),
      )
    }
  } else if (respuesta.status === 401) {
    estado.fallos += 1
    const quien = await quienEs(email)
    registrarEvento('login_fallido', { ...quien, ip, fallos: estado.fallos })
    const bloqueo = duracionBloqueo(estado.fallos)
    if (bloqueo > 0) {
      estado.bloqueadoHasta = Date.now() + bloqueo
      registrarEvento('cuenta_bloqueada', {
        ...quien,
        ip,
        fallos: estado.fallos,
        segundos: bloqueo / 1000,
      })
    }
  } else if (respuesta.status === 429) {
    // El límite de intentos por IP de Better Auth
    registrarEvento('limite_superado', { limite: 'login_ip', ip })
  }
  return respuesta
}

// Cierre de sesión y cambio de contraseña: el evento lleva el usuario, que se lee antes de que la
// sesión desaparezca
async function conUsuario(c: Context, evento: 'sesion_cerrada' | 'contrasena_cambiada') {
  const sesion = await auth.api.getSession({ headers: c.req.raw.headers }).catch(() => null)
  const respuesta = await auth.handler(c.req.raw)
  if (respuesta.ok && sesion) {
    registrarEvento(evento, { usuarioId: sesion.user.id, ip: ipDe(c.req.raw.headers) })
  }
  return respuesta
}

async function emailDelCuerpo(peticion: Request) {
  try {
    const cuerpo = (await peticion.clone().json()) as { email?: unknown }
    return typeof cuerpo.email === 'string' && cuerpo.email.trim()
      ? normalizarEmail(cuerpo.email)
      : null
  } catch {
    return null
  }
}

// El usuario, si el email es de alguno; si no, solo el resumen del email
async function quienEs(email: string) {
  const [existente] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  return existente ? { usuarioId: existente.id } : { emailResumen: resumenEmail(email) }
}

// Login desde una IP o un navegador que el usuario no tenía en ninguna otra sesión. Las sesiones
// cerradas se borran, así que es «nuevo» respecto a las que siguen guardadas (GH-177 guardará el
// historial completo)
async function comprobarOrigen(usuarioId: string, token: string, ip: string, navegador: string) {
  const otras = await db
    .select({ ip: session.ipAddress, navegador: session.userAgent })
    .from(session)
    .where(
      and(
        eq(session.userId, usuarioId),
        ne(session.token, token),
        or(eq(session.ipAddress, ip), eq(session.userAgent, navegador)),
      ),
    )
  const ipConocida = otras.some((s) => s.ip === ip)
  const navegadorConocido = otras.some((s) => s.navegador === navegador)
  if (ipConocida && navegadorConocido) return
  const total = await db.$count(
    session,
    and(eq(session.userId, usuarioId), ne(session.token, token)),
  )
  registrarEvento('login_desde_nuevo_origen', {
    usuarioId,
    ip,
    navegador,
    ipNueva: !ipConocida,
    navegadorNuevo: !navegadorConocido,
    otrasSesiones: total,
  })
}

export function mensajeBloqueo(segundos: number) {
  const minutos = Math.ceil(segundos / 60)
  const cuanto =
    segundos < 60 ? `${segundos} segundos` : minutos === 1 ? '1 minuto' : `${minutos} minutos`
  return `Demasiados intentos fallidos. Espera ${cuanto} y vuelve a probar.`
}
