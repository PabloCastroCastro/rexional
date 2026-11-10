import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearApp } from '../src/app.js'
import { reiniciarBloqueosParaTests } from '../src/autenticacion.js'
import { db, pool } from '../src/db/cliente.js'
import { session, user } from '../src/db/schema/index.js'
import { describirDispositivo } from '../src/dispositivo.js'
import { logger } from '../src/logger.js'
import { CONTRASENA, crearUsuario, ORIGEN } from './utilidades.js'

// GH-177: sesiones abiertas del usuario y cambio de contraseña
const app = crearApp()
const creados: string[] = []

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

let ip = 0
const otraIp = () => {
  ip += 1
  return `10.177.${Math.floor(ip / 250)}.${ip % 250}`
}

async function entrar(email: string, navegador: string, password = CONTRASENA) {
  const res = await app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'content-type': 'application/json',
      'x-real-ip': otraIp(),
      'user-agent': navegador,
    },
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200) throw new Error(`No se pudo iniciar sesión (${res.status})`)
  const cookie = res.headers.getSetCookie().find((c) => c.includes('vestuario.session_token='))
  return (cookie ?? '').split(';')[0] ?? ''
}

const pedir = (
  ruta: string,
  cookie: string,
  metodo = 'GET',
  cuerpo?: object,
  ip = '10.177.250.1',
) =>
  app.request(ruta, {
    method: metodo,
    headers: {
      cookie,
      origin: ORIGEN,
      'x-real-ip': ip,
      ...(cuerpo ? { 'content-type': 'application/json' } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  })

const sigueValida = async (cookie: string) => (await pedir('/api/clubes', cookie)).status === 200

async function usuario(nombre: string) {
  const u = await crearUsuario(nombre)
  creados.push(u.id)
  return u
}

let eventos: Record<string, unknown>[] = []
const eventosDe = (evento: string) => eventos.filter((e) => e.evento === evento)

beforeEach(() => {
  eventos = []
  const capturar = (datos: unknown) => {
    if (datos && typeof datos === 'object' && 'seguridad' in datos) {
      eventos.push(datos as Record<string, unknown>)
    }
  }
  vi.spyOn(logger, 'warn').mockImplementation(capturar as never)
  vi.spyOn(logger, 'info').mockImplementation(capturar as never)
  reiniciarBloqueosParaTests()
})

afterEach(() => vi.restoreAllMocks())

afterAll(async () => {
  if (creados.length) await db.delete(user).where(inArray(user.id, creados))
  await pool.end()
})

describe('sesiones abiertas', () => {
  it('lista las sesiones del usuario, la actual primero, con su dispositivo y sin el token', async () => {
    const u = await usuario('Dos móviles')
    const otro = await usuario('Otro usuario')
    await entrar(u.email, IPHONE)
    await entrar(otro.email, ANDROID)
    const actual = await entrar(u.email, ANDROID)

    const res = await pedir('/api/cuenta/sesiones', actual)
    expect(res.status).toBe(200)
    const sesiones = await res.json()
    expect(sesiones).toHaveLength(2)
    expect(sesiones[0]).toMatchObject({ actual: true, navegador: 'Chrome', sistema: 'Android' })
    expect(sesiones[1]).toMatchObject({ actual: false, navegador: 'Safari', sistema: 'iPhone' })
    expect(sesiones[0].ip).toMatch(/^10\.177\./)
    const texto = JSON.stringify(sesiones)
    expect(texto).not.toMatch(/token/i)
    const tokens = await db
      .select({ token: session.token })
      .from(session)
      .where(eq(session.userId, u.id))
    for (const { token } of tokens) expect(texto).not.toContain(token)
  })

  it('no incluye las sesiones caducadas', async () => {
    const u = await usuario('Caducada')
    await entrar(u.email, IPHONE)
    const actual = await entrar(u.email, ANDROID)
    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.userAgent, IPHONE))
    const sesiones = await (await pedir('/api/cuenta/sesiones', actual)).json()
    expect(sesiones.map((s: { sistema: string }) => s.sistema)).toEqual(['Android'])
  })

  it('cierra otra sesión, que deja de valer al momento, y lo registra', async () => {
    const u = await usuario('Móvil perdido')
    const perdido = await entrar(u.email, IPHONE)
    const actual = await entrar(u.email, ANDROID)
    const [otra] = (await (await pedir('/api/cuenta/sesiones', actual)).json()).filter(
      (s: { actual: boolean }) => !s.actual,
    )

    expect((await pedir(`/api/cuenta/sesiones/${otra.id}`, actual, 'DELETE')).status).toBe(204)
    expect(await sigueValida(perdido)).toBe(false)
    expect(await sigueValida(actual)).toBe(true)
    expect(eventosDe('sesion_cerrada')).toEqual([
      expect.objectContaining({ usuarioId: u.id, remotas: 1 }),
    ])
  })

  it('no cierra la sesión actual ni las de otro usuario', async () => {
    const u = await usuario('Prudente')
    const otro = await usuario('Ajeno')
    const actual = await entrar(u.email, ANDROID)
    const ajena = await entrar(otro.email, ANDROID)
    const [mia] = await (await pedir('/api/cuenta/sesiones', actual)).json()
    const [suya] = await (await pedir('/api/cuenta/sesiones', ajena)).json()

    const propia = await pedir(`/api/cuenta/sesiones/${mia.id}`, actual, 'DELETE')
    expect(propia.status).toBe(400)
    expect((await propia.json()).error.codigo).toBe('sesion_actual')
    expect((await pedir(`/api/cuenta/sesiones/${suya.id}`, actual, 'DELETE')).status).toBe(404)
    expect(await sigueValida(ajena)).toBe(true)
  })

  it('cierra todas las demás y deja la actual', async () => {
    const u = await usuario('Limpieza')
    const a = await entrar(u.email, IPHONE)
    const b = await entrar(u.email, IPHONE)
    const actual = await entrar(u.email, ANDROID)

    const res = await pedir('/api/cuenta/sesiones/cerrar-otras', actual, 'POST')
    expect(await res.json()).toEqual({ cerradas: 2 })
    expect([await sigueValida(a), await sigueValida(b), await sigueValida(actual)]).toEqual([
      false,
      false,
      true,
    ])
    expect(eventosDe('sesion_cerrada')).toEqual([expect.objectContaining({ remotas: 2 })])
  })

  it('sin sesión responde 401', async () => {
    expect((await app.request('/api/cuenta/sesiones')).status).toBe(401)
  })
})

describe('cambio de contraseña', () => {
  const cambiar = (cookie: string, actual: string, nueva: string) =>
    // Una IP distinta en cada intento: Better Auth limita además a 3 cada 10 segundos por IP
    pedir(
      '/api/auth/change-password',
      cookie,
      'POST',
      { currentPassword: actual, newPassword: nueva, revokeOtherSessions: true },
      otraIp(),
    )

  it('cambia la contraseña, cierra las demás sesiones y lo registra', async () => {
    const u = await usuario('Cambia clave')
    const otra = await entrar(u.email, IPHONE)
    const actual = await entrar(u.email, ANDROID)

    const res = await cambiar(actual, CONTRASENA, 'una-contraseña-nueva-larga')
    expect(res.status).toBe(200)
    expect(await sigueValida(otra)).toBe(false)
    expect(eventosDe('contrasena_cambiada')).toEqual([expect.objectContaining({ usuarioId: u.id })])
    // La nueva vale para entrar y la antigua ya no
    await expect(entrar(u.email, ANDROID, 'una-contraseña-nueva-larga')).resolves.toBeTruthy()
    await expect(entrar(u.email, ANDROID)).rejects.toThrow('401')
  })

  it('con la contraseña actual mal no cambia nada y, a los 5 fallos, bloquea la cuenta', async () => {
    const u = await usuario('Sesion robada')
    const robada = await entrar(u.email, ANDROID)
    for (let i = 0; i < 5; i++) {
      const res = await cambiar(robada, 'no-es-la-buena', 'otra-contraseña-larga')
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('INVALID_PASSWORD')
    }
    const bloqueada = await cambiar(robada, CONTRASENA, 'otra-contraseña-larga')
    expect(bloqueada.status).toBe(429)
    expect((await bloqueada.json()).error.codigo).toBe('demasiados_intentos')
    expect(eventosDe('login_fallido')[0]).toMatchObject({
      usuarioId: u.id,
      motivo: 'cambio_contrasena',
    })
    expect(eventosDe('cuenta_bloqueada')).toHaveLength(1)
  })

  it('exige al menos 10 caracteres', async () => {
    const u = await usuario('Clave corta')
    const actual = await entrar(u.email, ANDROID)
    const res = await cambiar(actual, CONTRASENA, 'corta')
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('PASSWORD_TOO_SHORT')
  })
})

describe('dispositivo', () => {
  it('reconoce los navegadores y sistemas habituales', () => {
    expect(describirDispositivo(ANDROID)).toEqual({ navegador: 'Chrome', sistema: 'Android' })
    expect(describirDispositivo(IPHONE)).toEqual({ navegador: 'Safari', sistema: 'iPhone' })
    expect(
      describirDispositivo(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0',
      ),
    ).toEqual({ navegador: 'Edge', sistema: 'Windows' })
    expect(
      describirDispositivo(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:133.0) Gecko/20100101 Firefox/133.0',
      ),
    ).toEqual({ navegador: 'Firefox', sistema: 'Mac' })
    expect(describirDispositivo(null)).toEqual({ navegador: null, sistema: null })
  })
})
