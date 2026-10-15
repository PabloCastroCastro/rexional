import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, convocados, fichas, jugadores, membresias, user } from '../src/db/schema/index.js'
import { textoDia } from '../src/fechas.js'
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

// Fechas relativas a hoy en Madrid, como hace la API
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const dia = (n: number) =>
  new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

const base = () => `/plantillas/${ids.senior}/partidos`

type Partido = {
  id: string
  rival: string
  fecha: string
  hora: string | null
  lugar: string | null
  jugadores: { nombre: string; activo: boolean; convocado: boolean }[]
}

async function crearPartido(datos: Record<string, unknown>) {
  const res = await pedir('POST', base(), 'delegado', datos)
  expect(res.status).toBe(201)
  return (await res.json()) as Partido
}

const convocar = (partidoId: string, lista: (string | undefined)[], quien = 'delegado') =>
  pedir('PUT', `${base()}/${partidoId}/convocados`, quien, { jugadores: lista })

const convocadosDe = (p: Partido) => p.jugadores.filter((j) => j.convocado).map((j) => j.nombre)

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)

  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Partidos' })).json()
  clubesCreados.push(club.id)
  for (const [clave, nombre] of [
    ['senior', 'Senior'],
    ['juvenil', 'Juvenil'],
  ] as const) {
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre,
      categoria: 'sénior',
      temporada: '2026-27',
    })
    ids[clave] = (await res.json()).id
  }
  await db.insert(membresias).values([
    { plantillaId: ids.senior ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])

  // Senior: Íker (1), Brais Iglesias (7), Zoe (sin dorsal) y Hugo (10, de baja).
  // Bruno solo tiene ficha en el Juvenil.
  const lista = await db
    .insert(jugadores)
    .values([
      { clubId: club.id, nombre: 'Brais', apellidos: 'Iglesias' },
      { clubId: club.id, nombre: 'Zoe' },
      { clubId: club.id, nombre: 'Íker' },
      { clubId: club.id, nombre: 'Hugo' },
      { clubId: club.id, nombre: 'Bruno' },
    ])
    .returning()
  for (const j of lista) ids[j.nombre] = j.id
  const ficha = (jugador: string, dorsal: number | null, plantilla = 'senior', activo = true) => ({
    plantillaId: ids[plantilla] ?? '',
    jugadorId: ids[jugador] ?? '',
    clubId: club.id,
    temporada: '2026-27',
    dorsal,
    activo,
  })
  await db
    .insert(fichas)
    .values([
      ficha('Brais', 7),
      ficha('Zoe', null),
      ficha('Íker', 1),
      ficha('Hugo', 10, 'senior', false),
      ficha('Bruno', 5, 'juvenil'),
    ])
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('partidos', () => {
  it('se crea un partido solo con rival y fecha, con la lista para convocar', async () => {
    const partido = await crearPartido({ rival: '  SD Compostela  ', fecha: dia(3) })
    expect(partido).toMatchObject({
      rival: 'SD Compostela',
      fecha: dia(3),
      hora: null,
      lugar: null,
    })
    // Los activos, por dorsal; Hugo, de baja, no aparece
    expect(partido.jugadores.map((j) => [j.nombre, j.convocado])).toEqual([
      ['Íker', false],
      ['Brais', false],
      ['Zoe', false],
    ])
    ids.p3 = partido.id
  })

  it('valida los datos del partido', async () => {
    for (const cuerpo of [
      { rival: ' ', fecha: dia(3) },
      { rival: 'X', fecha: '2026-02-30' },
      { rival: 'X', fecha: dia(3), hora: '7:00' },
      { rival: 'X', fecha: dia(3), local: 'sí' },
      { rival: 'X', fecha: dia(3), estado: 'jugado' },
    ]) {
      expect((await pedir('POST', base(), 'delegado', cuerpo)).status).toBe(400)
    }
    const res = await pedir('POST', base(), 'delegado', {
      rival: 'X',
      fecha: dia(3),
      hora: '17:00',
      horaCitacion: '17:30',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.detalles).toEqual([
      { campo: 'horaCitacion', mensaje: 'La citación no puede ser después de la hora del partido' },
    ])
  })

  it('separa próximos (desde hoy) y pasados, cada uno en su orden', async () => {
    ids.pAyer = (await crearPartido({ rival: 'Ayer FC', fecha: dia(-1) })).id
    await crearPartido({ rival: 'Hace una semana', fecha: dia(-7) })
    await crearPartido({ rival: 'Hoy FC', fecha: HOY, hora: '18:00' })
    await crearPartido({ rival: 'Hoy temprano', fecha: HOY, hora: '10:00' })

    const proximos = await (await pedir('GET', base(), 'jugador')).json()
    expect(proximos.map((p: Partido) => p.rival)).toEqual([
      'Hoy temprano',
      'Hoy FC',
      'SD Compostela',
    ])
    const pasados = await (await pedir('GET', `${base()}?cuando=pasados`, 'jugador')).json()
    expect(pasados.map((p: Partido) => p.rival)).toEqual(['Ayer FC', 'Hace una semana'])
    expect(pasados[0]).toMatchObject({ convocados: 0 })
  })

  it('se edita un partido y los opcionales se quitan con null', async () => {
    let res = await pedir('PATCH', `${base()}/${ids.p3}`, 'delegado', {
      hora: '17:00',
      horaCitacion: '16:00',
      lugar: 'Campo municipal',
      local: true,
      competicion: 'Preferente',
    })
    expect(await res.json()).toMatchObject({ hora: '17:00', horaCitacion: '16:00', local: true })

    // La citación se compara con la hora ya guardada
    res = await pedir('PATCH', `${base()}/${ids.p3}`, 'delegado', { horaCitacion: '18:00' })
    expect(res.status).toBe(400)

    res = await pedir('PATCH', `${base()}/${ids.p3}`, 'delegado', { lugar: null })
    expect(await res.json()).toMatchObject({ lugar: null, local: true })
    await pedir('PATCH', `${base()}/${ids.p3}`, 'delegado', { lugar: 'Campo municipal' })

    expect((await pedir('PATCH', `${base()}/${ids.p3}`, 'delegado', {})).status).toBe(400)
  })

  it('un partido de otra plantilla no se encuentra', async () => {
    const res = await pedir('POST', `/plantillas/${ids.juvenil}/partidos`, 'admin', {
      rival: 'X',
      fecha: dia(2),
    })
    const ajeno = (await res.json()).id
    for (const [metodo, sufijo, cuerpo] of [
      ['GET', '', undefined],
      ['PATCH', '', { rival: 'Y' }],
      ['DELETE', '', undefined],
      ['PUT', '/convocados', { jugadores: [] }],
      ['GET', '/mensaje', undefined],
    ] as const) {
      expect((await pedir(metodo, `${base()}/${ajeno}${sufijo}`, 'delegado', cuerpo)).status).toBe(
        404,
      )
    }
  })
})

describe('convocatoria', () => {
  it('guarda la lista completa de convocados', async () => {
    let partido = (await (await convocar(ids.p3 ?? '', [ids.Brais, ids.Íker])).json()) as Partido
    expect(convocadosDe(partido)).toEqual(['Íker', 'Brais'])
    partido = (await (await convocar(ids.p3 ?? '', [ids.Zoe])).json()) as Partido
    expect(convocadosDe(partido)).toEqual(['Zoe'])
    const proximos = await (await pedir('GET', base(), 'delegado')).json()
    expect(proximos.find((p: Partido) => p.id === ids.p3)).toMatchObject({ convocados: 1 })
  })

  it('solo se convoca a jugadores con ficha activa en la plantilla', async () => {
    for (const lista of [[ids.Hugo], [ids.Bruno], ['00000000-0000-7000-8000-000000000000']]) {
      const res = await convocar(ids.p3 ?? '', lista)
      expect(res.status).toBe(400)
      expect((await res.json()).error.codigo).toBe('jugador_no_convocable')
    }
    expect((await convocar(ids.p3 ?? '', [ids.Brais, ids.Brais])).status).toBe(400)
  })

  it('quien causa baja ya convocado sigue en la convocatoria hasta que se le quita', async () => {
    await convocar(ids.p3 ?? '', [ids.Brais, ids.Zoe])
    await db
      .update(fichas)
      .set({ activo: false })
      .where(and(eq(fichas.plantillaId, ids.senior ?? ''), eq(fichas.jugadorId, ids.Zoe ?? '')))

    let partido = (await (await pedir('GET', `${base()}/${ids.p3}`, 'delegado')).json()) as Partido
    expect(partido.jugadores.find((j) => j.nombre === 'Zoe')).toMatchObject({
      activo: false,
      convocado: true,
    })
    expect((await convocar(ids.p3 ?? '', [ids.Zoe, ids.Brais, ids.Íker])).status).toBe(200)

    partido = (await (await convocar(ids.p3 ?? '', [ids.Brais])).json()) as Partido
    expect(partido.jugadores.map((j) => j.nombre)).not.toContain('Zoe')
    expect((await convocar(ids.p3 ?? '', [ids.Zoe])).status).toBe(400)

    await db
      .update(fichas)
      .set({ activo: true })
      .where(and(eq(fichas.plantillaId, ids.senior ?? ''), eq(fichas.jugadorId, ids.Zoe ?? '')))
  })
})

describe('mensaje de convocatoria', () => {
  it('lleva club, plantilla, rival, fecha, horas, lugar y convocados por dorsal', async () => {
    const partido = await crearPartido({
      rival: 'SD Compostela',
      competicion: 'Preferente',
      fecha: '2026-10-18',
      hora: '17:00',
      horaCitacion: '16:00',
      lugar: 'Campo municipal de Rexional',
      local: true,
    })
    await convocar(partido.id, [ids.Zoe, ids.Brais, ids.Íker])
    const res = await pedir('GET', `${base()}/${partido.id}/mensaje`, 'jugador')
    const { texto, whatsapp } = await res.json()
    expect(texto).toBe(
      [
        '⚽ *CD Partidos · Senior*',
        'Convocatoria contra *SD Compostela* (Preferente)',
        '',
        '📅 Domingo, 18 de octubre',
        '⏰ Citación 16:00 · Partido 17:00',
        '📍 Campo municipal de Rexional (en casa)',
        '',
        '*Convocados (3)*',
        '1 · Íker',
        '7 · Brais Iglesias',
        '– · Zoe',
      ].join('\n'),
    )
    expect(whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(texto)}`)
  })

  it('sin datos opcionales ni convocados, omite esas líneas', async () => {
    const res = await pedir('GET', `${base()}/${ids.pAyer}/mensaje`, 'delegado')
    expect((await res.json()).texto).toBe(
      [
        '⚽ *CD Partidos · Senior*',
        'Convocatoria contra *Ayer FC*',
        '',
        `📅 ${textoDia(dia(-1))}`,
        '',
        '_Convocatoria pendiente_',
      ].join('\n'),
    )
  })
})

describe('borrar y permisos', () => {
  it('borrar un partido borra su convocatoria', async () => {
    await convocar(ids.p3 ?? '', [ids.Brais])
    expect((await pedir('DELETE', `${base()}/${ids.p3}`, 'delegado')).status).toBe(204)
    expect(await db.$count(convocados, eq(convocados.partidoId, ids.p3 ?? ''))).toBe(0)
    expect((await pedir('GET', `${base()}/${ids.p3}`, 'delegado')).status).toBe(404)
  })

  it('cualquier miembro ve partidos y convocatorias; solo delegado o superior los gestiona', async () => {
    const partido = await crearPartido({ rival: 'Permisos FC', fecha: dia(5) })
    await convocar(partido.id, [ids.Brais])
    const visto = (await (
      await pedir('GET', `${base()}/${partido.id}`, 'jugador')
    ).json()) as Partido
    expect(convocadosDe(visto)).toEqual(['Brais'])

    for (const [metodo, ruta, cuerpo] of [
      ['POST', base(), { rival: 'X', fecha: dia(5) }],
      ['PATCH', `${base()}/${partido.id}`, { rival: 'Y' }],
      ['DELETE', `${base()}/${partido.id}`, undefined],
      ['PUT', `${base()}/${partido.id}/convocados`, { jugadores: [] }],
    ] as const) {
      expect((await pedir(metodo, ruta, 'jugador', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, ruta, 'ajeno', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, ruta, undefined, cuerpo)).status).toBe(401)
    }
    expect((await pedir('GET', base(), 'ajeno')).status).toBe(403)
  })
})
