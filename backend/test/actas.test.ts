import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, jugadores, membresias, user } from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Acta del partido: el CD Rexional (visitante en la ficha de prueba) gana 1-7 al CD Proba Rival

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

function subir(pid: string, contenido: Buffer, quien = 'delegado', nombre = 'FichaPartido.pdf') {
  const form = new FormData()
  form.append('archivo', new File([new Uint8Array(contenido)], nombre, { type: 'application/pdf' }))
  return app.request(`/api${ruta(pid, '/acta')}`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

const ruta = (pid: string, resto = '') => `/plantillas/${ids.senior}/partidos/${pid}${resto}`

async function crearPartido(datos: Record<string, unknown> = {}) {
  const res = await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
    rival: 'CD Proba Rival',
    fecha: '2026-10-11',
    local: false,
    ...datos,
  })
  return (await res.json()).id as string
}

type JugadorActa = { dorsal: number | null; nombre: string; jugadorId: string | null }
type Lectura = {
  equipo: string
  golesFavor: number
  golesContra: number
  titulares: JugadorActa[]
  suplentes: JugadorActa[]
  goles: { nombre: string; jugadorId: string | null; enPropia: boolean }[]
  tarjetas: (JugadorActa & { tipo: string | null })[]
  avisos: string[]
}

// La plantilla tiene a los 16 del CD Rexional en la ficha; Noel solo con el nombre y otro dorsal,
// así que no se empareja solo
const PLANTILLA: [nombre: string, apellidos: string | null, dorsal: number | null][] = [
  ['Paulo', 'Pena Rivas', 1],
  ['Diego', 'Otero', 2],
  ['Issa', null, 4],
  ['Carlos', 'Liñares', 5],
  ['Pablo', 'Castro', 6],
  ['Hugo', 'Vilas Doval', 7],
  ['Daniel', 'Gómez García', 8],
  ['Anxo', 'Barreiro Varela', 10],
  ['Noel', null, 33],
  ['Roi', 'Rivas Mosquera', 14],
  ['Hugo', 'Loureiro', 15],
  ['Mateo', 'Núñez Seoane', 17],
  ['Diego', 'Mosquera Barreiro', 18],
  ['Iago', 'Varela', 19],
  ['Roi', 'Gómez Mosquera', 20],
  ['Anxo', 'Carballo Varela', 21],
]

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
  const lista = await db
    .insert(jugadores)
    .values(PLANTILLA.map(([nombre, apellidos]) => ({ clubId: club.id, nombre, apellidos })))
    .returning()
  lista.forEach((j, k) => {
    ids[`${j.nombre} ${j.apellidos ?? ''}`.trim()] = j.id
    ids[`#${PLANTILLA[k]?.[2]}`] = j.id
  })
  await db.insert(fichas).values(
    lista.map((j, k) => ({
      plantillaId: ids.senior ?? '',
      jugadorId: j.id,
      clubId: club.id,
      temporada: '2026-27',
      dorsal: PLANTILLA[k]?.[2] ?? null,
    })),
  )
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('subir y leer el acta', () => {
  it('guarda el PDF y devuelve lo leído desde nuestro lado, sin registrar nada', async () => {
    const pid = await crearPartido()
    const res = await subir(pid, FICHA)
    expect(res.status).toBe(200)
    const { acta, lectura, error } = (await res.json()) as {
      acta: { nombreArchivo: string; tamano: number }
      lectura: Lectura
      error: null
    }
    expect(error).toBeNull()
    expect(acta).toMatchObject({ nombreArchivo: 'FichaPartido.pdf', tamano: FICHA.length })
    expect(lectura).toMatchObject({ equipo: 'visitante', golesFavor: 7, golesContra: 1 })
    // 15 de 16 emparejados; Noel queda para elegir
    const todos = [...lectura.titulares, ...lectura.suplentes]
    expect(todos.filter((j) => j.jugadorId)).toHaveLength(15)
    expect(todos.find((j) => !j.jugadorId)?.nombre).toBe('BARREIRO NÚÑEZ, NOEL')
    expect(lectura.titulares.find((j) => j.dorsal === 6)?.jugadorId).toBe(ids['Pablo Castro'])
    expect(lectura.goles.filter((g) => g.jugadorId === ids['Daniel Gómez García'])).toHaveLength(5)
    expect(lectura.tarjetas).toEqual([
      expect.objectContaining({ jugadorId: ids['Anxo Barreiro Varela'], tipo: 'amarilla' }),
    ])
    expect(lectura.avisos).toEqual([expect.stringMatching(/un jugador del acta sin emparejar/)])

    // Aún no hay nada registrado, pero el partido ya tiene el acta
    const partido = await (await pedir('GET', ruta(pid), 'jugador')).json()
    expect(partido).toMatchObject({ estado: 'programado', eventos: [] })
    expect(partido.acta).toMatchObject({ nombreArchivo: 'FichaPartido.pdf' })

    // Se descarga tal cual
    const pdf = await pedir('GET', ruta(pid, '/acta'), 'jugador')
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect(Buffer.from(await pdf.arrayBuffer()).equals(FICHA)).toBe(true)
  })

  it('sin saber si fue en casa, el equipo sale del nombre del club', async () => {
    const pid = await crearPartido({ local: null })
    const { lectura } = await (await subir(pid, FICHA)).json()
    expect(lectura).toMatchObject({ equipo: 'visitante', avisos: [expect.any(String)] })
  })

  it('rechaza lo que no es un PDF, lo que pasa de 2 MB y a quien no es del cuerpo técnico', async () => {
    const pid = await crearPartido()
    expect((await subir(pid, Buffer.from('hola'))).status).toBe(400)
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2 * 1024 * 1024)])
    const res = await subir(pid, grande)
    expect(res.status).toBe(413)
    expect((await res.json()).error.codigo).toBe('acta_demasiado_grande')
    expect((await subir(pid, FICHA, 'jugador')).status).toBe(403)
    expect((await pedir('GET', ruta(pid, '/acta'), 'jugador')).status).toBe(404)
  })

  it('un PDF que no es una ficha se guarda, pero no se lee', async () => {
    const pid = await crearPartido()
    const otro = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    )
    const res = await subir(pid, otro, 'delegado', 'otro.pdf')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ lectura: null, error: expect.stringMatching(/ficha/) })
    const confirmar = await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {})
    expect(confirmar.status).toBe(400)
  })
})

describe('confirmar el acta', () => {
  it('registra convocatoria, resultado, titulares, cambios, goles y tarjetas', async () => {
    const pid = await crearPartido({ hora: null })
    // Convocado de antes que no está en el acta: deja de estarlo
    await pedir('PUT', ruta(pid, '/convocados'), 'delegado', { jugadores: [ids['#1'], ids['#33']] })
    await subir(pid, FICHA)
    const res = await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {
      jugadores: [{ nombre: 'BARREIRO NÚÑEZ, NOEL', jugadorId: ids['#33'] }],
    })
    expect(res.status).toBe(200)
    const partido = await res.json()
    expect(partido).toMatchObject({
      estado: 'jugado',
      golesFavor: 7,
      golesContra: 1,
      competicion: 'TERCEIRA PROBA (GRUPO 1) · Jornada 5',
      lugar: 'Campo de Proba, Rexional',
      hora: '20:00',
    })
    type Fila = {
      jugadorId: string
      convocado: boolean
      titular: boolean | null
      minutos: number | null
    }
    const fila = (dorsal: number) =>
      (partido.jugadores as Fila[]).find((j) => j.jugadorId === ids[`#${dorsal}`])
    expect((partido.jugadores as Fila[]).filter((j) => j.convocado)).toHaveLength(16)
    expect(fila(8)).toMatchObject({ titular: true, minutos: 90 })
    expect(fila(18)).toMatchObject({ titular: true, minutos: 48 })
    expect(fila(14)).toMatchObject({ titular: false, minutos: 42 })
    expect(fila(33)).toMatchObject({ titular: false, minutos: 31 })
    const tipos = (partido.eventos as { tipo: string; origen: string }[]).map((e) => e.tipo)
    expect(tipos.filter((t) => t === 'gol')).toHaveLength(7)
    expect(tipos.filter((t) => t === 'entra')).toHaveLength(5)
    expect(tipos.filter((t) => t === 'amarilla')).toHaveLength(1)
    expect(new Set((partido.eventos as { origen: string }[]).map((e) => e.origen))).toEqual(
      new Set(['acta']),
    )

    // Volver a confirmar sustituye lo importado y conserva lo manual
    await pedir('POST', ruta(pid, '/eventos'), 'delegado', {
      jugadorId: ids['#8'],
      tipo: 'asistencia',
      minuto: 19,
    })
    const otra = await (
      await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {
        jugadores: [{ nombre: 'BARREIRO NÚÑEZ, NOEL', jugadorId: ids['#33'] }],
      })
    ).json()
    const origenes = (otra.eventos as { origen: string }[]).map((e) => e.origen)
    expect(origenes.filter((o) => o === 'acta')).toHaveLength(tipos.length)
    expect(origenes.filter((o) => o === 'manual')).toHaveLength(1)

    // Las estadísticas de la temporada ya cuentan el partido
    const est = await (
      await pedir('GET', `/plantillas/${ids.senior}/estadisticas`, 'delegado')
    ).json()
    expect(est.equipo).toMatchObject({ jugados: 1, ganados: 1, golesFavor: 7, golesContra: 1 })
  })

  it('rechaza un jugador de fuera de la plantilla o elegido dos veces', async () => {
    const pid = await crearPartido()
    await subir(pid, FICHA)
    const ajeno = await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {
      jugadores: [
        { nombre: 'BARREIRO NÚÑEZ, NOEL', jugadorId: '00000000-0000-7000-8000-000000000000' },
      ],
    })
    expect((await ajeno.json()).error.codigo).toBe('jugador_ajeno')
    const dos = await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {
      jugadores: [{ nombre: 'BARREIRO NÚÑEZ, NOEL', jugadorId: ids['#8'] }],
    })
    expect((await dos.json()).error.codigo).toBe('jugador_repetido')
    expect((await pedir('POST', ruta(pid, '/acta/confirmar'), 'jugador', {})).status).toBe(403)
  })

  it('sin un jugador, sus cambios y goles no cuentan, pero el resultado sí', async () => {
    const pid = await crearPartido()
    await subir(pid, FICHA)
    const res = await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {
      jugadores: [{ nombre: 'GÓMEZ GARCÍA, DANIEL', jugadorId: null }],
    })
    expect(res.status).toBe(200)
    const partido = await res.json()
    expect(partido.golesFavor).toBe(7)
    expect((partido.eventos as { tipo: string }[]).filter((e) => e.tipo === 'gol')).toHaveLength(2)
  })

  it('quitar el acta conserva lo registrado', async () => {
    const pid = await crearPartido()
    await subir(pid, FICHA)
    await pedir('POST', ruta(pid, '/acta/confirmar'), 'delegado', {})
    expect((await pedir('DELETE', ruta(pid, '/acta'), 'delegado')).status).toBe(204)
    const partido = await (await pedir('GET', ruta(pid), 'jugador')).json()
    expect(partido).toMatchObject({ acta: null, estado: 'jugado', golesFavor: 7 })
    expect((await pedir('DELETE', ruta(pid, '/acta'), 'delegado')).status).toBe(404)
  })
})
