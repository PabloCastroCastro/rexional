import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  clubes,
  ejercicios,
  entrenos,
  fichas,
  jugadores,
  membresias,
  user,
} from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Planificación de sesiones: el plan de cada entreno, duplicarlo y los modelos del club

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

const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const dia = (n: number) =>
  new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const entrenosDe = () => `/plantillas/${ids.plantilla}/entrenos`
const plan = (eid: string) => `${entrenosDe()}/${eid}/plan`

type Plan = {
  entrenoId: string
  fecha: string
  hora: string | null
  objetivo: string | null
  duracionPrevista: number | null
  duracionTotal: number
  ejercicios: {
    ejercicioId: string
    nombre: string
    duracionMin: number | null
    indicaciones: string | null
  }[]
}

async function nuevoEntreno(
  fecha: string,
  hora: string | null = '20:00',
  horaFin: string | null = '21:30',
) {
  const [e] = await db
    .insert(entrenos)
    .values({ plantillaId: ids.plantilla ?? '', fecha, hora, horaFin })
    .returning()
  return e?.id ?? ''
}

const guardar = (eid: string, cuerpo: unknown, quien = 'delegado') =>
  pedir('PUT', plan(eid), quien, cuerpo)

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Planes' })).json()
  const otro = await (
    await pedir('POST', '/clubes', 'admin', { nombre: 'Otro club de planes' })
  ).json()
  clubesCreados.push(club.id, otro.id)
  ids.club = club.id
  const plantilla = await (
    await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
    })
  ).json()
  ids.plantilla = plantilla.id
  await db.insert(membresias).values([
    { plantillaId: plantilla.id, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: plantilla.id, usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
  const lista = await db
    .insert(ejercicios)
    .values([
      { clubId: club.id, nombre: 'Rondo', duracionMin: 10 },
      { clubId: club.id, nombre: 'Salida de balón', duracionMin: 20 },
      { clubId: club.id, nombre: 'Partido', duracionMin: 25 },
      { clubId: otro.id, nombre: 'De otro club' },
    ])
    .returning()
  for (const e of lista) ids[e.nombre] = e.id
  const [brais] = await db
    .insert(jugadores)
    .values({ clubId: club.id, nombre: 'Brais' })
    .returning()
  ids.brais = brais?.id ?? ''
  await db.insert(fichas).values({
    plantillaId: plantilla.id,
    jugadorId: brais?.id ?? '',
    clubId: club.id,
    temporada: '2026-27',
    dorsal: 7,
  })
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('plan de un entreno', () => {
  it('se guarda entero, en orden, con la duración total y la prevista', async () => {
    const eid = await nuevoEntreno(dia(5))
    const cuerpo = {
      objetivo: ' Salida de balón ',
      notas: null,
      ejercicios: [
        { ejercicioId: ids.Rondo, duracionMin: 10 },
        {
          ejercicioId: ids['Salida de balón'],
          duracionMin: 25,
          indicaciones: '  Centrales abiertos ',
        },
        { ejercicioId: ids.Partido },
      ],
    }
    const res = await guardar(eid, cuerpo)
    expect(res.status).toBe(200)
    const guardado = (await res.json()) as Plan
    expect(guardado).toMatchObject({
      objetivo: 'Salida de balón',
      duracionPrevista: 90,
      duracionTotal: 35,
    })
    expect(guardado.ejercicios.map((e) => [e.nombre, e.duracionMin, e.indicaciones])).toEqual([
      ['Rondo', 10, null],
      ['Salida de balón', 25, 'Centrales abiertos'],
      ['Partido', null, null],
    ])
    // Lo ve un jugador; el listado de entrenos lleva el resumen del plan
    expect((await pedir('GET', plan(eid), 'jugador')).status).toBe(200)
    const lista = await (
      await pedir('GET', `${entrenosDe()}?desde=${dia(5)}&hasta=${dia(5)}`, 'jugador')
    ).json()
    expect(lista[0]).toMatchObject({
      objetivo: 'Salida de balón',
      ejerciciosPlan: 3,
      duracionPlan: 35,
    })

    // Guardar de nuevo sustituye la lista; vacío, sin plan
    const vacio = (await (await guardar(eid, { objetivo: null, ejercicios: [] })).json()) as Plan
    expect(vacio).toMatchObject({ objetivo: null, duracionTotal: 0, ejercicios: [] })
  })

  it('solo el cuerpo técnico lo cambia y solo con ejercicios del club', async () => {
    const eid = await nuevoEntreno(dia(6))
    expect((await guardar(eid, { ejercicios: [] }, 'jugador')).status).toBe(403)
    const ajeno = await guardar(eid, { ejercicios: [{ ejercicioId: ids['De otro club'] }] })
    expect(ajeno.status).toBe(400)
    expect((await ajeno.json()).error.codigo).toBe('ejercicio_ajeno')
    expect(
      (await pedir('GET', plan('00000000-0000-7000-8000-000000000000'), 'jugador')).status,
    ).toBe(404)
  })

  it('el plan y la asistencia del mismo entreno no se tocan', async () => {
    const eid = await nuevoEntreno(dia(-1))
    await pedir('PUT', `${entrenosDe()}/${eid}/asistencias`, 'delegado', {
      asistencias: [{ jugadorId: ids.brais, estado: 'asiste' }],
    })
    await guardar(eid, { objetivo: 'Recuperación', ejercicios: [{ ejercicioId: ids.Rondo }] })
    const detalle = await (await pedir('GET', `${entrenosDe()}/${eid}`, 'delegado')).json()
    expect(detalle.recuentos.asiste).toBe(1)
    await pedir('PUT', `${entrenosDe()}/${eid}/asistencias`, 'delegado', { asistencias: [] })
    expect(
      ((await (await pedir('GET', plan(eid), 'jugador')).json()) as Plan).ejercicios,
    ).toHaveLength(1)
  })
})

describe('duplicar y cambiar de fecha', () => {
  it('va al entreno sin plan de ese día, o crea uno; si todos tienen plan, no', async () => {
    const origen = await nuevoEntreno(dia(10), '19:00', '20:30')
    await guardar(origen, {
      objetivo: 'Presión',
      ejercicios: [{ ejercicioId: ids.Rondo, duracionMin: 10 }],
    })

    // Un día sin entrenos: se crea uno con las mismas horas
    const res = await pedir('POST', `${plan(origen)}/duplicar`, 'delegado', { fecha: dia(12) })
    expect(res.status).toBe(201)
    const copia = (await res.json()) as Plan
    expect(copia).toMatchObject({
      fecha: dia(12),
      hora: '19:00',
      objetivo: 'Presión',
      duracionTotal: 10,
    })

    // Un día con un entreno sin plan: va a ese
    const libre = await nuevoEntreno(dia(14), '20:00')
    const aLibre = (await (
      await pedir('POST', `${plan(origen)}/duplicar`, 'delegado', { fecha: dia(14) })
    ).json()) as Plan
    expect(aLibre.entrenoId).toBe(libre)

    // Ese día ya está todo planificado
    const lleno = await pedir('POST', `${plan(origen)}/duplicar`, 'delegado', { fecha: dia(14) })
    expect(lleno.status).toBe(409)
  })

  it('el entreno se mueve de día y pasa a ser suelto', async () => {
    const eid = await nuevoEntreno(dia(20))
    const res = await pedir('PATCH', `${entrenosDe()}/${eid}`, 'delegado', {
      fecha: dia(21),
      hora: '18:00',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ fecha: dia(21), hora: '18:00', deHorario: false })
    await nuevoEntreno(dia(22), '18:00')
    const choque = await pedir('PATCH', `${entrenosDe()}/${eid}`, 'delegado', {
      fecha: dia(22),
      hora: '18:00',
    })
    expect(choque.status).toBe(409)
  })
})

describe('modelos de sesión', () => {
  it('se guardan, se listan, se aplican y se borran', async () => {
    const eid = await nuevoEntreno(dia(30))
    expect(
      (await pedir('POST', `${plan(eid)}/guardar-modelo`, 'delegado', { nombre: 'Vacío' })).status,
    ).toBe(400)
    await guardar(eid, {
      objetivo: 'Técnica',
      ejercicios: [
        { ejercicioId: ids.Rondo, duracionMin: 10 },
        { ejercicioId: ids.Partido, duracionMin: 25 },
      ],
    })
    const res = await pedir('POST', `${plan(eid)}/guardar-modelo`, 'delegado', {
      nombre: 'Sesión de martes',
    })
    expect(res.status).toBe(201)
    const modelo = await res.json()
    expect(modelo).toMatchObject({
      nombre: 'Sesión de martes',
      objetivo: 'Técnica',
      ejercicios: 2,
      duracionTotal: 35,
    })
    const repetido = await pedir('POST', `${plan(eid)}/guardar-modelo`, 'delegado', {
      nombre: 'SESIÓN DE MARTES',
    })
    expect(repetido.status).toBe(409)

    const modelos = await (
      await pedir('GET', `/clubes/${ids.club}/modelos-sesion`, 'jugador')
    ).json()
    expect(modelos).toEqual([modelo])

    // Aplicarlo a otro entreno sustituye su plan
    const otro = await nuevoEntreno(dia(31))
    await guardar(otro, { objetivo: 'Otro', ejercicios: [{ ejercicioId: ids['Salida de balón'] }] })
    const aplicado = (await (
      await pedir('POST', `${plan(otro)}/desde-modelo/${modelo.id}`, 'delegado')
    ).json()) as Plan
    expect(aplicado).toMatchObject({ objetivo: 'Técnica', duracionTotal: 35 })
    expect(aplicado.ejercicios.map((e) => e.nombre)).toEqual(['Rondo', 'Partido'])

    expect(
      (await pedir('DELETE', `/clubes/${ids.club}/modelos-sesion/${modelo.id}`, 'jugador')).status,
    ).toBe(403)
    expect(
      (await pedir('DELETE', `/clubes/${ids.club}/modelos-sesion/${modelo.id}`, 'delegado')).status,
    ).toBe(204)
    // El plan creado con él no cambia
    expect(
      ((await (await pedir('GET', plan(otro), 'jugador')).json()) as Plan).ejercicios,
    ).toHaveLength(2)
  })
})
