import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, membresias, user } from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Sanciones calculadas con las tarjetas de los partidos (GH-231), por la API

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
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

type Sanciones = {
  jugadores: {
    jugadorId: string
    pendientes: { competicion: string; partidos: number }[]
    apercibido: { competicion: string; amarillas: number }[]
    sanciones: { partidoId: string; tipo: string; partidos: number; cumplidos: number }[]
  }[]
}

const base = () => `/plantillas/${ids.senior}`

async function crearPartido(fecha: string, competicion: string | null = 'Preferente') {
  const res = await pedir('POST', `${base()}/partidos`, 'delegado', {
    rival: `Rival ${fecha}`,
    fecha,
    competicion,
  })
  return (await res.json()).id as string
}

// Un partido jugado con las tarjetas indicadas: [jugador, 'amarilla' | 'roja'][]
async function jugar(fecha: string, tarjetas: [string, string][], competicion?: string | null) {
  const pid = await crearPartido(fecha, competicion)
  await pedir('PUT', `${base()}/partidos/${pid}/convocados`, 'delegado', {
    jugadores: [ids.brais, ids.zoe],
  })
  await pedir('PUT', `${base()}/partidos/${pid}/resultado`, 'delegado', {
    golesFavor: 1,
    golesContra: 0,
  })
  if (tarjetas.length) {
    const res = await pedir('POST', `${base()}/partidos/${pid}/eventos/lote`, 'delegado', {
      eventos: tarjetas.map(([jugador, tipo], i) => ({
        jugadorId: ids[jugador],
        tipo,
        minuto: 10 + i,
      })),
    })
    expect(res.status).toBe(201)
  }
  return pid
}

const sanciones = async (quien = 'delegado') =>
  (await (await pedir('GET', `${base()}/sanciones`, quien)).json()) as Sanciones

const de = (s: Sanciones, jugador: string) => s.jugadores.find((j) => j.jugadorId === ids[jugador])

const sancionEnPartido = async (pid: string, jugador: string) => {
  const partido = (await (await pedir('GET', `${base()}/partidos/${pid}`, 'delegado')).json()) as {
    jugadores: { jugadorId: string; sancion: { partidos: number } | null }[]
  }
  return partido.jugadores.find((j) => j.jugadorId === ids[jugador])?.sancion
}

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'Rexional CF' })).json()
  clubesCreados.push(club.id)
  const res = await pedir('POST', '/plantillas', 'admin', {
    clubId: club.id,
    nombre: 'Senior',
    categoria: 'sénior',
    temporada: '2026-27',
  })
  ids.senior = (await res.json()).id
  await db.insert(membresias).values([
    { plantillaId: ids.senior ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
  for (const [clave, nombre, dorsal] of [
    ['brais', 'Brais', 7],
    ['zoe', 'Zoe', 9],
  ] as const) {
    const alta = await pedir('POST', `${base()}/jugadores`, 'delegado', { nombre, dorsal })
    ids[clave] = (await alta.json()).jugadorId
  }
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('sanciones', () => {
  it('una roja sanciona el siguiente partido de la competición y al jugarlo queda cumplida', async () => {
    const j1 = await jugar('2026-09-06', [['brais', 'roja']])
    const j2 = await crearPartido('2026-09-13')
    const amistoso = await crearPartido('2026-09-10', null)

    expect(de(await sanciones(), 'brais')).toMatchObject({
      pendientes: [{ competicion: 'Preferente', partidos: 1 }],
      sanciones: [{ partidoId: j1, tipo: 'roja', partidos: 1, cumplidos: 0 }],
    })
    // En la convocatoria del siguiente sale sancionado; en el amistoso, no
    expect(await sancionEnPartido(j2, 'brais')).toEqual({ partidos: 1 })
    expect(await sancionEnPartido(amistoso, 'brais')).toBeNull()
    expect(await sancionEnPartido(j2, 'zoe')).toBeNull()

    await pedir('PUT', `${base()}/partidos/${j2}/resultado`, 'delegado', {
      golesFavor: 0,
      golesContra: 0,
    })
    expect(de(await sanciones(), 'brais')).toMatchObject({
      pendientes: [],
      sanciones: [{ cumplidos: 1 }],
    })
  })

  it('el cuerpo técnico corrige los partidos; el jugador ve todas pero no corrige', async () => {
    const j1 = await jugar('2026-10-04', [['zoe', 'roja']])
    const ajuste = (cuerpo: object, quien = 'delegado') =>
      pedir('PUT', `${base()}/sanciones/ajuste`, quien, {
        partidoId: j1,
        jugadorId: ids.zoe,
        tipo: 'roja',
        ...cuerpo,
      })

    const corregida = await ajuste({ partidos: 3, nota: 'Comité: 3 partidos' })
    expect(corregida.status).toBe(200)
    expect(de((await corregida.json()) as Sanciones, 'zoe')).toMatchObject({
      pendientes: [{ partidos: 3 }],
      sanciones: [{ partidos: 3, calculados: 1, ajustada: true, nota: 'Comité: 3 partidos' }],
    })

    // El jugador las ve todas (la federación las publica), pero no las cambia
    expect(de(await sanciones('jugador'), 'zoe')?.pendientes).toEqual([
      { competicion: 'Preferente', partidos: 3 },
    ])
    expect((await ajuste({ partidos: 0 }, 'jugador')).status).toBe(403)

    // null vuelve a lo de las reglas; una sanción que no existe, 404
    const vuelta = await ajuste({ partidos: null })
    expect(de((await vuelta.json()) as Sanciones, 'zoe')?.pendientes).toEqual([
      { competicion: 'Preferente', partidos: 1 },
    ])
    expect((await ajuste({ tipo: 'ciclo', partidos: 0 })).status).toBe(404)
  })

  it('las reglas de la plantilla se cambian y el cálculo las sigue', async () => {
    const res = await pedir('PATCH', base(), 'admin', { amarillasCiclo: 2, partidosRoja: 2 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      amarillasCiclo: 2,
      partidosRoja: 2,
      partidosDobleAmarilla: 1,
    })
    expect((await pedir('PATCH', base(), 'admin', { amarillasCiclo: 21 })).status).toBe(400)

    await jugar('2026-10-11', [['brais', 'amarilla']], 'Copa')
    expect(de(await sanciones(), 'brais')?.apercibido).toEqual([
      { competicion: 'Copa', amarillas: 1 },
    ])
    await jugar('2026-10-18', [['brais', 'amarilla']], 'Copa')
    expect(de(await sanciones(), 'brais')?.pendientes).toContainEqual({
      competicion: 'Copa',
      partidos: 1,
    })
  })
})
