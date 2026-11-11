import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  adminsClub,
  clubes,
  invitaciones,
  jugadores,
  membresias,
  user,
} from '../src/db/schema/index.js'
import { hashToken } from '../src/rutas/invitaciones.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Aceptar una invitación (GH-50): con cuenta nueva o con la que ya existe, y los enlaces que no sirven

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const emailsNuevos: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}
const emails: Record<string, string> = {}

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  ids[clave] = u.id
  emails[clave] = u.email
}

function pedir(metodo: string, ruta: string, cookie?: string, cuerpo?: unknown) {
  const headers: Record<string, string> = { origin: ORIGEN }
  if (cookie) headers.cookie = cookie
  if (cuerpo !== undefined) headers['content-type'] = 'application/json'
  return app.request(`/api${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

// Invita y devuelve el token del enlace
async function invitar(cuerpo: Record<string, unknown>, ruta = `/plantillas/${ids.senior}`) {
  const res = await pedir('POST', `${ruta}/invitaciones`, cookies.admin, cuerpo)
  const datos = await res.json()
  expect(res.status, JSON.stringify(datos)).toBe(201)
  return (datos.enlace as string).split('#')[1] ?? ''
}

const consultar = (token: string, cookie?: string) =>
  pedir('POST', '/invitaciones/consultar', cookie, { token })
const aceptar = (cuerpo: Record<string, unknown>, cookie?: string) =>
  pedir('POST', '/invitaciones/aceptar', cookie, cuerpo)

const codigo = async (res: Response) => (await res.json()).error?.codigo

beforeAll(async () => {
  for (const clave of ['admin', 'existente', 'otro']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', cookies.admin, { nombre: 'CD Acepta' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  const plantilla = await (
    await pedir('POST', '/plantillas', cookies.admin, {
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
    })
  ).json()
  ids.senior = plantilla.id
  const alta = async (nombre: string) =>
    (
      await (
        await pedir('POST', `/plantillas/${plantilla.id}/jugadores`, cookies.admin, { nombre })
      ).json()
    ).jugadorId as string
  ids.brais = await alta('Brais')
  ids.mateo = await alta('Mateo')
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  if (emailsNuevos.length) await db.delete(user).where(inArray(user.email, emailsNuevos))
  await pool.end()
})

describe('consultar', () => {
  it('dice a qué invita y si hay cuenta con ese email', async () => {
    const token = await invitar({
      email: 'nuevo-1@prueba.test',
      rol: 'jugador',
      jugadorId: ids.brais,
    })
    const res = await consultar(token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      email: 'nuevo-1@prueba.test',
      club: 'CD Acepta',
      clubId: ids.club,
      plantilla: { id: ids.senior, nombre: 'Senior', temporada: '2026-27' },
      rol: 'jugador',
      jugador: 'Brais',
      cuentaExiste: false,
    })
    const otro = await invitar({ email: emails.existente, rol: 'delegado' })
    expect((await (await consultar(otro)).json()).cuentaExiste).toBe(true)
  })

  it('los enlaces que no sirven se explican', async () => {
    let res = await consultar('x'.repeat(43))
    expect(res.status).toBe(404)
    expect(await codigo(res)).toBe('invitacion_no_valida')

    const caducada = await invitar({ email: 'caduca@prueba.test', rol: 'jugador' })
    await db
      .update(invitaciones)
      .set({ expira: new Date(Date.now() - 1000) })
      .where(eq(invitaciones.tokenHash, hashToken(caducada)))
    res = await consultar(caducada)
    expect(res.status).toBe(410)
    expect(await codigo(res)).toBe('invitacion_caducada')

    const revocada = await invitar({ email: 'revoca@prueba.test', rol: 'jugador' })
    await invitar({ email: 'revoca@prueba.test', rol: 'delegado' })
    res = await consultar(revocada)
    expect(res.status).toBe(410)
    expect(await codigo(res)).toBe('invitacion_revocada')
  })
})

describe('aceptar con una cuenta nueva', () => {
  it('crea la cuenta, entra, crea la membresía y vincula al jugador; una sola vez', async () => {
    const email = 'nuevo-2@prueba.test'
    emailsNuevos.push(email)
    const token = await invitar({ email, rol: 'jugador', jugadorId: ids.brais })

    // Faltan nombre y contraseña (o es corta)
    let res = await aceptar({ token, contrasena: 'corta' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.detalles.map((d: { campo: string }) => d.campo).sort()).toEqual(
      ['contrasena', 'nombre'],
    )

    res = await aceptar({ token, nombre: 'Brais Nuevo', contrasena: 'una-contraseña-larga' })
    expect(res.status, await res.clone().text()).toBe(200)
    expect(await res.json()).toEqual({ clubId: ids.club, plantillaId: ids.senior })
    const cookie = res.headers
      .getSetCookie()
      .find((c) => c.includes('vestuario.session_token='))
      ?.split(';')[0]
    expect(cookie).toBeTruthy()

    // Ya tiene sesión y ve la plantilla como jugador
    const plantillas = await (await pedir('GET', '/plantillas', cookie)).json()
    expect(plantillas.map((p: { id: string; rol: string }) => [p.id, p.rol])).toEqual([
      [ids.senior, 'jugador'],
    ])
    const [nuevo] = await db.select().from(user).where(eq(user.email, email))
    const [jugador] = await db
      .select()
      .from(jugadores)
      .where(eq(jugadores.id, ids.brais ?? ''))
    expect(jugador?.usuarioId).toBe(nuevo?.id)
    expect(nuevo?.name).toBe('Brais Nuevo')

    // Puede volver a entrar con su contraseña
    const login = await pedir('POST', '/auth/sign-in/email', undefined, {
      email,
      password: 'una-contraseña-larga',
    })
    expect(login.status).toBe(200)

    // De un solo uso
    res = await aceptar({ token, nombre: 'Otro', contrasena: 'una-contraseña-larga' })
    expect(res.status).toBe(410)
    expect(await codigo(res)).toBe('invitacion_usada')
  })
})

describe('aceptar con una cuenta que ya existe', () => {
  it('sin sesión pide iniciarla; con la de otro email, no', async () => {
    const token = await invitar({ email: emails.existente, rol: 'entrenador' })
    let res = await aceptar({ token, nombre: 'X', contrasena: 'una-contraseña-larga' })
    expect(res.status).toBe(401)
    expect(await codigo(res)).toBe('inicia_sesion')

    res = await aceptar({ token }, cookies.otro)
    expect(res.status).toBe(403)
    expect(await codigo(res)).toBe('otro_email')

    // Con su sesión, entra con el rol de la invitación
    res = await aceptar({ token }, cookies.existente)
    expect(res.status).toBe(200)
    expect(res.headers.getSetCookie()).toEqual([])
    const [miembro] = await db
      .select({ rol: membresias.rol })
      .from(membresias)
      .where(
        and(
          eq(membresias.plantillaId, ids.senior ?? ''),
          eq(membresias.usuarioId, ids.existente ?? ''),
        ),
      )
    expect(miembro?.rol).toBe('entrenador')
  })

  it('una cuenta nueva no se crea si ya hay sesión de otro email', async () => {
    const token = await invitar({ email: 'nuevo-3@prueba.test', rol: 'delegado' })
    const res = await aceptar(
      { token, nombre: 'Nuevo', contrasena: 'una-contraseña-larga' },
      cookies.otro,
    )
    expect(res.status).toBe(403)
    expect(await db.select().from(user).where(eq(user.email, 'nuevo-3@prueba.test'))).toEqual([])
  })

  it('como administrador del club', async () => {
    const token = await invitar({ email: emails.otro }, `/clubes/${ids.club}`)
    const res = await aceptar({ token }, cookies.otro)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clubId: ids.club, plantillaId: null })
    const admins = await db
      .select()
      .from(adminsClub)
      .where(and(eq(adminsClub.clubId, ids.club ?? ''), eq(adminsClub.usuarioId, ids.otro ?? '')))
    expect(admins).toHaveLength(1)
  })

  it('si el jugador ya tiene otra cuenta, no se acepta', async () => {
    const token = await invitar({ email: emails.otro, rol: 'jugador', jugadorId: ids.mateo })
    await db
      .update(jugadores)
      .set({ usuarioId: ids.existente })
      .where(eq(jugadores.id, ids.mateo ?? ''))
    const res = await aceptar({ token }, cookies.otro)
    expect(res.status).toBe(409)
    expect(await codigo(res)).toBe('jugador_con_usuario')
    // Sigue pendiente
    expect((await consultar(token)).status).toBe(200)
  })
})
