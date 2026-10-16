import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, ejercicioMedios, ejercicios, membresias, user } from '../src/db/schema/index.js'
import { absoluta } from '../src/medios/almacen.js'
import { esperarCola } from '../src/medios/cola.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Fotos y vídeos de los ejercicios. Los límites de los tests son 1 MB por foto y 2 MB por vídeo
// (vitest.config.ts). Los vídeos necesitan ffmpeg: sin él, sus tests se saltan, salvo en la CI.

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}

const fixture = (nombre: string) => readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url))

let hayFfmpeg = false
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
  hayFfmpeg = true
} catch {
  if (process.env.CI) throw new Error('En la CI hace falta ffmpeg para los tests de vídeo')
}

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  ids[clave] = u.id
}

const pedir = (
  metodo: string,
  ruta: string,
  quien?: string,
  cabeceras: Record<string, string> = {},
) =>
  app.request(`/api${ruta}`, {
    method: metodo,
    headers: { origin: ORIGEN, ...(quien ? { cookie: cookies[quien] ?? '' } : {}), ...cabeceras },
  })

function subir(
  contenido: Buffer,
  nombre: string,
  quien = 'delegado',
  ejercicio = ids.ejercicio,
  pie?: string,
) {
  const form = new FormData()
  form.append('archivo', new File([new Uint8Array(contenido)], nombre))
  if (pie) form.append('pie', pie)
  return app.request(`/api/clubes/${ids.club}/ejercicios/${ejercicio}/medios`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

type Medio = {
  id: string
  tipo: string
  estado: string
  mime: string | null
  orden: number
  pie: string | null
  duracionSeg: number | null
  urlArchivo: string | null
  urlMiniatura: string | null
}

const descargar = async (url: string, quien = 'jugador', cabeceras: Record<string, string> = {}) =>
  pedir('GET', url.replace(/^\/api/, ''), quien, cabeceras)

const filaMedio = async (id: string) =>
  (await db.select().from(ejercicioMedios).where(eq(ejercicioMedios.id, id)))[0]

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)
  const club = await (
    await app.request('/api/clubes', {
      method: 'POST',
      headers: { origin: ORIGEN, cookie: cookies.admin ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'CD Medios' }),
    })
  ).json()
  const otro = await (
    await app.request('/api/clubes', {
      method: 'POST',
      headers: { origin: ORIGEN, cookie: cookies.ajeno ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'Otro club' }),
    })
  ).json()
  clubesCreados.push(club.id, otro.id)
  ids.club = club.id
  const plantilla = await (
    await app.request('/api/plantillas', {
      method: 'POST',
      headers: { origin: ORIGEN, cookie: cookies.admin ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({
        clubId: club.id,
        nombre: 'Senior',
        categoria: 'sénior',
        temporada: '2026-27',
      }),
    })
  ).json()
  await db.insert(membresias).values([
    { plantillaId: plantilla.id, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: plantilla.id, usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
  const [ejercicio, ajeno] = await db
    .insert(ejercicios)
    .values([
      { clubId: club.id, nombre: 'Rondo' },
      { clubId: otro.id, nombre: 'Del otro club' },
    ])
    .returning()
  ids.ejercicio = ejercicio?.id ?? ''
  ids.ejercicioAjeno = ajeno?.id ?? ''
})

afterAll(async () => {
  await esperarCola()
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('fotos', () => {
  it('se guarda reducida, en WebP, sin la ubicación del EXIF y con miniatura', async () => {
    const res = await subir(
      fixture('foto-gps.jpg'),
      'IMG_1234.JPG',
      'delegado',
      ids.ejercicio,
      ' En el campo 2 ',
    )
    expect(res.status).toBe(201)
    const medio = (await res.json()) as Medio
    expect(medio).toMatchObject({
      tipo: 'foto',
      estado: 'listo',
      mime: 'image/webp',
      orden: 0,
      pie: 'En el campo 2',
    })

    // La ve un jugador del club
    const archivo = await descargar(medio.urlArchivo ?? '')
    expect(archivo.status).toBe(200)
    expect(archivo.headers.get('content-type')).toBe('image/webp')
    expect(archivo.headers.get('cache-control')).toContain('immutable')
    const datos = await sharp(Buffer.from(await archivo.arrayBuffer())).metadata()
    expect(datos).toMatchObject({ format: 'webp', width: 1920, height: 1440 })
    expect(datos.exif).toBeUndefined()

    const miniatura = await sharp(
      Buffer.from(await (await descargar(medio.urlMiniatura ?? '')).arrayBuffer()),
    ).metadata()
    expect(miniatura).toMatchObject({ format: 'webp', width: 480 })

    // En disco no queda el nombre original
    const fila = await filaMedio(medio.id)
    expect(fila?.archivo).toMatch(new RegExp(`^ejercicios/${ids.club}/[0-9a-f-]{36}\\.webp$`))

    // La siguiente va detrás
    const otra = (await (await subir(fixture('foto-gps.jpg'), 'otra.jpg')).json()) as Medio
    expect(otra.orden).toBe(1)
  })

  it('rechaza lo que no es una foto o un vídeo, las HEIC y lo que pasa del límite', async () => {
    const pdf = await subir(fixture('ficha-partido.pdf'), 'foto.jpg')
    expect(pdf.status).toBe(415)
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'latin1'),
      Buffer.alloc(64),
    ])
    const resHeic = await subir(heic, 'IMG_0001.HEIC')
    expect(resHeic.status).toBe(415)
    expect((await resHeic.json()).error.mensaje).toMatch(/HEIC/)
    const grande = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(1024 * 1024 + 10),
    ])
    const resGrande = await subir(grande, 'grande.jpg')
    expect(resGrande.status).toBe(413)
    expect((await resGrande.json()).error.mensaje).toMatch(/1 MB/)
    // Sin formulario
    const sinFormulario = await app.request(
      `/api/clubes/${ids.club}/ejercicios/${ids.ejercicio}/medios`,
      {
        method: 'POST',
        headers: {
          origin: ORIGEN,
          cookie: cookies.delegado ?? '',
          'content-type': 'application/json',
        },
        body: '{}',
      },
    )
    expect(sinFormulario.status).toBe(400)
  })

  it('solo el cuerpo técnico sube, y solo los del club ven los archivos', async () => {
    expect((await subir(fixture('foto-gps.jpg'), 'a.jpg', 'jugador')).status).toBe(403)
    expect((await subir(fixture('foto-gps.jpg'), 'a.jpg', 'ajeno')).status).toBe(403)
    // Un ejercicio de otro club, no
    expect(
      (await subir(fixture('foto-gps.jpg'), 'a.jpg', 'delegado', ids.ejercicioAjeno)).status,
    ).toBe(404)
    const medio = (await (await subir(fixture('foto-gps.jpg'), 'a.jpg')).json()) as Medio
    expect((await descargar(medio.urlArchivo ?? '', 'ajeno')).status).toBe(403)
    expect((await pedir('GET', medio.urlArchivo?.replace('/api', '') ?? '')).status).toBe(401)
    expect(
      (await pedir('GET', '/medios/00000000-0000-7000-8000-000000000000', 'jugador')).status,
    ).toBe(404)
  })

  it('al quitarlo se borran sus archivos', async () => {
    const medio = (await (await subir(fixture('foto-gps.jpg'), 'a.jpg')).json()) as Medio
    const fila = await filaMedio(medio.id)
    const rutas = [fila?.archivo ?? '', fila?.miniatura ?? ''].map(absoluta)
    expect(rutas.every((r) => existsSync(r))).toBe(true)
    const res = await pedir(
      'DELETE',
      `/clubes/${ids.club}/ejercicios/${ids.ejercicio}/medios/${medio.id}`,
      'delegado',
    )
    expect(res.status).toBe(204)
    expect(rutas.some((r) => existsSync(r))).toBe(false)
    expect(await filaMedio(medio.id)).toBeUndefined()
    expect(
      (
        await pedir(
          'DELETE',
          `/clubes/${ids.club}/ejercicios/${ids.ejercicio}/medios/${medio.id}`,
          'delegado',
        )
      ).status,
    ).toBe(404)
  })
})

describe.skipIf(!hayFfmpeg)('vídeos', () => {
  const codec = (ruta: string) =>
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name',
      '-of',
      'csv=p=0',
      ruta,
    ])
      .toString()
      .trim()

  it('un MP4 H.264 queda procesando y luego listo, tal cual, con miniatura y duración', async () => {
    const res = await subir(fixture('video-h264.mp4'), 'clip.mp4')
    expect(res.status).toBe(201)
    const medio = (await res.json()) as Medio
    expect(medio).toMatchObject({ tipo: 'video', estado: 'procesando', urlArchivo: null })
    await esperarCola()
    const fila = await filaMedio(medio.id)
    expect(fila).toMatchObject({ estado: 'listo', mime: 'video/mp4', duracionSeg: 2 })
    expect(fila?.archivo).toMatch(/^ejercicios\/.+\.mp4$/)
    expect(fila?.tamanoBytes).toBe(fixture('video-h264.mp4').length)

    // Avanzar en el vídeo: un trozo con Range
    const trozo = await descargar(`/api/medios/${medio.id}`, 'jugador', { range: 'bytes=100-199' })
    expect(trozo.status).toBe(206)
    expect(trozo.headers.get('content-range')).toBe(`bytes 100-199/${fila?.tamanoBytes}`)
    expect((await trozo.arrayBuffer()).byteLength).toBe(100)
    expect(
      (await descargar(`/api/medios/${medio.id}`, 'jugador', { range: 'bytes=999999-' })).status,
    ).toBe(416)
    const miniatura = await descargar(`/api/medios/${medio.id}/miniatura`)
    expect((await sharp(Buffer.from(await miniatura.arrayBuffer())).metadata()).format).toBe('webp')
  })

  it('un MOV HEVC del iPhone se recodifica a MP4 H.264', async () => {
    const medio = (await (await subir(fixture('video-hevc.mov'), 'IMG_0002.MOV')).json()) as Medio
    await esperarCola()
    const fila = await filaMedio(medio.id)
    expect(fila).toMatchObject({ estado: 'listo', mime: 'video/mp4', duracionSeg: 2 })
    expect(codec(absoluta(fila?.archivo ?? ''))).toBe('h264')
  })

  it('un WebM se guarda tal cual', async () => {
    const medio = (await (await subir(fixture('video.webm'), 'clip.webm')).json()) as Medio
    await esperarCola()
    expect(await filaMedio(medio.id)).toMatchObject({ estado: 'listo', mime: 'video/webm' })
  })

  it('un vídeo que pasa del límite o dañado no se guarda', async () => {
    const grande = Buffer.concat([
      fixture('video-h264.mp4').subarray(0, 32),
      Buffer.alloc(2 * 1024 * 1024),
    ])
    const res = await subir(grande, 'grande.mp4')
    expect(res.status).toBe(413)
    expect((await res.json()).error.mensaje).toMatch(/2 MB/)

    // Cabecera de MP4 y nada más: se acepta la subida y el procesado lo marca como error
    const roto = (await (
      await subir(fixture('video-h264.mp4').subarray(0, 200), 'roto.mp4')
    ).json()) as Medio
    await esperarCola()
    expect(await filaMedio(roto.id)).toMatchObject({ estado: 'error' })
  })
})
