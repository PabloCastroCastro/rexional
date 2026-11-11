import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, membresias, plantillas, user } from '../src/db/schema/index.js'
import { FichaNoLegible, leerFichaEquipo } from '../src/ficha-equipo/leer.js'
import { capitalizar, repararTildes, separarNombre } from '../src/ficha-equipo/nombres.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Plantilla desde la ficha del equipo de la federación (GH-197). La ficha de prueba es inventada,
// con la estructura de la de la FGF y sus tildes mal codificadas: ocho jugadores y cuatro personas
// en el cuerpo técnico; en la de dos páginas, los jugadores siguen en la segunda.

const FICHA = readFileSync(new URL('./fixtures/ficha-equipo.pdf', import.meta.url))
const DOS_PAGINAS = readFileSync(
  new URL('./fixtures/ficha-equipo-dos-paginas.pdf', import.meta.url),
)
const ACTA = readFileSync(new URL('./fixtures/ficha-partido.pdf', import.meta.url))

describe('textos de la ficha', () => {
  it('arregla las tildes mal codificadas', () => {
    expect(repararTildes('LÃ“PEZ MUIÃ‘O, RAÃšL')).toBe('LÓPEZ MUIÑO, RAÚL')
    expect(repararTildes('VÃ•ZQUEZ, ADRIÃ•N')).toBe('VÁZQUEZ, ADRIÁN')
    expect(repararTildes('2Âª FUTGAL')).toBe('2ª FUTGAL')
    expect(repararTildes('Categoría: SÃO')).toBe('Categoría: SÃO')
  })

  it('pone los nombres en minúsculas con las partículas', () => {
    expect(capitalizar('FERNÁNDEZ DE LA FUENTE')).toBe('Fernández de la Fuente')
    expect(capitalizar('DE LA IGLESIA')).toBe('De la Iglesia')
    expect(capitalizar('PÉREZ-LLORCA DO CAMPO')).toBe('Pérez-Llorca do Campo')
    expect(capitalizar('SOFAN S.D. "B"', { abreviaturas: true })).toBe('Sofan S.D. "B"')
    expect(capitalizar('CD PROBA', { abreviaturas: true })).toBe('CD Proba')
  })

  it('separa apellidos y nombre', () => {
    expect(separarNombre('BLANCO CAMBON, DIEGO')).toEqual({
      nombre: 'Diego',
      apellidos: 'Blanco Cambon',
    })
    expect(separarNombre('PELÉ')).toEqual({ nombre: 'Pelé', apellidos: null })
  })
})

describe('leer la ficha del equipo', () => {
  it('lee el equipo, la categoría, los jugadores y el cuerpo técnico', async () => {
    const ficha = await leerFichaEquipo(FICHA)
    expect(ficha.equipo).toBe('CD Proba "B"')
    expect(ficha.categoria).toBe('2ª Futgal')
    expect(ficha.jugadores).toHaveLength(8)
    expect(ficha.jugadores[1]).toEqual({
      ficha: 'FERNÁNDEZ DE LA FUENTE, XOÁN',
      nombre: 'Xoán',
      apellidos: 'Fernández de la Fuente',
      funcion: 'Aficionado',
    })
    // Nombre largo: la licencia va más a la derecha
    expect(ficha.jugadores[4]).toMatchObject({
      nombre: 'Christian Alejandro Manuel',
      apellidos: 'Otero Vila',
      funcion: 'Aficionado',
    })
    expect(ficha.cuerpoTecnico.map((p) => [p.nombre, p.apellidos, p.funcion])).toEqual([
      ['Gonzalo', 'Suarez Pena', 'Entrenador titular'],
      ['Samuel', 'Barreiro Calvo', 'Delegado de equipo'],
      // La función en tres líneas
      ['Francisco Javier', 'Cabeza Rois', 'Delegado de protección de la infancia'],
      ['Iker', 'Seoane Pan', 'Auxiliar'],
    ])
  })

  it('sigue en la segunda página', async () => {
    const ficha = await leerFichaEquipo(DOS_PAGINAS)
    expect(ficha.jugadores.map((j) => j.apellidos)).toEqual(
      (await leerFichaEquipo(FICHA)).jugadores.map((j) => j.apellidos),
    )
    expect(ficha.cuerpoTecnico).toHaveLength(4)
  })

  it('explica que no es la ficha de un equipo', async () => {
    await expect(leerFichaEquipo(ACTA)).rejects.toThrow(FichaNoLegible)
    await expect(leerFichaEquipo(Buffer.from('hola'))).rejects.toThrow('no es un PDF')
  })
})

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

function leer(contenido: Buffer, quien = 'delegado', club = ids.club) {
  const form = new FormData()
  form.append(
    'archivo',
    new File([new Uint8Array(contenido)], 'ficha.pdf', { type: 'application/pdf' }),
  )
  return app.request(`/api/clubes/${club}/ficha-federacion`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

type Leida = {
  equipo: string | null
  categoria: string | null
  jugadores: { ficha: string; nombre: string; apellidos: string | null; jugadorId: string | null }[]
  cuerpoTecnico: unknown[]
  club: {
    id: string
    nombre: string
    fichas: { plantillaId: string; plantilla: string; temporada: string; tipo: string }[]
  }[]
}

async function alta(plantillaId: string, cuerpo: Record<string, unknown>) {
  const res = await pedir('POST', `/plantillas/${plantillaId}/jugadores`, 'admin', cuerpo)
  return ((await res.json()) as { jugadorId: string }).jugadorId
}

const fichasDe = async (plantillaId: string) =>
  db.select().from(fichas).where(eq(fichas.plantillaId, plantillaId))

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Proba' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  const otro = await (await pedir('POST', '/clubes', 'ajeno', { nombre: 'CD Outro' })).json()
  clubesCreados.push(otro.id)
  ids.otroClub = otro.id
  const plantilla = async (nombre: string, temporada = '2026-27') =>
    (
      await (
        await pedir('POST', '/plantillas', 'admin', {
          clubId: club.id,
          nombre,
          categoria: 'sénior',
          temporada,
        })
      ).json()
    ).id as string
  ids.senior = await plantilla('Senior')
  ids.juvenil = await plantilla('Juvenil')
  ids.anterior = await plantilla('Senior B', '2025-26')
  await db.insert(membresias).values([
    { plantillaId: ids.senior, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior, usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
  // Brais y Hugo ya son del club; Mateo tiene ficha en el juvenil; Xoán e Iago solo tienen nombre
  ids.brais = await alta(ids.anterior, { nombre: 'Brais', apellidos: 'Abella' })
  ids.hugo = await alta(ids.senior, { nombre: 'Hugo', apellidos: 'López' })
  ids.mateo = await alta(ids.juvenil, { nombre: 'Mateo', apellidos: 'Muiño Rey' })
  ids.xoan = await alta(ids.anterior, { nombre: 'Xoán' })
  ids.iago = await alta(ids.anterior, { nombre: 'Iago' })
  ids.outro = (
    await (
      await pedir('POST', `/plantillas/${ids.juvenil}/jugadores`, 'admin', { nombre: 'Pablo' })
    ).json()
  ).jugadorId
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('POST /clubes/{cid}/ficha-federacion', () => {
  it('lee la ficha y empareja con los jugadores del club', async () => {
    const res = await leer(FICHA)
    const ficha = (await res.json()) as Leida
    expect(res.status, JSON.stringify(ficha)).toBe(200)
    expect(ficha).toMatchObject({ equipo: 'CD Proba "B"', categoria: '2ª Futgal' })
    const de = (apellidos: string) => ficha.jugadores.find((j) => j.apellidos === apellidos)
    expect(de('Abella Castro')?.jugadorId).toBe(ids.brais)
    expect(de('López do Campo')?.jugadorId).toBe(ids.hugo)
    expect(de('Muiño Rey')?.jugadorId).toBe(ids.mateo)
    // Sin apellidos en la app no hay emparejamiento claro
    expect(de('Fernández de la Fuente')?.jugadorId).toBeNull()
    expect(de('Seoane Pan')?.jugadorId).toBeNull()
    expect(ficha.cuerpoTecnico).toHaveLength(4)

    // Los jugadores del club, con sus fichas para la vista previa
    expect(ficha.club.find((j) => j.id === ids.mateo)?.fichas).toEqual([
      { plantillaId: ids.juvenil, plantilla: 'Juvenil', temporada: '2026-27', tipo: 'propia' },
    ])
    expect(ficha.club.map((j) => j.nombre)).toEqual([
      'Brais',
      'Iago',
      'Hugo',
      'Mateo',
      'Pablo',
      'Xoán',
    ])
  })

  it('no guarda nada', async () => {
    expect(await fichasDe(ids.senior ?? '')).toHaveLength(1)
  })

  it('explica que no es la ficha de un equipo', async () => {
    const res = await leer(ACTA)
    expect(res.status).toBe(400)
    expect((await res.json()).error.codigo).toBe('ficha_no_legible')
  })

  it('delegado o superior en el club', async () => {
    expect((await leer(FICHA, 'jugador')).status).toBe(403)
    expect((await leer(FICHA, 'ajeno')).status).toBe(403)
    expect((await leer(FICHA, 'admin', ids.otroClub)).status).toBe(403)
    expect((await leer(FICHA, 'admin')).status).toBe(200)
  })
})

describe('crear la plantilla con sus jugadores', () => {
  const crear = (nombre: string, jugadores: unknown[], quien = 'admin') =>
    pedir('POST', '/plantillas', quien, {
      clubId: ids.club,
      nombre,
      categoria: '2ª Futgal',
      temporada: '2026-27',
      jugadores,
    })

  it('crea la plantilla y las fichas propias de los del club y los nuevos', async () => {
    const res = await crear('CD Proba "B"', [
      { jugadorId: ids.brais },
      { jugadorId: ids.xoan },
      { nombre: 'Iker', apellidos: 'Seoane Pan' },
    ])
    const plantilla = await res.json()
    expect(res.status, JSON.stringify(plantilla)).toBe(201)
    const creadas = await fichasDe(plantilla.id)
    expect(creadas).toHaveLength(3)
    expect(creadas.every((f) => f.tipo === 'propia' && f.dorsal === null)).toBe(true)
    expect(creadas.map((f) => f.jugadorId)).toEqual(expect.arrayContaining([ids.brais, ids.xoan]))
  })

  it('si alguno tiene ficha propia en otra plantilla esa temporada, no se crea nada', async () => {
    const res = await crear('Senior C', [{ nombre: 'Nuevo' }, { jugadorId: ids.mateo }])
    expect(res.status).toBe(409)
    const error = (await res.json()).error
    expect(error.codigo).toBe('ficha_en_temporada')
    expect(error.mensaje).toContain('Mateo Muiño Rey (Juvenil)')
    const creada = await db.select().from(plantillas).where(eq(plantillas.nombre, 'Senior C'))
    expect(creada).toEqual([])
  })

  it('valida la lista', async () => {
    let res = await crear('Senior D', [{ jugadorId: ids.brais }, { jugadorId: ids.brais }])
    expect(res.status).toBe(400)
    res = await crear('Senior D', [{ jugadorId: ids.brais, dorsal: 7 }])
    expect(res.status).toBe(400)
    res = await crear('Senior D', [{ jugadorId: randomUUID() }])
    expect(res.status).toBe(404)
  })

  it('solo los administradores del club', async () => {
    expect((await crear('Senior E', [], 'delegado')).status).toBe(403)
  })
})

describe('POST /plantillas/{id}/jugadores/lote', () => {
  const lote = (jugadores: unknown[], quien = 'delegado') =>
    pedir('POST', `/plantillas/${ids.senior}/jugadores/lote`, quien, { jugadores })

  it('añade a los del club y a los nuevos', async () => {
    const res = await lote([{ jugadorId: ids.iago }, { nombre: 'Anxo', apellidos: 'Pazos Ramúa' }])
    const nuevos = await res.json()
    expect(res.status, JSON.stringify(nuevos)).toBe(201)
    expect(nuevos.map((j: { nombre: string }) => j.nombre)).toEqual(['Iago', 'Anxo'])
    expect(nuevos[0]).toMatchObject({ tipo: 'propia', enDinamica: true, dorsal: null })
  })

  it('todos o ninguno: si alguno ya está, no se añade nadie', async () => {
    const antes = (await fichasDe(ids.senior ?? '')).length
    const res = await lote([{ nombre: 'Hugo', apellidos: 'Otro' }, { jugadorId: ids.hugo }])
    expect(res.status).toBe(409)
    expect((await res.json()).error.mensaje).toContain('Hugo López (ya está)')
    expect(await fichasDe(ids.senior ?? '')).toHaveLength(antes)
  })

  it('valida y comprueba permisos', async () => {
    expect((await lote([])).status).toBe(400)
    expect((await lote([{ jugadorId: ids.outro }])).status).toBe(409)
    expect((await lote([{ nombre: 'X' }], 'jugador')).status).toBe(403)
    expect((await lote([{ nombre: 'X' }], 'ajeno')).status).toBe(403)
  })
})
