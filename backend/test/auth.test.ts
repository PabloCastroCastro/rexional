import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearAdministrador, ErrorAdministrador } from '../src/administradores.js'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { adminsClub, clubes, session, user } from '../src/db/schema/index.js'

const ORIGEN = 'http://localhost:5173'
const CONTRASENA = 'contraseña-de-prueba'
// Emails únicos en cada ejecución: la base de test se reutiliza entre ejecuciones
const sufijo = randomUUID().slice(0, 8)
const email = `entrenador-${sufijo}@prueba.test`

const app = crearApp()
const creados: { usuarios: string[]; clubes: string[] } = { usuarios: [], clubes: [] }

// Cada test usa su propia IP para no compartir el contador del límite de intentos
const ipUnica = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.1`

function peticion(
  ruta: string,
  opciones: { cuerpo?: object; cookie?: string; origen?: string; ip?: string } = {},
) {
  const headers: Record<string, string> = {
    origin: opciones.origen ?? ORIGEN,
    'x-real-ip': opciones.ip ?? ipUnica(),
  }
  if (opciones.cookie) headers.cookie = opciones.cookie
  if (opciones.cuerpo) headers['content-type'] = 'application/json'
  return app.request(`/api/auth${ruta}`, {
    method: opciones.cuerpo ? 'POST' : 'GET',
    headers,
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  })
}

const iniciarSesion = (password = CONTRASENA, ip?: string) =>
  peticion('/sign-in/email', { cuerpo: { email, password }, ip })

// Cookie de sesión de la respuesta, lista para enviarla en la cabecera Cookie
function cookieDeSesion(res: Response) {
  const cabecera = res.headers.getSetCookie().find((c) => c.includes('vestuario.session_token='))
  if (!cabecera) throw new Error('La respuesta no trae la cookie de sesión')
  return { cabecera, valor: cabecera.split(';')[0] ?? '' }
}

beforeAll(async () => {
  const { usuario, club } = await crearAdministrador({
    email,
    nombre: 'Entrenador de prueba',
    club: `Club ${sufijo}`,
    contrasena: CONTRASENA,
  })
  creados.usuarios.push(usuario.id)
  creados.clubes.push(club.id)
})

afterAll(async () => {
  if (creados.clubes.length) await db.delete(clubes).where(inArray(clubes.id, creados.clubes))
  if (creados.usuarios.length) await db.delete(user).where(inArray(user.id, creados.usuarios))
  await pool.end()
})

describe('inicio de sesión', () => {
  it('con la contraseña correcta crea la sesión en una cookie HttpOnly, Secure y SameSite=Lax de 30 días', async () => {
    const res = await iniciarSesion()
    expect(res.status).toBe(200)
    const { cabecera } = cookieDeSesion(res)
    expect(cabecera).toMatch(/^__Secure-vestuario\.session_token=/)
    expect(cabecera).toMatch(/; HttpOnly/i)
    expect(cabecera).toMatch(/; Secure/i)
    expect(cabecera).toMatch(/; SameSite=Lax/i)
    expect(cabecera).toMatch(/; Max-Age=2592000/i)
  })

  it('con la contraseña incorrecta responde 401 y no crea sesión', async () => {
    const res = await iniciarSesion('otra-contraseña')
    expect(res.status).toBe(401)
    expect(
      res.headers
        .getSetCookie()
        .some((c) => c.includes('session_token=') && !c.includes('Max-Age=0')),
    ).toBe(false)
  })

  it('con un email desconocido responde 401', async () => {
    const res = await peticion('/sign-in/email', {
      cuerpo: { email: `nadie-${sufijo}@prueba.test`, password: CONTRASENA },
    })
    expect(res.status).toBe(401)
  })

  it('no acepta peticiones desde otro origen, con o sin sesión', async () => {
    const otro = 'https://otro-sitio.test'
    const sinSesion = await peticion('/sign-in/email', {
      cuerpo: { email, password: CONTRASENA },
      origen: otro,
    })
    expect(sinSesion.status).toBe(403)
    expect((await sinSesion.json()).error.codigo).toBe('origen_no_permitido')

    const { valor } = cookieDeSesion(await iniciarSesion())
    const conSesion = await peticion('/change-password', {
      cuerpo: { currentPassword: CONTRASENA, newPassword: 'otra-contraseña-larga' },
      cookie: valor,
      origen: otro,
    })
    expect(conSesion.status).toBe(403)
  })

  it('limita a 5 intentos por minuto y por IP', async () => {
    const ip = ipUnica()
    const estados: number[] = []
    for (let i = 0; i < 6; i++) estados.push((await iniciarSesion('otra-contraseña', ip)).status)
    expect(estados).toEqual([401, 401, 401, 401, 401, 429])
    // Otra IP no se ve afectada
    expect((await iniciarSesion()).status).toBe(200)
  })
})

describe('sesión', () => {
  it('la sesión actual devuelve el usuario', async () => {
    const { valor } = cookieDeSesion(await iniciarSesion())
    const res = await peticion('/get-session', { cookie: valor })
    expect(res.status).toBe(200)
    expect((await res.json()).user.email).toBe(email)
  })

  it('sin cookie no hay sesión', async () => {
    const res = await peticion('/get-session')
    expect(await res.json()).toBeNull()
  })

  it('una sesión caducada ya no es válida', async () => {
    const { valor } = cookieDeSesion(await iniciarSesion())
    const token = decodeURIComponent(valor.split('=')[1] ?? '').split('.')[0] ?? ''
    await db
      .update(session)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(session.token, token))
    const res = await peticion('/get-session', { cookie: valor })
    expect(await res.json()).toBeNull()
  })

  it('cerrar sesión la invalida', async () => {
    const { valor } = cookieDeSesion(await iniciarSesion())
    expect((await peticion('/sign-out', { cuerpo: {}, cookie: valor })).status).toBe(200)
    expect(await (await peticion('/get-session', { cookie: valor })).json()).toBeNull()
  })
})

describe('rutas desactivadas', () => {
  it.each(['/sign-up/email', '/request-password-reset', '/delete-user', '/update-user'])(
    '%s no existe',
    async (ruta) => {
      const res = await peticion(ruta, {
        cuerpo: { email: `nuevo-${sufijo}@prueba.test`, password: CONTRASENA, name: 'Nuevo' },
      })
      expect(res.status).toBe(404)
    },
  )

  it('el registro público no crea usuarios', async () => {
    await peticion('/sign-up/email', {
      cuerpo: { email: `nuevo-${sufijo}@prueba.test`, password: CONTRASENA, name: 'Nuevo' },
    })
    expect(await db.$count(user, eq(user.email, `nuevo-${sufijo}@prueba.test`))).toBe(0)
  })
})

describe('crearAdministrador', () => {
  it('crea el usuario, su club y su rol de administrador', async () => {
    const correo = `Admin-${sufijo}@Prueba.test`
    const { usuario, club } = await crearAdministrador({
      email: `  ${correo}  `,
      nombre: 'Ana',
      club: 'CD Nuevo',
      contrasena: CONTRASENA,
    })
    creados.usuarios.push(usuario.id)
    creados.clubes.push(club.id)
    expect(usuario.email).toBe(correo.toLowerCase())
    expect(club.creadoPor).toBe(usuario.id)
    expect(await db.$count(adminsClub, eq(adminsClub.usuarioId, usuario.id))).toBe(1)
  })

  it('no duplica un email existente y no deja nada a medias', async () => {
    const clubesAntes = await db.$count(clubes)
    await expect(
      crearAdministrador({
        email: email.toUpperCase(),
        nombre: 'Otro',
        club: 'Otro club',
        contrasena: CONTRASENA,
      }),
    ).rejects.toThrow(ErrorAdministrador)
    expect(await db.$count(clubes)).toBe(clubesAntes)
  })

  it('exige una contraseña de al menos 10 caracteres', async () => {
    await expect(
      crearAdministrador({
        email: `corta-${sufijo}@prueba.test`,
        nombre: 'X',
        club: 'X',
        contrasena: 'corta',
      }),
    ).rejects.toThrow(/al menos 10 caracteres/)
  })
})
