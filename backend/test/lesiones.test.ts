import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, jugadores, lesiones, membresias, user } from '../src/db/schema/index.js'
import { hoy, sumarDias } from '../src/fechas.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Lesiones de los jugadores (GH-230)

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

const rutaLesiones = (jugador: string, resto = '') =>
  `/plantillas/${ids.senior}/jugadores/${ids[jugador]}/lesiones${resto}`

type Lesion = {
  id: string
  desde: string
  vueltaPrevista: string | null
  alta: string | null
  nota: string | null
}
type Lesiones = { actual: Lesion | null; historial: Lesion[] }
type LesionActual = { desde: string; vueltaPrevista: string | null } | null

async function altaJugador(clave: string, nombre: string, dorsal: number) {
  const res = await pedir('POST', `/plantillas/${ids.senior}/jugadores`, 'delegado', {
    nombre,
    dorsal,
  })
  ids[clave] = (await res.json()).jugadorId
}

const lesionEnLista = async (quien: string, jugador: string) => {
  const lista = (await (
    await pedir('GET', `/plantillas/${ids.senior}/jugadores`, quien)
  ).json()) as { jugadorId: string; lesion: LesionActual }[]
  return lista.find((j) => j.jugadorId === ids[jugador])?.lesion
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
  await altaJugador('brais', 'Brais', 7)
  await altaJugador('zoe', 'Zoe', 9)
  // Zoe es el jugador vinculado al usuario con rol jugador
  await db
    .update(jugadores)
    .set({ usuarioId: ids.jugador })
    .where(eq(jugadores.id, ids.zoe ?? ''))
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('lesiones', () => {
  it('se marca desde hoy, sale en la lista, no admite otra abierta y el alta la pasa al historial', async () => {
    const marcada = await pedir('POST', rutaLesiones('brais'), 'delegado', {
      vueltaPrevista: sumarDias(hoy(), 14),
      nota: '  Reposo  ',
    })
    expect(marcada.status).toBe(201)
    const { actual } = (await marcada.json()) as Lesiones
    expect(actual).toMatchObject({ desde: hoy(), alta: null, nota: 'Reposo' })
    expect(await lesionEnLista('delegado', 'brais')).toEqual({
      desde: hoy(),
      vueltaPrevista: sumarDias(hoy(), 14),
    })

    const otra = await pedir('POST', rutaLesiones('brais'), 'delegado', {})
    expect(otra.status).toBe(409)
    expect((await otra.json()).error.codigo).toBe('lesion_abierta')

    const alta = await pedir('PATCH', rutaLesiones('brais', `/${actual?.id}`), 'delegado', {
      alta: hoy(),
    })
    expect(alta.status).toBe(200)
    const tras = (await alta.json()) as Lesiones
    expect(tras.actual).toBeNull()
    expect(tras.historial).toEqual([expect.objectContaining({ id: actual?.id, alta: hoy() })])
    expect(await lesionEnLista('delegado', 'brais')).toBeNull()
  })

  it('fechas imposibles y notas largas se explican en su campo', async () => {
    const futuro = await pedir('POST', rutaLesiones('brais'), 'delegado', {
      desde: sumarDias(hoy(), 1),
    })
    expect(futuro.status).toBe(400)
    expect((await futuro.json()).error.detalles).toEqual([
      expect.objectContaining({ campo: 'desde' }),
    ])

    const vuelta = await pedir('POST', rutaLesiones('brais'), 'delegado', {
      desde: sumarDias(hoy(), -3),
      vueltaPrevista: sumarDias(hoy(), -5),
    })
    expect(vuelta.status).toBe(400)
    expect((await vuelta.json()).error.detalles).toEqual([
      expect.objectContaining({ campo: 'vueltaPrevista' }),
    ])

    const nota = await pedir('POST', rutaLesiones('brais'), 'delegado', { nota: 'x'.repeat(141) })
    expect(nota.status).toBe(400)
  })

  it('cuenta en los partidos y entrenos de los días que dura, y el día del alta ya no', async () => {
    const res = await pedir('POST', rutaLesiones('brais'), 'delegado', {
      desde: '2026-11-01',
    })
    const { actual } = (await res.json()) as Lesiones
    await pedir('PATCH', rutaLesiones('brais', `/${actual?.id}`), 'delegado', {
      alta: '2026-11-10',
    })

    const lesionEnPartido = async (fecha: string) => {
      const creado = await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
        rival: `Rival ${fecha}`,
        fecha,
      })
      const partido = (await creado.json()) as {
        jugadores: { jugadorId: string; lesion: LesionActual }[]
      }
      return partido.jugadores.find((j) => j.jugadorId === ids.brais)?.lesion
    }
    expect(await lesionEnPartido('2026-10-31')).toBeNull()
    expect(await lesionEnPartido('2026-11-01')).toEqual({
      desde: '2026-11-01',
      vueltaPrevista: null,
    })
    expect(await lesionEnPartido('2026-11-09')).not.toBeNull()
    expect(await lesionEnPartido('2026-11-10')).toBeNull()

    const entreno = await pedir('POST', `/plantillas/${ids.senior}/entrenos`, 'delegado', {
      fecha: '2026-11-05',
    })
    const eid = (await entreno.json()).id
    const lista = (await (
      await pedir('GET', `/plantillas/${ids.senior}/entrenos/${eid}`, 'delegado')
    ).json()) as { jugadores: { jugadorId: string; lesion: LesionActual }[] }
    expect(lista.jugadores.find((j) => j.jugadorId === ids.brais)?.lesion).toMatchObject({
      desde: '2026-11-01',
    })

    // Una registrada por error se borra
    const borrada = await pedir('DELETE', rutaLesiones('brais', `/${actual?.id}`), 'delegado')
    expect(borrada.status).toBe(200)
    expect(((await borrada.json()) as Lesiones).historial).not.toContainEqual(
      expect.objectContaining({ id: actual?.id }),
    )
  })

  it('el rol jugador ve solo la suya, sin nota ni historial, y no las gestiona', async () => {
    await pedir('POST', rutaLesiones('zoe'), 'delegado', { nota: 'Solo cuerpo técnico' })
    await pedir('POST', rutaLesiones('brais'), 'delegado', {})

    const suyas = await pedir('GET', rutaLesiones('zoe'), 'jugador')
    expect(suyas.status).toBe(200)
    const { actual, historial } = (await suyas.json()) as Lesiones
    expect(actual).toMatchObject({ desde: hoy(), nota: null })
    expect(historial).toEqual([])

    expect((await pedir('GET', rutaLesiones('brais'), 'jugador')).status).toBe(403)
    expect((await pedir('POST', rutaLesiones('zoe'), 'jugador', {})).status).toBe(403)

    // En las listas, la suya sí y la de los compañeros no
    expect(await lesionEnLista('jugador', 'zoe')).toMatchObject({ desde: hoy() })
    expect(await lesionEnLista('jugador', 'brais')).toBeNull()
    expect(await lesionEnLista('delegado', 'brais')).toMatchObject({ desde: hoy() })

    const creado = await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
      rival: 'CD Lalín',
      fecha: hoy(),
    })
    const pid = (await creado.json()).id
    const partido = (await (
      await pedir('GET', `/plantillas/${ids.senior}/partidos/${pid}`, 'jugador')
    ).json()) as { jugadores: { jugadorId: string; lesion: LesionActual }[] }
    const lesionDe = (clave: string) =>
      partido.jugadores.find((j) => j.jugadorId === ids[clave])?.lesion
    expect(lesionDe('zoe')).not.toBeNull()
    expect(lesionDe('brais')).toBeNull()
  })

  it('solo de jugadores de la plantilla', async () => {
    const res = await pedir(
      'GET',
      `/plantillas/${ids.senior}/jugadores/${ids.admin}/lesiones`,
      'delegado',
    )
    expect(res.status).toBe(404)
    const quedan = await db
      .select()
      .from(lesiones)
      .where(eq(lesiones.jugadorId, ids.admin ?? ''))
    expect(quedan).toEqual([])
  })
})
