import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, membresias, user } from '../src/db/schema/index.js'
import { absoluta } from '../src/medios/almacen.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Escudo del club (GH-28): solo PNG o WebP, hasta 2 MB (el límite por defecto), guardado como WebP
// de hasta 512 px. Lo cambian los administradores del club y lo ve cualquier miembro.

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

const pedir = (metodo: string, ruta: string, quien?: string) =>
  app.request(ruta.startsWith('/api') ? ruta : `/api${ruta}`, {
    method: metodo,
    headers: { origin: ORIGEN, ...(quien ? { cookie: cookies[quien] ?? '' } : {}) },
  })

function subir(contenido: Buffer, nombre: string, quien = 'admin') {
  const form = new FormData()
  form.append('archivo', new File([new Uint8Array(contenido)], nombre))
  return app.request(`/api/clubes/${ids.club}/escudo`, {
    method: 'PUT',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

// Un escudo apaisado y con transparencia
const imagen = (formato: 'png' | 'webp' | 'jpeg', ancho = 1000, alto = 600) => {
  const base = sharp({
    create: {
      width: ancho,
      height: alto,
      channels: 4,
      background: { r: 20, g: 85, b: 61, alpha: 0.5 },
    },
  })
  return (
    formato === 'png' ? base.png() : formato === 'webp' ? base.webp() : base.jpeg()
  ).toBuffer()
}

const rutaGuardada = async () =>
  (
    await db
      .select({ escudo: clubes.escudo })
      .from(clubes)
      .where(eq(clubes.id, ids.club ?? ''))
  )[0]?.escudo ?? null

beforeAll(async () => {
  for (const clave of ['admin', 'entrenador', 'jugador', 'ajeno']) await usuario(clave)
  const res = await app.request('/api/clubes', {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies.admin ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({ nombre: 'CD Escudo' }),
  })
  ids.club = (await res.json()).id
  const plantilla = await app.request('/api/plantillas', {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies.admin ?? '', 'content-type': 'application/json' },
    body: JSON.stringify({
      clubId: ids.club,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
    }),
  })
  ids.plantilla = (await plantilla.json()).id
  await db.insert(membresias).values([
    { plantillaId: ids.plantilla ?? '', usuarioId: ids.entrenador ?? '', rol: 'admin' },
    { plantillaId: ids.plantilla ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
})

afterAll(async () => {
  await db.delete(clubes).where(eq(clubes.id, ids.club ?? ''))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('subir el escudo', () => {
  it('un PNG se guarda como WebP de hasta 512 px, sin recortar y con su transparencia', async () => {
    const res = await subir(await imagen('png'), 'escudo.png')
    expect(res.status).toBe(200)
    const club = await res.json()
    expect(club.escudo).toMatch(new RegExp(`^/api/clubes/${ids.club}/escudo\\?v=[0-9a-f-]{36}$`))

    const ruta = await rutaGuardada()
    expect(ruta).toMatch(new RegExp(`^clubes/${ids.club}/[0-9a-f-]{36}\\.webp$`))
    const datos = await sharp(readFileSync(absoluta(ruta ?? ''))).metadata()
    expect(datos).toMatchObject({ format: 'webp', width: 512, height: 307, hasAlpha: true })
    ids.url = club.escudo
  })

  it('lo ve cualquier miembro del club, con caché larga; un ajeno, no', async () => {
    const res = await pedir('GET', ids.url ?? '', 'jugador')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('private, max-age=31536000, immutable')
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).format).toBe('webp')
    expect((await pedir('GET', ids.url ?? '', 'ajeno')).status).toBe(403)
    expect((await pedir('GET', ids.url ?? '')).status).toBe(401)
  })

  it('llega con las plantillas del club', async () => {
    const lista = await (await pedir('GET', `/plantillas?club=${ids.club}`, 'jugador')).json()
    expect(lista[0].club.escudo).toBe(ids.url)
  })

  it('al cambiarlo, la URL cambia y el anterior se borra', async () => {
    const anterior = await rutaGuardada()
    const res = await subir(await imagen('webp', 300, 300), 'nuevo.webp')
    expect(res.status).toBe(200)
    const { escudo } = await res.json()
    expect(escudo).not.toBe(ids.url)
    expect(existsSync(absoluta(anterior ?? ''))).toBe(false)
    // Uno pequeño no se agranda
    expect(
      await sharp(readFileSync(absoluta((await rutaGuardada()) ?? ''))).metadata(),
    ).toMatchObject({
      width: 300,
      height: 300,
    })
    ids.url = escudo
  })

  it('solo PNG o WebP, por su contenido y no por el nombre', async () => {
    for (const [contenido, nombre] of [
      [await imagen('jpeg'), 'escudo.jpg'],
      [await imagen('jpeg'), 'escudo.png'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'escudo.svg'],
      [Buffer.from('esto no es una imagen, aunque se llame .png'), 'escudo.png'],
    ] as const) {
      const res = await subir(contenido, nombre)
      expect(res.status, nombre).toBe(415)
      expect((await res.json()).error.codigo).toBe('tipo_no_admitido')
    }
  })

  it('un PNG dañado no se guarda', async () => {
    const cabecera = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const res = await subir(Buffer.concat([cabecera, randomBytes(2000)]), 'roto.png')
    expect(res.status).toBe(415)
    expect((await res.json()).error.mensaje).toBe('El escudo está dañado o no se puede leer')
  })

  it('hasta 2 MB', async () => {
    const cabecera = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const res = await subir(Buffer.concat([cabecera, randomBytes(2 * 1024 * 1024)]), 'enorme.png')
    expect(res.status).toBe(413)
    expect((await res.json()).error.mensaje).toBe('El escudo no puede pasar de 2 MB')
  })

  it('sin archivo: 400; el escudo que había sigue', async () => {
    const res = await app.request(`/api/clubes/${ids.club}/escudo`, {
      method: 'PUT',
      headers: { origin: ORIGEN, cookie: cookies.admin ?? '' },
      body: new FormData(),
    })
    expect(res.status).toBe(400)
    expect((await pedir('GET', ids.url ?? '', 'jugador')).status).toBe(200)
  })

  it('solo los administradores del club; ser admin de una plantilla no basta', async () => {
    for (const quien of ['entrenador', 'jugador', 'ajeno']) {
      expect((await subir(await imagen('png'), 'escudo.png', quien)).status, quien).toBe(403)
      expect((await pedir('DELETE', `/clubes/${ids.club}/escudo`, quien)).status, quien).toBe(403)
    }
  })
})

describe('quitar el escudo', () => {
  it('vuelve el logo genérico y el archivo se borra', async () => {
    const ruta = await rutaGuardada()
    const res = await pedir('DELETE', `/clubes/${ids.club}/escudo`, 'admin')
    expect(res.status).toBe(200)
    expect((await res.json()).escudo).toBeNull()
    expect(await rutaGuardada()).toBeNull()
    expect(existsSync(absoluta(ruta ?? ''))).toBe(false)
    expect((await pedir('GET', `/clubes/${ids.club}/escudo`, 'jugador')).status).toBe(404)
  })
})
