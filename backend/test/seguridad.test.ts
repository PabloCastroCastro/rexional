import { randomUUID } from 'node:crypto'
import { inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { crearApp } from '../src/app.js'
import {
  duracionBloqueo,
  mensajeBloqueo,
  reiniciarBloqueosParaTests,
} from '../src/autenticacion.js'
import { db, pool } from '../src/db/cliente.js'
import { user } from '../src/db/schema/index.js'
import { configurarLimitesParaTests, esCostosa } from '../src/limites.js'
import { logger } from '../src/logger.js'
import { resumenEmail } from '../src/seguridad.js'
import { CONTRASENA, crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// GH-58: bloqueo de cuentas, límites por usuario, origen y eventos de seguridad
const app = crearApp()
const creados: string[] = []

let ip = 0
const otraIp = () => {
  ip += 1
  return `10.58.${Math.floor(ip / 250)}.${ip % 250}`
}

function login(
  email: string,
  password: string,
  opciones: { ip?: string; navegador?: string } = {},
) {
  return app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      origin: ORIGEN,
      'content-type': 'application/json',
      // IP distinta en cada intento: así no salta el límite por IP de Better Auth
      'x-real-ip': opciones.ip ?? otraIp(),
      'user-agent': opciones.navegador ?? 'navegador-de-prueba',
    },
    body: JSON.stringify({ email, password }),
  })
}

async function usuario(nombre: string) {
  const u = await crearUsuario(nombre)
  creados.push(u.id)
  return u
}

// Eventos de seguridad registrados (el logger está en silencio en los tests)
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

afterEach(() => {
  vi.restoreAllMocks()
  configurarLimitesParaTests({ general: 100000, costosas: 100000 })
})

afterAll(async () => {
  if (creados.length) await db.delete(user).where(inArray(user.id, creados))
  await pool.end()
})

describe('bloqueo de cuentas tras fallos de login', () => {
  it('a partir del quinto fallo seguido bloquea el email, aunque cambie la IP y la contraseña sea buena', async () => {
    const u = await usuario('Bloqueado')
    for (let i = 0; i < 5; i++) expect((await login(u.email, 'mala-contraseña')).status).toBe(401)

    const res = await login(u.email, CONTRASENA)
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(50)
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(60)
    const cuerpo = await res.json()
    expect(cuerpo.error.codigo).toBe('demasiados_intentos')
    expect(cuerpo.error.mensaje).toBe(
      'Demasiados intentos fallidos. Espera 1 minuto y vuelve a probar.',
    )
    expect(eventosDe('cuenta_bloqueada')).toEqual([
      expect.objectContaining({ usuarioId: u.id, fallos: 5, segundos: 60 }),
    ])
  })

  it('también bloquea un email que no es de nadie, sin dejarlo en el registro', async () => {
    const email = `nadie-${randomUUID().slice(0, 8)}@prueba.test`
    for (let i = 0; i < 5; i++) expect((await login(email, 'lo-que-sea')).status).toBe(401)
    expect((await login(email, 'lo-que-sea')).status).toBe(429)

    const fallidos = eventosDe('login_fallido')
    expect(fallidos).toHaveLength(5)
    expect(fallidos[0]).toMatchObject({ emailResumen: resumenEmail(email), fallos: 1 })
    expect(JSON.stringify(eventos)).not.toContain(email)
  })

  it('un login correcto pone el contador a cero', async () => {
    const u = await usuario('Despistado')
    for (let i = 0; i < 4; i++) await login(u.email, 'mala-contraseña')
    expect((await login(u.email, CONTRASENA)).status).toBe(200)
    for (let i = 0; i < 4; i++) expect((await login(u.email, 'mala-contraseña')).status).toBe(401)
  })

  it('el email no distingue mayúsculas', async () => {
    const u = await usuario('Mayusculas')
    for (let i = 0; i < 5; i++) await login(u.email.toUpperCase(), 'mala-contraseña')
    expect((await login(u.email, CONTRASENA)).status).toBe(429)
  })

  it('el bloqueo dura 1 minuto y se duplica en cada fallo, hasta 15', () => {
    expect([4, 5, 6, 7, 8, 9, 10, 20].map((f) => duracionBloqueo(f, 5) / 60_000)).toEqual([
      0, 1, 2, 4, 8, 15, 15, 15,
    ])
    expect(mensajeBloqueo(30)).toBe(
      'Demasiados intentos fallidos. Espera 30 segundos y vuelve a probar.',
    )
    expect(mensajeBloqueo(240)).toBe(
      'Demasiados intentos fallidos. Espera 4 minutos y vuelve a probar.',
    )
  })
})

describe('eventos de login', () => {
  it('registra el login correcto y el fallido con el usuario y la IP, sin contraseñas', async () => {
    const u = await usuario('Eventos')
    await login(u.email, 'mala-contraseña', { ip: '10.58.250.1' })
    await login(u.email, CONTRASENA, { ip: '10.58.250.2' })
    expect(eventosDe('login_fallido')).toEqual([
      expect.objectContaining({ usuarioId: u.id, ip: '10.58.250.1', fallos: 1 }),
    ])
    expect(eventosDe('login_ok')).toEqual([
      expect.objectContaining({ usuarioId: u.id, ip: '10.58.250.2' }),
    ])
    const texto = JSON.stringify(eventos)
    expect(texto).not.toContain(CONTRASENA)
    expect(texto).not.toContain('mala-contraseña')
  })

  it('avisa del login desde una IP o un navegador que el usuario no tenía en otra sesión', async () => {
    const u = await usuario('Viajero')
    await login(u.email, CONTRASENA, { ip: '10.58.251.1', navegador: 'movil' })
    expect(eventosDe('login_desde_nuevo_origen')).toEqual([
      expect.objectContaining({
        usuarioId: u.id,
        ipNueva: true,
        navegadorNuevo: true,
        otrasSesiones: 0,
      }),
    ])

    eventos = []
    await login(u.email, CONTRASENA, { ip: '10.58.251.1', navegador: 'movil' })
    expect(eventosDe('login_desde_nuevo_origen')).toEqual([])

    await login(u.email, CONTRASENA, { ip: '10.58.251.9', navegador: 'movil' })
    expect(eventosDe('login_desde_nuevo_origen')).toEqual([
      expect.objectContaining({ ip: '10.58.251.9', ipNueva: true, navegadorNuevo: false }),
    ])
  })

  it('registra el cierre de sesión con su usuario', async () => {
    const u = await usuario('Saliente')
    const cookie = await iniciarSesion(app, u.email)
    const res = await app.request('/api/auth/sign-out', {
      method: 'POST',
      headers: { origin: ORIGEN, cookie, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(200)
    expect(eventosDe('sesion_cerrada')).toEqual([expect.objectContaining({ usuarioId: u.id })])
  })
})

describe('límites por usuario', () => {
  it('por encima del máximo responde 429 con Retry-After, solo a ese usuario y lo registra una vez', async () => {
    const [a, b] = [await usuario('Insistente'), await usuario('Tranquilo')]
    const [cookieA, cookieB] = [
      await iniciarSesion(app, a.email),
      await iniciarSesion(app, b.email),
    ]
    configurarLimitesParaTests({ general: 3 })
    const pedir = (cookie: string) => app.request('/api/clubes', { headers: { cookie } })

    const estados = []
    for (let i = 0; i < 5; i++) estados.push((await pedir(cookieA)).status)
    expect(estados).toEqual([200, 200, 200, 429, 429])
    expect((await pedir(cookieB)).status).toBe(200)

    const res = await pedir(cookieA)
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0)
    expect((await res.json()).error).toMatchObject({ codigo: 'demasiadas_peticiones' })
    expect(eventosDe('limite_superado')).toEqual([
      expect.objectContaining({ limite: 'general', usuarioId: a.id, ruta: '/api/clubes' }),
    ])
  })

  it('las peticiones costosas tienen su propio límite', async () => {
    expect(esCostosa('POST', '/api/clubes/c/ejercicios/e/medios')).toBe(true)
    expect(esCostosa('POST', '/api/plantillas/p/partidos/x/archivos')).toBe(true)
    expect(esCostosa('POST', '/api/plantillas/p/partidos/x/acta')).toBe(true)
    expect(esCostosa('POST', '/api/plantillas/p/partidos/calendario/leer')).toBe(true)
    expect(esCostosa('GET', '/api/plantillas/p/multas/informe.pdf')).toBe(true)
    expect(esCostosa('GET', '/api/plantillas/p/exportacion.xlsx')).toBe(true)
    expect(esCostosa('GET', '/api/clubes/c/ejercicios/e/medios')).toBe(false)
    expect(esCostosa('POST', '/api/plantillas/p/partidos/x/acta/confirmar')).toBe(false)
  })
})

describe('origen', () => {
  it('rechaza desde otro origen las peticiones que modifican datos, no las de lectura', async () => {
    const u = await usuario('Origen')
    const cookie = await iniciarSesion(app, u.email)
    const otro = 'https://otro-sitio.test'
    const crear = await app.request('/api/clubes', {
      method: 'POST',
      headers: { origin: otro, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'Club ajeno' }),
    })
    expect(crear.status).toBe(403)
    expect((await crear.json()).error.codigo).toBe('origen_no_permitido')
    expect(eventosDe('origen_rechazado')).toEqual([
      expect.objectContaining({ origen: otro, metodo: 'POST', ruta: '/api/clubes' }),
    ])

    const leer = await app.request('/api/clubes', { headers: { origin: otro, cookie } })
    expect(leer.status).toBe(200)
  })
})
