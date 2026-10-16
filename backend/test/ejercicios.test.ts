import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  clubes,
  ejercicioMedios,
  entrenoEjercicios,
  entrenos,
  membresias,
  user,
} from '../src/db/schema/index.js'
import { absoluta } from '../src/medios/almacen.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Biblioteca de ejercicios del club: la consulta cualquier miembro y la gestiona el delegado o superior

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

const base = () => `/clubes/${ids.club}/ejercicios`

type Medio = { id: string; tipo: string; pie: string | null; orden: number; url: string | null }
type Ejercicio = {
  id: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  etiquetas: string[]
  archivado: boolean
  usos: number
  medios: Medio[]
}
type Resumen = { id: string; nombre: string; medios: number; urlMiniatura: string | null }

async function crear(datos: Record<string, unknown>) {
  const res = await pedir('POST', base(), 'delegado', datos)
  expect(res.status).toBe(201)
  return (await res.json()) as Ejercicio
}

function subirFoto(ejercicioId: string) {
  const form = new FormData()
  const foto = readFileSync(new URL('./fixtures/foto-gps.jpg', import.meta.url))
  form.append('archivo', new File([new Uint8Array(foto)], 'foto.jpg'))
  return app.request(`/api${base()}/${ejercicioId}/medios`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies.delegado ?? '' },
    body: form,
  })
}

const nombres = async (consulta = '') =>
  ((await (await pedir('GET', `${base()}${consulta}`, 'jugador')).json()) as Resumen[]).map(
    (e) => e.nombre,
  )

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Ejercicios' })).json()
  clubesCreados.push(club.id)
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
  const otro = await (await pedir('POST', '/clubes', 'ajeno', { nombre: 'Otro club' })).json()
  clubesCreados.push(otro.id)
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('biblioteca', () => {
  it('el cuerpo técnico crea; cualquier miembro consulta', async () => {
    const e = await crear({
      nombre: '  Presión tras pérdida ',
      categoria: 'tactica',
      duracionMin: 15,
      descripcion: 'Robar en 5 segundos',
      etiquetas: ['Presión', ' presión ', 'Transición'],
    })
    expect(e).toMatchObject({
      nombre: 'Presión tras pérdida',
      etiquetas: ['presión', 'transición'],
      archivado: false,
      usos: 0,
      medios: [],
    })
    const leido = await pedir('GET', `${base()}/${e.id}`, 'jugador')
    expect((await leido.json()).nombre).toBe('Presión tras pérdida')

    expect((await pedir('POST', base(), 'jugador', { nombre: 'X' })).status).toBe(403)
    expect((await pedir('POST', base(), 'delegado', { nombre: '  ' })).status).toBe(400)
    expect((await pedir('POST', base(), 'delegado', { nombre: 'X', duracionMin: 0 })).status).toBe(
      400,
    )
    expect((await pedir('GET', base(), 'ajeno')).status).toBe(403)
  })

  it('busca sin tildes ni mayúsculas, filtra y deja fuera los archivados', async () => {
    await crear({ nombre: 'Rondo 4 contra 1', categoria: 'calentamiento', etiquetas: ['posesión'] })
    const archivado = await crear({ nombre: 'Rondo antiguo', categoria: 'calentamiento' })
    await pedir('PATCH', `${base()}/${archivado.id}`, 'delegado', { archivado: true })

    expect(await nombres('?q=PRESION')).toEqual(['Presión tras pérdida'])
    expect(await nombres('?q=robar')).toEqual(['Presión tras pérdida'])
    expect(await nombres('?q=rondo')).toEqual(['Rondo 4 contra 1'])
    expect(await nombres('?q=rondo&archivados=si')).toEqual(['Rondo antiguo'])
    expect(await nombres('?q=rondo&archivados=todos')).toEqual([
      'Rondo 4 contra 1',
      'Rondo antiguo',
    ])
    expect(await nombres('?categoria=tactica')).toEqual(['Presión tras pérdida'])
    expect(await nombres('?etiqueta=Posesión')).toEqual(['Rondo 4 contra 1'])
    // Comodines del LIKE como texto
    expect(await nombres('?q=%25')).toEqual([])

    const etiquetas = await (await pedir('GET', `${base()}/etiquetas`, 'jugador')).json()
    expect(etiquetas).toEqual(['posesión', 'presión', 'transición'])
  })

  it('se edita, se quitan campos con null y se archiva', async () => {
    const e = await crear({ nombre: 'Finalización', descripcion: 'Centros', material: 'Conos' })
    const res = await pedir('PATCH', `${base()}/${e.id}`, 'delegado', {
      nombre: 'Finalización tras centro',
      descripcion: null,
      etiquetas: [],
    })
    expect(await res.json()).toMatchObject({
      nombre: 'Finalización tras centro',
      descripcion: null,
      etiquetas: [],
    })
    expect((await pedir('PATCH', `${base()}/${e.id}`, 'delegado', {})).status).toBe(400)
    expect((await pedir('PATCH', `${base()}/${e.id}`, 'jugador', { nombre: 'X' })).status).toBe(403)
  })
})

describe('medios del ejercicio', () => {
  it('enlaces, pie y orden; la lista muestra la miniatura de la primera foto', async () => {
    const e = await crear({ nombre: 'Salida de balón' })
    const enlace = await pedir('POST', `${base()}/${e.id}/medios/enlace`, 'delegado', {
      url: 'https://www.youtube.com/watch?v=abc',
      pie: 'Ejemplo',
    })
    expect(enlace.status).toBe(201)
    const medioEnlace = (await enlace.json()) as Medio
    expect(medioEnlace).toMatchObject({
      tipo: 'enlace',
      orden: 0,
      url: 'https://www.youtube.com/watch?v=abc',
    })
    expect(
      (
        await pedir('POST', `${base()}/${e.id}/medios/enlace`, 'delegado', {
          url: 'javascript:alert(1)',
        })
      ).status,
    ).toBe(400)

    const foto = (await (await subirFoto(e.id)).json()) as Medio
    expect(foto.orden).toBe(1)

    const pie = await pedir('PATCH', `${base()}/${e.id}/medios/${foto.id}`, 'delegado', {
      pie: 'Colocación',
    })
    expect((await pie.json()).pie).toBe('Colocación')

    const orden = await pedir('PUT', `${base()}/${e.id}/medios/orden`, 'delegado', {
      medios: [foto.id, medioEnlace.id],
    })
    expect(((await orden.json()) as Ejercicio).medios.map((m) => m.tipo)).toEqual([
      'foto',
      'enlace',
    ])
    expect(
      (await pedir('PUT', `${base()}/${e.id}/medios/orden`, 'delegado', { medios: [foto.id] }))
        .status,
    ).toBe(400)

    const lista = (await (await pedir('GET', `${base()}?q=salida`, 'jugador')).json()) as Resumen[]
    expect(lista[0]).toMatchObject({ medios: 2, urlMiniatura: `/api/medios/${foto.id}/miniatura` })
  })
})

describe('borrar y duplicar', () => {
  it('se borra si no se ha usado, con sus archivos; si se ha usado, hay que archivarlo', async () => {
    const libre = await crear({ nombre: 'Sin usar' })
    const foto = (await (await subirFoto(libre.id)).json()) as Medio
    const [fila] = await db.select().from(ejercicioMedios).where(eq(ejercicioMedios.id, foto.id))
    expect((await pedir('DELETE', `${base()}/${libre.id}`, 'delegado')).status).toBe(204)
    expect(existsSync(absoluta(fila?.archivo ?? ''))).toBe(false)
    expect((await pedir('GET', `${base()}/${libre.id}`, 'jugador')).status).toBe(404)

    const usado = await crear({ nombre: 'Usado' })
    const [entreno] = await db
      .insert(entrenos)
      .values({ plantillaId: ids.plantilla ?? '', fecha: '2026-10-20' })
      .returning()
    await db
      .insert(entrenoEjercicios)
      .values({ entrenoId: entreno?.id ?? '', ejercicioId: usado.id, orden: 0 })
    expect((await (await pedir('GET', `${base()}/${usado.id}`, 'jugador')).json()).usos).toBe(1)
    const res = await pedir('DELETE', `${base()}/${usado.id}`, 'delegado')
    expect(res.status).toBe(409)
    expect((await res.json()).error.mensaje).toMatch(/archívalo/)
  })

  it('duplicar copia los datos y los medios, con archivos propios', async () => {
    const e = await crear({
      nombre: 'Rondo con comodín',
      categoria: 'tecnica',
      etiquetas: ['rondo'],
    })
    await pedir('POST', `${base()}/${e.id}/medios/enlace`, 'delegado', {
      url: 'https://youtu.be/x',
    })
    await subirFoto(e.id)
    const res = await pedir('POST', `${base()}/${e.id}/duplicar`, 'delegado')
    expect(res.status).toBe(201)
    const copia = (await res.json()) as Ejercicio
    expect(copia).toMatchObject({
      nombre: 'Rondo con comodín (copia)',
      categoria: 'tecnica',
      etiquetas: ['rondo'],
    })
    expect(copia.medios.map((m) => m.tipo)).toEqual(['enlace', 'foto'])

    const archivos = await db
      .select({ archivo: ejercicioMedios.archivo, ejercicioId: ejercicioMedios.ejercicioId })
      .from(ejercicioMedios)
      .where(inArray(ejercicioMedios.ejercicioId, [e.id, copia.id]))
    const fotos = archivos.filter((a) => a.archivo)
    expect(new Set(fotos.map((f) => f.archivo)).size).toBe(2)
    expect(fotos.every((f) => existsSync(absoluta(f.archivo ?? '')))).toBe(true)
    expect((await pedir('POST', `${base()}/${e.id}/duplicar`, 'jugador')).status).toBe(403)
  })
})
