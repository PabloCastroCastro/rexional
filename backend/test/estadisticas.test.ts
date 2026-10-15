import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, jugadores, membresias, user } from '../src/db/schema/index.js'
import { registrar } from '../src/estadisticas.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

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

type Partido = {
  id: string
  estado: string
  golesFavor: number | null
  golesContra: number | null
  jugadores: {
    jugadorId: string
    nombre: string
    titular: boolean | null
    minutos: number | null
  }[]
  eventos: {
    id: string
    jugadorId: string | null
    tipo: string
    minuto: number | null
    origen: string
  }[]
}

// 13 jugadores en el Senior 2026-27 (J1 … J13); J1 y J2 también jugaron el Senior 2025-26
const J = (n: number) => ids[`J${n}`] ?? ''
const base = (plantilla = 'senior') => `/plantillas/${ids[plantilla]}/partidos`

async function partidoConvocado(convocados: number[], plantilla = 'senior', fecha = '2026-10-11') {
  const res = await pedir('POST', base(plantilla), 'delegado', { rival: 'Rosalía Mera', fecha })
  const partido = (await res.json()) as Partido
  const conv = await pedir('PUT', `${base(plantilla)}/${partido.id}/convocados`, 'delegado', {
    jugadores: convocados.map(J),
  })
  expect(conv.status).toBe(200)
  return partido.id
}

const ruta = (pid: string, resto = '', plantilla = 'senior') => `${base(plantilla)}/${pid}${resto}`

async function leer(pid: string, plantilla = 'senior') {
  return (await (await pedir('GET', ruta(pid, '', plantilla), 'jugador')).json()) as Partido
}

const minutosDe = (p: Partido) =>
  Object.fromEntries(
    p.jugadores.filter((j) => j.titular !== null).map((j) => [j.nombre, j.minutos]),
  )

const evento = (pid: string, cuerpo: Record<string, unknown>, plantilla = 'senior') =>
  pedir('POST', ruta(pid, '/eventos', plantilla), 'delegado', cuerpo)

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'otroJugador']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Estadísticas' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  for (const [clave, temporada] of [
    ['senior25', '2025-26'],
    ['senior', '2026-27'],
  ] as const) {
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada,
    })
    ids[clave] = (await res.json()).id
  }
  await db.insert(membresias).values(
    ['senior', 'senior25'].flatMap((p) => [
      { plantillaId: ids[p] ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' as const },
      { plantillaId: ids[p] ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' as const },
      { plantillaId: ids[p] ?? '', usuarioId: ids.otroJugador ?? '', rol: 'jugador' as const },
    ]),
  )
  const lista = await db
    .insert(jugadores)
    .values(
      Array.from({ length: 13 }, (_, k) => ({
        clubId: club.id,
        nombre: `J${k + 1}`,
        usuarioId: k === 0 ? ids.jugador : k === 1 ? ids.otroJugador : null,
      })),
    )
    .returning()
  for (const j of lista) ids[j.nombre] = j.id
  await db.insert(fichas).values([
    ...lista.map((j, k) => ({
      plantillaId: ids.senior ?? '',
      jugadorId: j.id,
      clubId: club.id,
      temporada: '2026-27',
      dorsal: k + 1,
    })),
    ...[1, 2].map((n) => ({
      plantillaId: ids.senior25 ?? '',
      jugadorId: J(n),
      clubId: club.id,
      temporada: '2025-26',
      dorsal: n,
    })),
  ])
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('resultado', () => {
  it('un partido nuevo está programado, sin resultado ni eventos', async () => {
    const pid = await partidoConvocado([1, 2])
    expect(await leer(pid)).toMatchObject({
      estado: 'programado',
      golesFavor: null,
      golesContra: null,
      eventos: [],
    })
    expect((await leer(pid)).jugadores[0]).toMatchObject({ titular: null, minutos: null })
  })

  it('poner el resultado marca el partido como jugado; quitarlo o aplazarlo lo deshace', async () => {
    const pid = await partidoConvocado([1, 2])
    expect(
      (await pedir('PUT', ruta(pid, '/resultado'), 'jugador', { golesFavor: 1, golesContra: 0 }))
        .status,
    ).toBe(403)
    expect(
      (await pedir('PUT', ruta(pid, '/resultado'), 'delegado', { golesFavor: -1, golesContra: 0 }))
        .status,
    ).toBe(400)

    const res = await pedir('PUT', ruta(pid, '/resultado'), 'delegado', {
      golesFavor: 7,
      golesContra: 1,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ estado: 'jugado', golesFavor: 7, golesContra: 1 })

    const aplazado = await pedir('PATCH', ruta(pid), 'delegado', { estado: 'aplazado' })
    expect(await aplazado.json()).toMatchObject({ estado: 'aplazado', golesFavor: null })
    // A jugado solo se llega con el resultado
    expect((await pedir('PATCH', ruta(pid), 'delegado', { estado: 'jugado' })).status).toBe(400)

    await pedir('PUT', ruta(pid, '/resultado'), 'delegado', { golesFavor: 2, golesContra: 2 })
    const quitado = await pedir('DELETE', ruta(pid, '/resultado'), 'delegado')
    expect(await quitado.json()).toMatchObject({ estado: 'programado', golesFavor: null })
  })

  it('el listado de partidos lleva el estado y el resultado', async () => {
    const pid = await partidoConvocado([1], 'senior', '2026-09-01')
    await pedir('PUT', ruta(pid, '/resultado'), 'delegado', { golesFavor: 3, golesContra: 0 })
    const pasados = (await (
      await pedir('GET', `${base()}?cuando=pasados`, 'jugador')
    ).json()) as Partido[]
    expect(pasados.find((p) => p.id === pid)).toMatchObject({ estado: 'jugado', golesFavor: 3 })
  })
})

describe('titulares, cambios y eventos', () => {
  it('titulares y suplentes entre los convocados, con sus minutos', async () => {
    const pid = await partidoConvocado([1, 2, 3, 4])
    const noConvocado = await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1), J(5)],
      suplentes: [],
    })
    expect(noConvocado.status).toBe(400)
    expect((await noConvocado.json()).error.codigo).toBe('no_convocado')

    const doce = await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: Array.from({ length: 12 }, (_, k) => J(k + 1)),
      suplentes: [],
    })
    expect(doce.status).toBe(400)

    const res = await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1), J(2)],
      suplentes: [J(3), J(4)],
    })
    expect(res.status).toBe(200)
    expect(minutosDe(await res.json())).toEqual({ J1: 90, J2: 90, J3: 0, J4: 0 })
  })

  it('los cambios y las rojas recalculan los minutos', async () => {
    const pid = await partidoConvocado([1, 2, 3, 4])
    await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1), J(2)],
      suplentes: [J(3), J(4)],
    })
    expect((await evento(pid, { jugadorId: J(2), tipo: 'sale', minuto: 59 })).status).toBe(201)
    const entra = await evento(pid, { jugadorId: J(3), tipo: 'entra', minuto: 59 })
    expect(entra.status).toBe(201)
    expect(minutosDe(await entra.json())).toEqual({ J1: 90, J2: 59, J3: 31, J4: 0 })

    const roja = await evento(pid, { jugadorId: J(1), tipo: 'roja', minuto: 81 })
    const conRoja = (await roja.json()) as Partido
    expect(minutosDe(conRoja)).toMatchObject({ J1: 81 })
    expect(conRoja.eventos.map((e) => [e.tipo, e.minuto, e.origen])).toEqual([
      ['sale', 59, 'manual'],
      ['entra', 59, 'manual'],
      ['roja', 81, 'manual'],
    ])

    // Borrar la roja devuelve los minutos
    const idRoja = conRoja.eventos.find((e) => e.tipo === 'roja')?.id
    const sinRoja = await pedir('DELETE', ruta(pid, `/eventos/${idRoja}`), 'delegado')
    expect(minutosDe(await sinRoja.json())).toMatchObject({ J1: 90 })
  })

  it('rechaza lo que no cuadra y no guarda nada', async () => {
    const pid = await partidoConvocado([1, 2, 3, 4])
    await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1), J(2)],
      suplentes: [J(3), J(4)],
    })
    await pedir('PUT', ruta(pid, '/resultado'), 'delegado', { golesFavor: 1, golesContra: 0 })
    for (const cuerpo of [
      { jugadorId: J(1), tipo: 'entra', minuto: 50 },
      { jugadorId: J(4), tipo: 'gol', minuto: 50 },
      { jugadorId: J(3), tipo: 'sale', minuto: 50 },
      { tipo: 'gol', minuto: 20 },
      { jugadorId: J(5), tipo: 'gol', minuto: 20 },
    ]) {
      const res = await evento(pid, cuerpo)
      expect(res.status, JSON.stringify(cuerpo)).toBe(400)
    }
    expect((await evento(pid, { jugadorId: J(1), tipo: 'gol', minuto: 19 })).status).toBe(201)
    const segundo = await evento(pid, { tipo: 'gol_propia', minuto: 70 })
    expect(segundo.status).toBe(400)
    expect((await segundo.json()).error.mensaje).toMatch(/2 goles a favor/)
    // Bajar el resultado por debajo de los goles registrados tampoco
    const bajar = await pedir('PUT', ruta(pid, '/resultado'), 'delegado', {
      golesFavor: 0,
      golesContra: 0,
    })
    expect(bajar.status).toBe(400)
    const partido = await leer(pid)
    expect(partido.golesFavor).toBe(1)
    expect(partido.eventos).toHaveLength(1)
  })

  it('un lote se registra entero o no se registra', async () => {
    const pid = await partidoConvocado([1, 2, 3])
    await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1), J(2)],
      suplentes: [J(3)],
    })
    const lote = (eventos: Record<string, unknown>[], quien = 'delegado') =>
      pedir('POST', ruta(pid, '/eventos/lote'), quien, { eventos })
    expect((await lote([{ jugadorId: J(3), tipo: 'entra', minuto: 60 }], 'jugador')).status).toBe(
      403,
    )
    expect((await lote([])).status).toBe(400)

    // El cambio a la vez: quien entra y quien sale
    const cambio = await lote([
      { jugadorId: J(3), tipo: 'entra', minuto: 60 },
      { jugadorId: J(2), tipo: 'sale', minuto: 60 },
    ])
    expect(cambio.status).toBe(201)
    expect(minutosDe(await cambio.json())).toEqual({ J1: 90, J2: 60, J3: 30 })

    // Gol de quien ya ha salido con asistencia válida: no se guarda ninguno de los dos
    const mal = await lote([
      { jugadorId: J(2), tipo: 'gol', minuto: 70 },
      { jugadorId: J(1), tipo: 'asistencia', minuto: 70 },
    ])
    expect(mal.status).toBe(400)
    expect((await leer(pid)).eventos).toHaveLength(2)

    const gol = await lote([
      { jugadorId: J(3), tipo: 'gol', minuto: 70 },
      { jugadorId: J(1), tipo: 'asistencia', minuto: 70 },
    ])
    expect(((await gol.json()) as Partido).eventos.map((e) => e.tipo)).toEqual([
      'entra',
      'sale',
      'gol',
      'asistencia',
    ])
  })

  it('no se borra la entrada de quien después sale', async () => {
    const pid = await partidoConvocado([1, 2])
    await pedir('PUT', ruta(pid, '/participaciones'), 'delegado', {
      titulares: [J(1)],
      suplentes: [J(2)],
    })
    await evento(pid, { jugadorId: J(1), tipo: 'sale', minuto: 46 })
    const entra = (await (
      await evento(pid, { jugadorId: J(2), tipo: 'entra', minuto: 46 })
    ).json()) as Partido
    await evento(pid, { jugadorId: J(2), tipo: 'sale', minuto: 80 })
    const id = entra.eventos.find((e) => e.tipo === 'entra')?.id
    expect((await pedir('DELETE', ruta(pid, `/eventos/${id}`), 'delegado')).status).toBe(400)
    expect(
      (
        await pedir(
          'DELETE',
          ruta(pid, '/eventos/00000000-0000-7000-8000-000000000000'),
          'delegado',
        )
      ).status,
    ).toBe(404)
  })

  it('no se saca de la convocatoria a quien tiene estadísticas', async () => {
    const pid = await partidoConvocado([1, 2, 3])
    await evento(pid, { jugadorId: J(2), tipo: 'amarilla', minuto: 30 })
    const res = await pedir('PUT', ruta(pid, '/convocados'), 'delegado', {
      jugadores: [J(1), J(3)],
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatchObject({ codigo: 'convocado_con_estadisticas' })
    // Quitar a uno sin estadísticas sí
    expect(
      (await pedir('PUT', ruta(pid, '/convocados'), 'delegado', { jugadores: [J(1), J(2)] }))
        .status,
    ).toBe(200)
  })
})

describe('registro desde una fuente', () => {
  it('sustituye lo que esa fuente registró antes y conserva lo manual', async () => {
    const pid = await partidoConvocado([1, 2, 3])
    await evento(pid, { jugadorId: J(3), tipo: 'amarilla', minuto: 10 })
    const acta = (goles: number) => ({
      resultado: { golesFavor: goles, golesContra: 1 },
      participaciones: [
        { jugadorId: J(1), titular: true },
        { jugadorId: J(2), titular: false },
        { jugadorId: J(3), titular: true },
      ],
      eventos: [
        { jugadorId: J(1), tipo: 'sale' as const, minuto: 48 },
        { jugadorId: J(2), tipo: 'entra' as const, minuto: 48 },
        ...Array.from({ length: goles }, () => ({
          jugadorId: J(2),
          tipo: 'gol' as const,
          minuto: 60,
        })),
      ],
    })
    await db.transaction((tx) => registrar(tx, pid, 'acta', acta(3)))
    await db.transaction((tx) => registrar(tx, pid, 'acta', acta(2)))
    const partido = await leer(pid)
    expect(partido).toMatchObject({ estado: 'jugado', golesFavor: 2, golesContra: 1 })
    expect(partido.eventos.filter((e) => e.origen === 'acta')).toHaveLength(4)
    expect(partido.eventos.filter((e) => e.origen === 'manual').map((e) => e.tipo)).toEqual([
      'amarilla',
    ])
    expect(minutosDe(partido)).toEqual({ J1: 48, J2: 42, J3: 90 })

    // Lo que no cuadra no se guarda
    await expect(
      db.transaction((tx) =>
        registrar(tx, pid, 'acta', { ...acta(1), resultado: { golesFavor: 0, golesContra: 0 } }),
      ),
    ).rejects.toThrow(/goles a favor/)
    await expect(
      db.transaction((tx) =>
        registrar(tx, pid, 'acta', {
          resultado: null,
          participaciones: [{ jugadorId: J(9), titular: true }],
          eventos: [],
        }),
      ),
    ).rejects.toThrow(/convocados/)
    expect((await leer(pid)).golesFavor).toBe(2)
  })
})

describe('estadísticas acumuladas', () => {
  it('de la temporada, solo de partidos jugados; el jugador solo ve las suyas', async () => {
    // Partido jugado: 2-1, J1 marca dos (uno asistido por J2)
    const pid = await partidoConvocado([1, 2], 'senior25', '2025-10-05')
    await pedir('PUT', ruta(pid, '/resultado', 'senior25'), 'delegado', {
      golesFavor: 2,
      golesContra: 1,
    })
    await pedir('PUT', ruta(pid, '/participaciones', 'senior25'), 'delegado', {
      titulares: [J(1), J(2)],
      suplentes: [],
    })
    for (const e of [
      { jugadorId: J(1), tipo: 'gol', minuto: 10 },
      { jugadorId: J(2), tipo: 'asistencia', minuto: 10 },
      { jugadorId: J(1), tipo: 'gol', minuto: 50 },
      { jugadorId: J(2), tipo: 'amarilla', minuto: 55 },
    ]) {
      expect((await evento(pid, e, 'senior25')).status).toBe(201)
    }
    // Otro partido sin jugar con un gol apuntado: no cuenta
    const sinJugar = await partidoConvocado([1], 'senior25', '2025-10-12')
    await evento(sinJugar, { jugadorId: J(1), tipo: 'gol', minuto: 5 }, 'senior25')

    const res = await pedir('GET', `/plantillas/${ids.senior25}/estadisticas`, 'delegado')
    expect(res.status).toBe(200)
    const datos = await res.json()
    expect(datos.equipo).toEqual({
      jugados: 1,
      ganados: 1,
      empatados: 0,
      perdidos: 0,
      golesFavor: 2,
      golesContra: 1,
    })
    expect(datos.jugadores).toEqual([
      expect.objectContaining({
        nombre: 'J1',
        partidos: 1,
        titularidades: 1,
        minutos: 90,
        goles: 2,
      }),
      expect.objectContaining({
        nombre: 'J2',
        partidos: 1,
        asistencias: 1,
        amarillas: 1,
        goles: 0,
      }),
    ])

    const suyas = await (
      await pedir('GET', `/plantillas/${ids.senior25}/estadisticas`, 'jugador')
    ).json()
    expect(suyas.jugadores.map((j: { nombre: string }) => j.nombre)).toEqual(['J1'])
    expect(suyas.equipo.jugados).toBe(1)
  })

  it('trayectoria del jugador por temporadas y en total', async () => {
    const pid = await partidoConvocado([1], 'senior', '2026-09-20')
    await pedir('PUT', ruta(pid, '/resultado'), 'delegado', { golesFavor: 1, golesContra: 0 })
    await evento(pid, { jugadorId: J(1), tipo: 'gol', minuto: 33 })

    const url = (n: number) => `/clubes/${ids.club}/jugadores/${J(n)}/estadisticas`
    const res = await pedir('GET', url(1), 'jugador')
    expect(res.status).toBe(200)
    const trayectoria = await res.json()
    // La más reciente primero; en 2025-26, los dos goles del bloque anterior
    type Temporada = { temporada: string; goles: number; minutos: number }
    const temporadas = trayectoria.temporadas as Temporada[]
    expect(temporadas.map((t) => t.temporada)).toEqual(['2026-27', '2025-26'])
    expect(temporadas[1]).toMatchObject({ goles: 2, minutos: 90, partidos: 1 })
    expect(temporadas[0]?.goles).toBeGreaterThanOrEqual(1)
    const suma = (clave: 'goles' | 'minutos') => temporadas.reduce((t, x) => t + x[clave], 0)
    expect(trayectoria.totales).toMatchObject({ goles: suma('goles'), minutos: suma('minutos') })

    // Un jugador no ve la de otro; el delegado sí
    expect((await pedir('GET', url(2), 'jugador')).status).toBe(403)
    expect((await pedir('GET', url(2), 'delegado')).status).toBe(200)
    expect(
      (
        await pedir(
          'GET',
          `/clubes/${ids.club}/jugadores/00000000-0000-7000-8000-000000000000/estadisticas`,
          'delegado',
        )
      ).status,
    ).toBe(404)
  })
})
