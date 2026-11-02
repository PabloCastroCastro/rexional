import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { eq, inArray } from 'drizzle-orm'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  clubes,
  ejercicioMedios,
  ejercicios,
  entrenos,
  fichas,
  jugadores,
  membresias,
  user,
} from '../src/db/schema/index.js'
import { absoluta } from '../src/medios/almacen.js'
import { crearUsuario, iniciarSesion, ORIGEN, textoPdf } from './utilidades.js'

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
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)
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

describe('plan en PDF', () => {
  const pdf = (eid: string) => `${entrenosDe()}/${eid}/plan.pdf`

  it('lleva la fecha, el objetivo, las notas y los ejercicios en orden', async () => {
    const eid = await nuevoEntreno('2026-11-03', '18:00', '19:30')
    await guardar(eid, {
      objetivo: 'Salida de balón',
      notas: 'Traer petos',
      ejercicios: [
        { ejercicioId: ids.Rondo, duracionMin: 15, indicaciones: 'A dos toques' },
        { ejercicioId: ids.Partido, duracionMin: 25 },
      ],
    })
    await db
      .update(ejercicios)
      .set({
        material: 'Conos y petos',
        jugadores: '5 por grupo',
        descripcion: 'Cuatro fuera mantienen el balón; el del centro roba.',
      })
      .where(eq(ejercicios.id, ids.Rondo ?? ''))

    const res = await pedir('GET', pdf(eid), 'jugador')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toBe('inline; filename="entreno-2026-11-03.pdf"')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    const texto = await textoPdf(res)
    for (const esperado of [
      'CD Planes',
      'Senior · Temporada 2026-27',
      'Sesión de entrenamiento',
      'Martes, 3 de noviembre de 2026',
      '18:00 – 19:30',
      'Salida de balón',
      'Traer petos',
      'Material: Conos y petos',
      'Jugadores: 5 por grupo',
      'Cuatro fuera mantienen el balón; el del centro roba.',
      'En esta sesión: A dos toques',
      "40' de ejercicios · el entreno dura 90'",
    ]) {
      expect(texto).toContain(esperado)
    }
    expect(texto.indexOf('Rondo')).toBeLessThan(texto.indexOf('Partido'))
  })

  it('lleva hasta cuatro fotos, los enlaces y el aviso de vídeo; avisa si no hay ejercicios', async () => {
    const relativa = `ejercicios/${ids.club}/miniatura-pdf.webp`
    await mkdir(absoluta(`ejercicios/${ids.club}`), { recursive: true })
    await sharp({
      create: { width: 320, height: 180, channels: 3, background: '#14553d' },
    })
      .webp()
      .toFile(absoluta(relativa))
    const ejercicioId = ids['Salida de balón'] ?? ''
    // Cinco fotos (solo salen cuatro), un enlace y un vídeo
    await db.insert(ejercicioMedios).values([
      ...[0, 1, 2, 3, 4].map((orden) => ({
        ejercicioId,
        tipo: 'foto' as const,
        archivo: relativa,
        miniatura: relativa,
        mime: 'image/webp',
        orden,
      })),
      {
        ejercicioId,
        tipo: 'enlace',
        url: 'https://youtu.be/salida',
        pie: 'Salida del Celta',
        orden: 5,
      },
      { ejercicioId, tipo: 'video', archivo: relativa, mime: 'video/mp4', orden: 6 },
    ])
    const conFoto = await nuevoEntreno('2026-11-04')
    await guardar(conFoto, { ejercicios: [{ ejercicioId: ids['Salida de balón'] }] })
    const documento = await getDocument({
      data: new Uint8Array(await (await pedir('GET', pdf(conFoto), 'jugador')).arrayBuffer()),
      verbosity: 0,
      isEvalSupported: false,
    }).promise
    const pagina = await documento.getPage(1)
    const operaciones = await pagina.getOperatorList()
    expect(operaciones.fnArray.filter((op) => op === OPS.paintImageXObject)).toHaveLength(4)
    // pdfmake pone un enlace por palabra: cuentan las URL distintas
    const enlaces = [...new Set((await pagina.getAnnotations()).map((a) => a.url))]
    expect(enlaces).toEqual([
      'https://youtu.be/salida',
      `http://localhost:5173/plantillas/${ids.plantilla}/entrenos/ejercicios/${ejercicioId}`,
    ])
    const textoFotos = (await pagina.getTextContent()).items
      .map((i) => ('str' in i ? i.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
    expect(textoFotos).toContain('Vídeo: Salida del Celta')
    expect(textoFotos).toContain('Tiene vídeo: verlo en la app')
    await documento.destroy()

    const vacio = await nuevoEntreno('2026-11-05', null, null)
    const texto = await textoPdf(await pedir('GET', pdf(vacio), 'jugador'))
    expect(texto).toContain('Este entreno aún no tiene ejercicios.')
    expect(texto).toContain('Sin hora')
  })

  it('pide sesión y acceso a la plantilla', async () => {
    const eid = await nuevoEntreno('2026-11-06')
    expect((await pedir('GET', pdf(eid))).status).toBe(401)
    expect((await pedir('GET', pdf(eid), 'ajeno')).status).toBe(403)
    expect((await pedir('GET', pdf(randomUUID()), 'jugador')).status).toBe(404)
  })
})
