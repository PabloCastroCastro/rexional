import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  asistencias,
  clubes,
  entrenos,
  fichas,
  jugadores,
  membresias,
  plantillas,
  respuestasEntreno,
  user,
} from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Respuestas de los jugadores a si van a los próximos entrenos (GH-204)

const app = crearApp()
const usuarios: string[] = []
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

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const dia = (n: number) =>
  new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

const base = () => `/plantillas/${ids.senior}/entrenos`
const responder = (entreno: string, cuerpo: unknown, quien = 'jugador') =>
  pedir('PUT', `${base()}/${entreno}/respuesta`, quien, cuerpo)
const apuntar = (entreno: string, jugador: string, cuerpo: unknown, quien = 'delegado') =>
  pedir('PUT', `${base()}/${entreno}/respuestas/${ids[jugador]}`, quien, cuerpo)
const errorDe = async (res: Response) => (await res.json()).error

type Listado = {
  id: string
  respuestas: { voy: number; duda: number; noVoy: number; sinResponder: number }
  miRespuesta: string | null
  cierreRespuestas: string
  respuestasAbiertas: boolean
}
const listado = async (quien = 'delegado') =>
  (await (await pedir('GET', `${base()}?desde=${dia(-1)}`, quien)).json()) as Listado[]
const delListado = async (entreno: string, quien = 'delegado') =>
  (await listado(quien)).find((e) => e.id === ids[entreno])

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'sin-ficha']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Respuestas' })).json()
  ids.club = club.id
  const senior = await (
    await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
    })
  ).json()
  ids.senior = senior.id
  await db.insert(membresias).values(
    (['delegado', 'jugador', 'sin-ficha'] as const).map((clave) => ({
      plantillaId: ids.senior ?? '',
      usuarioId: ids[clave] ?? '',
      rol: clave === 'delegado' ? ('delegado' as const) : ('jugador' as const),
    })),
  )

  // Brais es el usuario jugador; Zoe, otra jugadora; Hugo, de baja; Bruno, invitado solo para
  // partidos (fuera de la dinámica)
  const lista = await db
    .insert(jugadores)
    .values(
      ['Brais', 'Zoe', 'Hugo', 'Bruno'].map((nombre) => ({
        clubId: club.id,
        nombre,
        usuarioId: nombre === 'Brais' ? (ids.jugador ?? '') : null,
      })),
    )
    .returning()
  for (const j of lista) ids[j.nombre] = j.id
  const ficha = (jugador: string, dorsal: number, extra = {}) => ({
    plantillaId: ids.senior ?? '',
    jugadorId: ids[jugador] ?? '',
    clubId: club.id,
    temporada: '2026-27',
    dorsal,
    ...extra,
  })
  await db
    .insert(fichas)
    .values([
      ficha('Brais', 7),
      ficha('Zoe', 9),
      ficha('Hugo', 10, { activo: false }),
      ficha('Bruno', 5, { tipo: 'invitado', enDinamica: false }),
    ])

  // Un entreno pasado, uno mañana con hora, uno dentro de dos días y uno sin hora
  const nuevos = await db
    .insert(entrenos)
    .values([
      { plantillaId: ids.senior ?? '', fecha: dia(-1), hora: '20:00' },
      { plantillaId: ids.senior ?? '', fecha: dia(1), hora: '20:00', horaFin: '21:30' },
      { plantillaId: ids.senior ?? '', fecha: dia(2), hora: '20:00' },
      { plantillaId: ids.senior ?? '', fecha: dia(3) },
    ])
    .returning()
  for (const [i, clave] of ['ayer', 'manana', 'pasado', 'sinHora'].entries()) {
    ids[clave] = nuevos[i]?.id ?? ''
  }
})

afterAll(async () => {
  await db.delete(clubes).where(eq(clubes.id, ids.club ?? ''))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('el jugador responde', () => {
  it('voy, duda o no voy, con motivo opcional, y la cambia o la quita', async () => {
    let res = await responder(ids.manana ?? '', { respuesta: 'voy' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jugadorId: ids.Brais, respuesta: 'voy', motivo: null })
    expect((await delListado('manana', 'jugador'))?.miRespuesta).toBe('voy')

    res = await responder(ids.manana ?? '', { respuesta: 'no_voy', motivo: '  Trabajo  ' })
    expect(await res.json()).toMatchObject({ respuesta: 'no_voy', motivo: 'Trabajo' })

    expect((await pedir('DELETE', `${base()}/${ids.manana}/respuesta`, 'jugador')).status).toBe(204)
    expect((await delListado('manana', 'jugador'))?.miRespuesta).toBeNull()
  })

  it('valida la respuesta y el motivo', async () => {
    for (const cuerpo of [
      { respuesta: 'quizas' },
      { respuesta: 'voy', motivo: 'Llego tarde' },
      { respuesta: 'duda', motivo: 'x'.repeat(201) },
      { respuesta: 'voy', otro: 1 },
    ]) {
      expect((await responder(ids.manana ?? '', cuerpo)).status, JSON.stringify(cuerpo)).toBe(400)
    }
    // Un motivo vacío es lo mismo que ninguno
    const res = await responder(ids.manana ?? '', { respuesta: 'duda', motivo: '  ' })
    expect(await res.json()).toMatchObject({ respuesta: 'duda', motivo: null })
  })

  it('no se responde a un entreno pasado ni pasada la hora límite', async () => {
    let res = await responder(ids.ayer ?? '', { respuesta: 'voy' })
    expect(res.status).toBe(409)
    expect((await errorDe(res)).codigo).toBe('respuestas_cerradas')
    expect((await pedir('DELETE', `${base()}/${ids.ayer}/respuesta`, 'jugador')).status).toBe(409)

    // Con 72 horas de límite, el entreno de dentro de dos días ya está cerrado
    await db
      .update(plantillas)
      .set({ horasLimiteRespuesta: 72 })
      .where(eq(plantillas.id, ids.senior ?? ''))
    res = await responder(ids.pasado ?? '', { respuesta: 'voy' })
    expect(res.status).toBe(409)
    const cerrado = await delListado('pasado', 'jugador')
    expect(cerrado?.respuestasAbiertas).toBe(false)
    await db
      .update(plantillas)
      .set({ horasLimiteRespuesta: 0 })
      .where(eq(plantillas.id, ids.senior ?? ''))
    expect((await responder(ids.pasado ?? '', { respuesta: 'voy' })).status).toBe(200)
  })

  it('el cierre es la hora de inicio en Madrid menos la hora límite; sin hora, el final del día', async () => {
    const conHora = await delListado('manana')
    expect(new Date(conHora?.cierreRespuestas ?? '').toISOString()).toBe(
      new Date(`${dia(1)}T20:00:00${desfase(dia(1))}`).toISOString(),
    )
    expect(conHora?.respuestasAbiertas).toBe(true)
    const sinHora = await delListado('sinHora')
    expect(new Date(sinHora?.cierreRespuestas ?? '').toISOString()).toBe(
      new Date(`${dia(4)}T00:00:00${desfase(dia(4))}`).toISOString(),
    )
  })

  it('sin ficha vinculada a su cuenta no puede responder', async () => {
    const res = await responder(ids.manana ?? '', { respuesta: 'voy' }, 'sin-ficha')
    expect(res.status).toBe(403)
    expect((await errorDe(res)).codigo).toBe('sin_ficha')
  })

  it('un entreno de otra plantilla o inexistente no se encuentra', async () => {
    const res = await responder('00000000-0000-7000-8000-000000000000', { respuesta: 'voy' })
    expect(res.status).toBe(404)
  })
})

describe('el cuerpo técnico', () => {
  it('apunta y corrige la respuesta de un jugador, también pasada la hora límite', async () => {
    let res = await apuntar(ids.ayer ?? '', 'Zoe', { respuesta: 'no_voy', motivo: 'Lesión' })
    expect(res.status).toBe(200)
    res = await apuntar(ids.manana ?? '', 'Zoe', { respuesta: 'duda' })
    expect(res.status).toBe(200)
    const [guardada] = await db
      .select()
      .from(respuestasEntreno)
      .where(eq(respuestasEntreno.entrenoId, ids.manana ?? ''))
      .orderBy(respuestasEntreno.respondidoEn)
    expect(guardada).toBeDefined()
    const quita = await pedir('DELETE', `${base()}/${ids.ayer}/respuestas/${ids.Zoe}`, 'delegado')
    expect(quita.status).toBe(204)
  })

  it('solo para jugadores activos en la dinámica', async () => {
    for (const jugador of ['Hugo', 'Bruno']) {
      const res = await apuntar(ids.manana ?? '', jugador, { respuesta: 'voy' })
      expect(res.status, jugador).toBe(400)
      expect((await errorDe(res)).codigo).toBe('jugador_no_responde')
    }
  })

  it('el jugador no apunta la respuesta de otro', async () => {
    expect((await apuntar(ids.manana ?? '', 'Zoe', { respuesta: 'voy' }, 'jugador')).status).toBe(
      403,
    )
  })

  it('el listado lleva el recuento, sin nombres, de los jugadores activos en la dinámica', async () => {
    await responder(ids.manana ?? '', { respuesta: 'voy' })
    await apuntar(ids.manana ?? '', 'Zoe', { respuesta: 'duda' })
    const entreno = await delListado('manana')
    // Brais va, Zoe duda; Hugo (de baja) y Bruno (solo partidos) no cuentan
    expect(entreno?.respuestas).toEqual({ voy: 1, duda: 1, noVoy: 0, sinResponder: 0 })
    // El jugador ve el mismo recuento y solo su respuesta
    expect((await delListado('manana', 'jugador'))?.respuestas).toEqual(entreno?.respuestas)
    expect((await delListado('manana'))?.miRespuesta).toBeNull()
  })

  it('en el detalle del entreno, la respuesta de cada jugador; el jugador, solo la suya', async () => {
    const detalle = await (await pedir('GET', `${base()}/${ids.manana}`, 'delegado')).json()
    const respuestas = detalle.jugadores.map((j: { nombre: string; respuesta: string | null }) => [
      j.nombre,
      j.respuesta,
    ])
    expect(respuestas).toEqual([
      ['Brais', 'voy'],
      ['Zoe', 'duda'],
    ])
    const delJugador = await (await pedir('GET', `${base()}/${ids.manana}`, 'jugador')).json()
    expect(delJugador.jugadores).toHaveLength(1)
    expect(delJugador.jugadores[0]).toMatchObject({ nombre: 'Brais', respuesta: 'voy' })
  })

  it('pasar lista no toca las respuestas', async () => {
    await db.insert(asistencias).values({
      entrenoId: ids.ayer ?? '',
      plantillaId: ids.senior ?? '',
      jugadorId: ids.Brais ?? '',
      estado: 'falta',
    })
    await apuntar(ids.ayer ?? '', 'Brais', { respuesta: 'voy' })
    const detalle = await (await pedir('GET', `${base()}/${ids.ayer}`, 'delegado')).json()
    expect(detalle.jugadores[0]).toMatchObject({
      nombre: 'Brais',
      estado: 'falta',
      respuesta: 'voy',
    })
  })

  it('resumen para WhatsApp con quién va, duda, no va y no ha respondido, y el enlace a la app', async () => {
    await responder(ids.sinHora ?? '', { respuesta: 'no_voy', motivo: 'Viaje' })
    const res = await pedir('GET', `${base()}/${ids.sinHora}/respuestas/mensaje`, 'delegado')
    const { texto, whatsapp } = await res.json()
    expect(texto).toContain('*CD Respuestas · Senior*')
    expect(texto).toContain('❌ *No van (1)*\n7 · Brais (Viaje)')
    expect(texto).toContain('⏳ *Sin responder (1)*\n9 · Zoe')
    expect(texto).not.toContain('Hugo')
    expect(texto).not.toContain('Bruno')
    expect(texto).toContain(`/plantillas/${ids.senior}/entrenos`)
    expect(whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(texto)}`)
    expect(
      (await pedir('GET', `${base()}/${ids.sinHora}/respuestas/mensaje`, 'jugador')).status,
    ).toBe(403)
  })
})

describe('hora límite de la plantilla', () => {
  it('la cambia el entrenador o superior, de 0 a 72 horas', async () => {
    const ruta = `/plantillas/${ids.senior}`
    expect((await pedir('PATCH', ruta, 'delegado', { horasLimiteRespuesta: 2 })).status).toBe(403)
    for (const horas of [-1, 73, 1.5]) {
      expect((await pedir('PATCH', ruta, 'admin', { horasLimiteRespuesta: horas })).status).toBe(
        400,
      )
    }
    const res = await pedir('PATCH', ruta, 'admin', { horasLimiteRespuesta: 2 })
    expect(await res.json()).toMatchObject({ horasLimiteRespuesta: 2 })
    await pedir('PATCH', ruta, 'admin', { horasLimiteRespuesta: 0 })
  })
})

describe('horario', () => {
  it('al rehacer el horario se conservan los entrenos futuros con respuestas', async () => {
    const [delHorario] = await db
      .insert(entrenos)
      .values({ plantillaId: ids.senior ?? '', fecha: dia(5), hora: '19:00', deHorario: true })
      .returning()
    await responder(delHorario?.id ?? '', { respuesta: 'voy' })
    const res = await pedir('DELETE', `/plantillas/${ids.senior}/horario`, 'delegado')
    expect(res.status).toBe(200)
    const [sigue] = await db
      .select()
      .from(entrenos)
      .where(eq(entrenos.id, delHorario?.id ?? ''))
    expect(sigue).toBeDefined()
  })
})

// Desfase de Madrid con UTC ese día: "+01:00" en invierno y "+02:00" en verano
function desfase(fecha: string) {
  const parte = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(`${fecha}T12:00:00Z`))
    .find((p) => p.type === 'timeZoneName')?.value
  return (parte ?? 'GMT+01:00').replace('GMT', '')
}
