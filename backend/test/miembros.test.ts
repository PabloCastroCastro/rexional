import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, jugadores, membresias, user } from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Miembros de la plantilla (GH-51): ver, cambiar el rol y retirar el acceso

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}

type Miembro = {
  usuarioId: string
  nombre: string
  rol: string
  heredado: boolean
  jugador: string | null
}

async function usuario(clave: string, nombre: string) {
  const u = await crearUsuario(nombre)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  ids[clave] = u.id
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

const ruta = (resto = '') => `/plantillas/${ids.senior}/miembros${resto}`
const listar = async (quien = 'admin') =>
  (await (await pedir('GET', ruta(), quien)).json()) as {
    miembros: Miembro[]
    jugadoresSinCuenta: { jugadorId: string; nombre: string }[]
  }

beforeAll(async () => {
  await usuario('admin', 'Ana')
  await usuario('entrenador', 'Berta')
  await usuario('jugador', 'Carlos')
  await usuario('delegado', 'Dani')
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Miembros' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  const plantilla = await (
    await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
    })
  ).json()
  ids.senior = plantilla.id
  await db.insert(membresias).values([
    { plantillaId: plantilla.id, usuarioId: ids.entrenador ?? '', rol: 'admin' },
    { plantillaId: plantilla.id, usuarioId: ids.jugador ?? '', rol: 'jugador' },
    { plantillaId: plantilla.id, usuarioId: ids.delegado ?? '', rol: 'delegado' },
  ])
  const alta = async (nombre: string, apellidos: string) =>
    (
      await (
        await pedir('POST', `/plantillas/${plantilla.id}/jugadores`, 'admin', { nombre, apellidos })
      ).json()
    ).jugadorId as string
  ids.carlos = await alta('Carlos', 'Vila')
  ids.brais = await alta('Brais', 'Pazos')
  await db.update(jugadores).set({ usuarioId: ids.jugador }).where(eq(jugadores.id, ids.carlos))
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('GET /plantillas/{id}/miembros', () => {
  it('los administradores del club primero, como heredados; después los miembros', async () => {
    const { miembros, jugadoresSinCuenta } = await listar()
    expect(miembros.map((m) => [m.nombre, m.rol, m.heredado, m.jugador])).toEqual([
      ['Ana', 'admin', true, null],
      ['Berta', 'admin', false, null],
      ['Carlos', 'jugador', false, 'Carlos Vila'],
      ['Dani', 'delegado', false, null],
    ])
    // Carlos ya tiene cuenta
    expect(jugadoresSinCuenta).toEqual([{ jugadorId: ids.brais, nombre: 'Brais Pazos' }])
  })

  it('solo el admin', async () => {
    expect((await pedir('GET', ruta(), 'delegado')).status).toBe(403)
    expect((await pedir('GET', ruta(), 'entrenador')).status).toBe(200)
  })
})

describe('cambiar el rol y retirar el acceso', () => {
  it('cambia el rol de un miembro', async () => {
    const res = await pedir('PATCH', ruta(`/${ids.delegado}`), 'admin', { rol: 'entrenador' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rol: 'entrenador' })
    expect((await listar()).miembros.find((m) => m.usuarioId === ids.delegado)?.rol).toBe(
      'entrenador',
    )
    expect((await pedir('PATCH', ruta(`/${ids.delegado}`), 'admin', { rol: 'jefe' })).status).toBe(
      400,
    )
  })

  it('los administradores del club no se tocan desde la plantilla', async () => {
    let res = await pedir('PATCH', ruta(`/${ids.admin}`), 'entrenador', { rol: 'jugador' })
    expect(res.status).toBe(404)
    res = await pedir('DELETE', ruta(`/${ids.admin}`), 'entrenador')
    expect(res.status).toBe(404)
  })

  it('retirar el acceso borra la membresía y deja al jugador vinculado', async () => {
    expect((await pedir('DELETE', ruta(`/${ids.jugador}`), 'admin')).status).toBe(204)
    const quedan = await db
      .select()
      .from(membresias)
      .where(
        and(
          eq(membresias.plantillaId, ids.senior ?? ''),
          eq(membresias.usuarioId, ids.jugador ?? ''),
        ),
      )
    expect(quedan).toEqual([])
    const [carlos] = await db
      .select()
      .from(jugadores)
      .where(eq(jugadores.id, ids.carlos ?? ''))
    expect(carlos?.usuarioId).toBe(ids.jugador)
    // Ya no entra en la plantilla
    expect((await pedir('GET', `/plantillas/${ids.senior}`, 'jugador')).status).toBe(403)
    expect((await pedir('DELETE', ruta(`/${ids.jugador}`), 'admin')).status).toBe(404)
  })

  it('solo el admin', async () => {
    expect(
      (await pedir('PATCH', ruta(`/${ids.entrenador}`), 'delegado', { rol: 'jugador' })).status,
    ).toBe(403)
    expect((await pedir('DELETE', ruta(`/${ids.entrenador}`), 'delegado')).status).toBe(403)
  })
})
