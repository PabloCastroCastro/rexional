import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, invitaciones, jugadores, membresias, user } from '../src/db/schema/index.js'
import { hashToken } from '../src/rutas/invitaciones.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Invitaciones (GH-49): a una plantilla con un rol o como administrador del club

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}
const emails: Record<string, string> = {}

type Invitacion = {
  id: string
  email: string
  rol: string | null
  jugadorId: string | null
  jugador: string | null
  estado: 'pendiente' | 'caducada'
  expira: string
  creadaPor: string | null
}

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  ids[clave] = u.id
  emails[clave] = u.email
}

function pedir(metodo: string, ruta: string, quien?: string, cuerpo?: unknown) {
  const headers: Record<string, string> = { origin: ORIGEN }
  if (quien) headers.cookie = cookies[quien] ?? ''
  if (cuerpo !== undefined) headers['content-type'] = 'application/json'
  return app.request(`/api${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

const rutaPlantilla = (resto = '') => `/plantillas/${ids.senior}/invitaciones${resto}`
const rutaClub = (resto = '') => `/clubes/${ids.club}/invitaciones${resto}`

async function invitar(cuerpo: Record<string, unknown>, quien = 'admin', estado = 201) {
  const res = await pedir('POST', rutaPlantilla(), quien, cuerpo)
  const datos = await res.json()
  expect(res.status, JSON.stringify(datos)).toBe(estado)
  return datos
}

const pendientes = async (ruta = rutaPlantilla()) =>
  (await (await pedir('GET', ruta, 'admin')).json()) as Invitacion[]

beforeAll(async () => {
  for (const clave of ['admin', 'entrenador', 'miembro', 'ajeno']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Invita' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  const otro = await (await pedir('POST', '/clubes', 'ajeno', { nombre: 'CD Otro' })).json()
  clubesCreados.push(otro.id)
  ids.otroClub = otro.id
  const plantilla = async (nombre: string) =>
    (
      await (
        await pedir('POST', '/plantillas', 'admin', {
          clubId: club.id,
          nombre,
          categoria: 'sénior',
          temporada: '2026-27',
        })
      ).json()
    ).id as string
  ids.senior = await plantilla('Senior')
  ids.juvenil = await plantilla('Juvenil')
  await db.insert(membresias).values([
    { plantillaId: ids.senior, usuarioId: ids.entrenador ?? '', rol: 'entrenador' },
    { plantillaId: ids.senior, usuarioId: ids.miembro ?? '', rol: 'delegado' },
  ])
  const alta = async (plantillaId: string, nombre: string) =>
    (
      await (
        await pedir('POST', `/plantillas/${plantillaId}/jugadores`, 'admin', { nombre })
      ).json()
    ).jugadorId as string
  ids.brais = await alta(ids.senior, 'Brais')
  ids.mateo = await alta(ids.juvenil, 'Mateo')
  ids.conCuenta = await alta(ids.senior, 'Con cuenta')
  await db
    .update(jugadores)
    .set({ usuarioId: ids.miembro })
    .where(eq(jugadores.id, ids.conCuenta ?? ''))
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('invitar a la plantilla', () => {
  it('devuelve el enlace una vez y guarda solo el hash del token', async () => {
    const { invitacion, enlace } = await invitar({
      email: '  Brais@Example.COM ',
      rol: 'jugador',
      jugadorId: ids.brais,
    })
    expect(invitacion).toMatchObject({
      email: 'brais@example.com',
      rol: 'jugador',
      jugadorId: ids.brais,
      jugador: 'Brais',
      estado: 'pendiente',
    })
    const dias = (new Date(invitacion.expira).getTime() - Date.now()) / 86_400_000
    expect(dias).toBeGreaterThan(6.9)
    expect(dias).toBeLessThanOrEqual(7)

    expect(enlace).toMatch(/^http:\/\/localhost:5173\/invitacion#[\w-]{43}$/)
    const token = enlace.split('#')[1] ?? ''
    const [guardada] = await db
      .select()
      .from(invitaciones)
      .where(eq(invitaciones.id, invitacion.id))
    expect(guardada?.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(guardada)).not.toContain(token)

    // En el listado, sin enlace
    const lista = await pendientes()
    expect(lista.map((i) => i.id)).toContain(invitacion.id)
    expect(JSON.stringify(lista)).not.toContain(token)
  })

  it('invitar otra vez al mismo email revoca la anterior', async () => {
    const primera = await invitar({ email: 'repe@example.com', rol: 'delegado' })
    const segunda = await invitar({ email: 'REPE@example.com', rol: 'entrenador' })
    const lista = (await pendientes()).filter((i) => i.email === 'repe@example.com')
    expect(lista).toEqual([
      expect.objectContaining({ id: segunda.invitacion.id, rol: 'entrenador' }),
    ])
    const [anterior] = await db
      .select()
      .from(invitaciones)
      .where(eq(invitaciones.id, primera.invitacion.id))
    expect(anterior?.revocadaEn).not.toBeNull()
  })

  it('el mismo email puede tener invitación en otra plantilla', async () => {
    await invitar({ email: 'dos@example.com', rol: 'jugador' })
    const res = await pedir('POST', `/plantillas/${ids.juvenil}/invitaciones`, 'admin', {
      email: 'dos@example.com',
      rol: 'jugador',
    })
    expect(res.status).toBe(201)
  })

  it('valida email, rol y jugador', async () => {
    await invitar({ email: 'no-es-un-email', rol: 'jugador' }, 'admin', 400)
    await invitar({ email: 'a@example.com', rol: 'presidente' }, 'admin', 400)
    await invitar({ email: 'a@example.com' }, 'admin', 400)
    // Jugador solo con el rol jugador
    let error = await invitar(
      { email: 'a@example.com', rol: 'delegado', jugadorId: ids.brais },
      'admin',
      400,
    )
    expect(error.error.detalles[0].campo).toBe('jugadorId')
    // Sin ficha en esta plantilla
    error = await invitar(
      { email: 'a@example.com', rol: 'jugador', jugadorId: ids.mateo },
      'admin',
      400,
    )
    expect(error.error.codigo).toBe('jugador_sin_ficha')
    // Ya vinculado a otro usuario
    error = await invitar(
      { email: 'a@example.com', rol: 'jugador', jugadorId: ids.conCuenta },
      'admin',
      409,
    )
    expect(error.error.codigo).toBe('jugador_con_usuario')
  })

  it('no se invita a quien ya es miembro de la plantilla', async () => {
    const error = await invitar(
      { email: emails.miembro?.toUpperCase(), rol: 'jugador' },
      'admin',
      409,
    )
    expect(error.error).toMatchObject({ codigo: 'ya_es_miembro' })
    expect(error.error.mensaje).toContain('delegado')
  })

  it('las caducadas siguen en la lista, marcadas', async () => {
    const { invitacion } = await invitar({ email: 'caduca@example.com', rol: 'jugador' })
    await db
      .update(invitaciones)
      .set({ expira: new Date(Date.now() - 1000) })
      .where(eq(invitaciones.id, invitacion.id))
    const lista = await pendientes()
    expect(lista.find((i) => i.id === invitacion.id)?.estado).toBe('caducada')
  })

  it('revocar quita la invitación de la lista; dos veces, 404', async () => {
    const { invitacion } = await invitar({ email: 'revocar@example.com', rol: 'jugador' })
    let res = await pedir('DELETE', rutaPlantilla(`/${invitacion.id}`), 'admin')
    expect(res.status).toBe(204)
    expect((await pendientes()).some((i) => i.id === invitacion.id)).toBe(false)
    res = await pedir('DELETE', rutaPlantilla(`/${invitacion.id}`), 'admin')
    expect(res.status).toBe(404)
    // La de otra plantilla no se revoca desde esta
    const otra = await (
      await pedir('POST', `/plantillas/${ids.juvenil}/invitaciones`, 'admin', {
        email: 'otra@example.com',
        rol: 'jugador',
      })
    ).json()
    res = await pedir('DELETE', rutaPlantilla(`/${otra.invitacion.id}`), 'admin')
    expect(res.status).toBe(404)
  })

  it('solo el admin de la plantilla', async () => {
    for (const quien of ['entrenador', 'miembro', 'ajeno']) {
      expect((await pedir('GET', rutaPlantilla(), quien)).status).toBe(403)
      expect(
        (await pedir('POST', rutaPlantilla(), quien, { email: 'x@example.com', rol: 'jugador' }))
          .status,
      ).toBe(403)
    }
    expect((await pedir('GET', rutaPlantilla())).status).toBe(401)
  })

  it('un admin con membresía (no del club) también invita', async () => {
    await db
      .update(membresias)
      .set({ rol: 'admin' })
      .where(
        and(
          eq(membresias.plantillaId, ids.senior ?? ''),
          eq(membresias.usuarioId, ids.entrenador ?? ''),
        ),
      )
    const { invitacion } = await invitar(
      { email: 'por-admin@example.com', rol: 'jugador' },
      'entrenador',
    )
    expect(invitacion.creadaPor).toBeTruthy()
  })
})

describe('invitar como administrador del club', () => {
  it('crea, lista y revoca, sin rol ni plantilla', async () => {
    let res = await pedir('POST', rutaClub(), 'admin', { email: 'Nuevo.Admin@example.com' })
    const { invitacion, enlace } = await res.json()
    expect(res.status).toBe(201)
    expect(invitacion).toMatchObject({
      email: 'nuevo.admin@example.com',
      rol: null,
      jugadorId: null,
    })
    expect(enlace).toContain('/invitacion#')
    // No se mezclan con las de las plantillas
    expect((await pendientes(rutaClub())).map((i) => i.id)).toEqual([invitacion.id])
    expect((await pendientes()).some((i) => i.id === invitacion.id)).toBe(false)

    res = await pedir('DELETE', rutaClub(`/${invitacion.id}`), 'admin')
    expect(res.status).toBe(204)
    expect(await pendientes(rutaClub())).toEqual([])
  })

  it('no se invita a quien ya es administrador del club', async () => {
    const res = await pedir('POST', rutaClub(), 'admin', { email: emails.admin })
    expect(res.status).toBe(409)
  })

  it('solo los administradores del club', async () => {
    // Admin de una plantilla, pero no del club
    for (const quien of ['entrenador', 'miembro', 'ajeno']) {
      expect((await pedir('POST', rutaClub(), quien, { email: 'x@example.com' })).status).toBe(403)
      expect((await pedir('GET', rutaClub(), quien)).status).toBe(403)
    }
    // Ni las de otro club
    expect((await pedir('GET', `/clubes/${ids.otroClub}/invitaciones`, 'admin')).status).toBe(403)
  })
})
