import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { detectarEquipo, palabrasEquipo, yaRegistrado } from '../src/calendario/equipos.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, membresias, user } from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Calendario de la competición: una liga inventada de cinco equipos a ida y vuelta, con un
// descanso por jornada; la jornada 4 de cada vuelta empieza al pie de una página y sigue en la otra

const CALENDARIO = readFileSync(new URL('./fixtures/calendario.pdf', import.meta.url))
const FICHA = readFileSync(new URL('./fixtures/ficha-partido.pdf', import.meta.url))

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

const partidos = () => `/plantillas/${ids.senior}/partidos`

function leer(contenido: Buffer, quien = 'delegado') {
  const form = new FormData()
  form.append(
    'archivo',
    new File([new Uint8Array(contenido)], 'Calendario.pdf', { type: 'application/pdf' }),
  )
  return app.request(`/api${partidos()}/calendario/leer`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

type Leido = {
  competicion: string | null
  temporada: string | null
  equipos: string[]
  equipo: string | null
  jornadas: {
    numero: number
    fecha: string
    enfrentamientos: { local: string; visitante: string }[]
    descansa: string | null
  }[]
  existentes: { fecha: string; rival: string }[]
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
  // Ya apuntado a mano: la jornada 1, jugada el sábado y con el rival escrito a su manera
  await pedir('POST', partidos(), 'delegado', {
    rival: 'Sporting Vilar',
    fecha: '2026-09-12',
    local: true,
  })
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('leer el calendario', () => {
  it('devuelve las jornadas de las dos vueltas, los descansos y el equipo del club', async () => {
    const res = await leer(CALENDARIO)
    expect(res.status).toBe(200)
    const leido = (await res.json()) as Leido
    expect(leido).toMatchObject({
      competicion: 'PRIMERA INVENTADA | GRUPO 9',
      temporada: '2026-2027',
      equipo: 'REXIONAL S.D.',
      existentes: [{ fecha: '2026-09-12', rival: 'Sporting Vilar' }],
    })
    expect(leido.equipos).toEqual([
      'ATLÉTICO PRADO "B"',
      'C.D. RÍO VERDE',
      'REXIONAL S.D.',
      'SPORTING VILAR',
      'U.D. MONTE ALTO',
    ])
    expect(leido.jornadas.map((j) => j.numero)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(leido.jornadas.map((j) => j.enfrentamientos.length)).toEqual(Array(10).fill(2))
    expect(leido.jornadas[0]).toEqual({
      numero: 1,
      fecha: '2026-09-13',
      enfrentamientos: [
        { local: 'REXIONAL S.D.', visitante: 'SPORTING VILAR' },
        { local: 'U.D. MONTE ALTO', visitante: 'ATLÉTICO PRADO "B"' },
      ],
      descansa: 'C.D. RÍO VERDE',
    })
    // «Descansa» a la izquierda
    expect(leido.jornadas[2]?.descansa).toBe('REXIONAL S.D.')
    // La jornada partida entre dos páginas
    expect(leido.jornadas[3]).toMatchObject({
      fecha: '2026-10-04',
      enfrentamientos: [
        { local: 'U.D. MONTE ALTO', visitante: 'C.D. RÍO VERDE' },
        { local: 'REXIONAL S.D.', visitante: 'ATLÉTICO PRADO "B"' },
      ],
      descansa: 'SPORTING VILAR',
    })
    expect(leido.jornadas[9]).toMatchObject({
      fecha: '2026-11-15',
      enfrentamientos: [
        { local: 'REXIONAL S.D.', visitante: 'C.D. RÍO VERDE' },
        { local: 'SPORTING VILAR', visitante: 'ATLÉTICO PRADO "B"' },
      ],
    })
  })

  it('rechaza lo que no es un calendario y a quien no es delegado', async () => {
    const otro = await leer(Buffer.from('no soy un pdf'))
    expect(otro.status).toBe(400)
    expect((await otro.json()).error).toMatchObject({ codigo: 'calendario_no_legible' })
    const acta = await leer(FICHA)
    expect(acta.status).toBe(400)
    expect((await acta.json()).error.mensaje).toMatch(/no tiene jornadas/)
    expect((await leer(CALENDARIO, 'jugador')).status).toBe(403)
  })
})

describe('importar el calendario', () => {
  it('crea los partidos elegidos y omite los que ya están', async () => {
    const res = await pedir('POST', `${partidos()}/calendario`, 'delegado', {
      partidos: [
        { fecha: '2026-09-13', rival: 'SPORTING VILAR', local: true },
        { fecha: '2026-09-20', rival: 'U.D. MONTE ALTO', local: false },
        { fecha: '2026-10-04', rival: 'ATLÉTICO PRADO "B"', local: true },
        // Repetido en la misma petición
        { fecha: '2026-10-04', rival: 'ATLÉTICO PRADO "B"', local: true },
      ],
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      creados: 2,
      omitidos: [
        { fecha: '2026-09-13', rival: 'SPORTING VILAR' },
        { fecha: '2026-10-04', rival: 'ATLÉTICO PRADO "B"' },
      ],
    })
    const lista = (await (
      await pedir('GET', `${partidos()}?cuando=pasados`, 'jugador')
    ).json()) as {
      fecha: string
      rival: string
      local: boolean | null
      estado: string
      hora: string | null
      competicion: string | null
    }[]
    expect(lista.map((p) => [p.fecha, p.rival, p.local])).toEqual([
      ['2026-10-04', 'ATLÉTICO PRADO "B"', true],
      ['2026-09-20', 'U.D. MONTE ALTO', false],
      ['2026-09-12', 'Sporting Vilar', true],
    ])
    expect(lista[0]).toMatchObject({ estado: 'programado', hora: null, competicion: null })

    // Importar otra vez no duplica nada
    const otraVez = await pedir('POST', `${partidos()}/calendario`, 'delegado', {
      partidos: [{ fecha: '2026-09-20', rival: 'U.D. MONTE ALTO', local: false }],
    })
    expect((await otraVez.json()).creados).toBe(0)
  })

  it('solo delegado o superior, y con algún partido', async () => {
    const cuerpo = { partidos: [{ fecha: '2026-11-15', rival: 'C.D. RÍO VERDE', local: true }] }
    expect((await pedir('POST', `${partidos()}/calendario`, 'jugador', cuerpo)).status).toBe(403)
    expect(
      (await pedir('POST', `${partidos()}/calendario`, 'delegado', { partidos: [] })).status,
    ).toBe(400)
  })
})

describe('nombres de los equipos', () => {
  it('se comparan por las palabras que los distinguen', () => {
    expect([...palabrasEquipo('C.D. CIUDAD JARDÍN "B"')]).toEqual(['CIUDAD', 'JARDIN'])
    expect([...palabrasEquipo('SPORTING CORUÑES SDC "B"')]).toEqual(['SPORTING', 'CORUNES'])
    expect(detectarEquipo(['C.D. CIUDAD JARDÍN "B"', 'C.D. CIUDAD'], 'CD Ciudad')).toBe(
      'C.D. CIUDAD',
    )
    expect(detectarEquipo(['EIRÍS S.D.', 'MARAVILLAS S.D.'], 'Eiris SD')).toBe('EIRÍS S.D.')
    expect(detectarEquipo(['EIRÍS S.D.', 'MARAVILLAS S.D.'], 'Club inventado')).toBeNull()
  })

  it('un partido ya está si coincide el día o el rival a pocos días', () => {
    const hay = [{ fecha: '2026-09-12', rival: 'Sporting Coruñés B' }]
    expect(yaRegistrado({ fecha: '2026-09-13', rival: 'SPORTING CORUÑES SDC "B"' }, hay)).toBe(true)
    expect(yaRegistrado({ fecha: '2026-09-12', rival: 'VIOÑO C.F.' }, hay)).toBe(true)
    expect(yaRegistrado({ fecha: '2026-09-20', rival: 'SPORTING CORUÑES SDC "B"' }, hay)).toBe(
      false,
    )
    expect(yaRegistrado({ fecha: '2026-09-13', rival: 'VIOÑO C.F.' }, hay)).toBe(false)
  })
})
