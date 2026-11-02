import { existsSync, readFileSync } from 'node:fs'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { archivosPartido, clubes, membresias, user } from '../src/db/schema/index.js'
import { absoluta } from '../src/medios/almacen.js'
import { MAXIMO_ARCHIVOS } from '../src/rutas/planificacion.js'
import { restriccionViolada } from '../src/validacion.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Planificación de un partido (GH-147). El límite de las fotos en los tests es 1 MB (vitest.config.ts)

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}

const fixture = (nombre: string) => readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url))

type Archivo = {
  id: string
  titulo: string | null
  nombreOriginal: string
  tipo: 'pdf' | 'imagen'
  tamanoBytes: number
  subidoPor: string | null
}

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

const ruta = (pid: string, resto = '', plantilla = ids.senior) =>
  `/plantillas/${plantilla}/partidos/${pid}${resto}`

function subir(
  pid: string,
  contenido: Buffer,
  nombre: string,
  quien = 'delegado',
  titulo?: string,
) {
  const form = new FormData()
  form.append('archivo', new File([new Uint8Array(contenido)], nombre))
  if (titulo !== undefined) form.append('titulo', titulo)
  return app.request(`/api${ruta(pid, '/archivos')}`, {
    method: 'POST',
    headers: { origin: ORIGEN, cookie: cookies[quien] ?? '' },
    body: form,
  })
}

async function crearPartido(plantilla = ids.senior) {
  const res = await pedir('POST', `/plantillas/${plantilla}/partidos`, 'admin', {
    rival: 'CD Proba Rival',
    fecha: '2026-10-11',
  })
  return (await res.json()).id as string
}

const rutasEnDisco = async (pid: string) =>
  (
    await db
      .select({ archivo: archivosPartido.archivo })
      .from(archivosPartido)
      .where(eq(archivosPartido.partidoId, pid))
  ).map((a) => absoluta(a.archivo))

async function crearPlantilla(nombre: string) {
  const res = await pedir('POST', '/plantillas', 'admin', {
    clubId: ids.club,
    nombre,
    categoria: 'sénior',
    temporada: '2026-27',
  })
  return (await res.json()).id as string
}

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador']) await usuario(clave)
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'Rexional CF' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  ids.senior = await crearPlantilla('Senior')
  await db.insert(membresias).values([
    { plantillaId: ids.senior ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('planificación del partido', () => {
  it('sube un PDF tal cual y una foto en WebP sin metadatos; se descargan con su nombre', async () => {
    const pid = await crearPartido()
    const pdf = fixture('ficha-partido.pdf')
    const resPdf = await subir(pid, pdf, 'Charla técnica.pdf', 'delegado', '  Charla  ')
    expect(resPdf.status).toBe(201)
    const resFoto = await subir(pid, fixture('foto-gps.jpg'), 'pizarra.jpg')
    expect(resFoto.status).toBe(201)

    const archivos: Archivo[] = await (
      await pedir('GET', ruta(pid, '/archivos'), 'delegado')
    ).json()
    expect(archivos).toEqual([
      expect.objectContaining({
        titulo: 'Charla',
        nombreOriginal: 'Charla técnica.pdf',
        tipo: 'pdf',
        tamanoBytes: pdf.length,
        subidoPor: 'delegado',
      }),
      expect.objectContaining({ titulo: null, nombreOriginal: 'pizarra.jpg', tipo: 'imagen' }),
    ])
    const [delPdf, deFoto] = archivos

    const bajada = await pedir('GET', ruta(pid, `/archivos/${delPdf?.id}`), 'delegado')
    expect(bajada.status).toBe(200)
    expect(bajada.headers.get('content-type')).toBe('application/pdf')
    expect(bajada.headers.get('content-disposition')).toBe(
      `inline; filename*=UTF-8''${encodeURIComponent('Charla técnica.pdf')}`,
    )
    expect(Buffer.from(await bajada.arrayBuffer()).equals(pdf)).toBe(true)

    const foto = await pedir('GET', ruta(pid, `/archivos/${deFoto?.id}`), 'delegado')
    expect(foto.headers.get('content-type')).toBe('image/webp')
    expect(foto.headers.get('content-disposition')).toContain('pizarra.webp')
    const meta = await sharp(Buffer.from(await foto.arrayBuffer())).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.exif).toBeUndefined()
  })

  it('el título se cambia y se quita; quitar el archivo lo borra del disco', async () => {
    const pid = await crearPartido()
    const [archivo] = (await (
      await subir(pid, fixture('ficha-partido.pdf'), 'rival.pdf')
    ).json()) as Archivo[]
    const cambiado = await pedir('PATCH', ruta(pid, `/archivos/${archivo?.id}`), 'delegado', {
      titulo: 'Análisis del rival',
    })
    expect(((await cambiado.json()) as Archivo[])[0]?.titulo).toBe('Análisis del rival')
    const sinTitulo = await pedir('PATCH', ruta(pid, `/archivos/${archivo?.id}`), 'delegado', {
      titulo: '  ',
    })
    expect(((await sinTitulo.json()) as Archivo[])[0]?.titulo).toBeNull()

    const [enDisco] = await rutasEnDisco(pid)
    expect(enDisco && existsSync(enDisco)).toBe(true)
    const quitado = await pedir('DELETE', ruta(pid, `/archivos/${archivo?.id}`), 'delegado')
    expect(await quitado.json()).toEqual([])
    expect(existsSync(enDisco ?? '')).toBe(false)
    expect((await pedir('DELETE', ruta(pid, `/archivos/${archivo?.id}`), 'delegado')).status).toBe(
      404,
    )
  })

  it('el jugador no los ve, no los descarga ni los sube, y no van en el detalle', async () => {
    const pid = await crearPartido()
    const [archivo] = (await (
      await subir(pid, fixture('ficha-partido.pdf'), 'secreto.pdf')
    ).json()) as Archivo[]
    expect((await pedir('GET', ruta(pid, '/archivos'), 'jugador')).status).toBe(403)
    expect((await pedir('GET', ruta(pid, `/archivos/${archivo?.id}`), 'jugador')).status).toBe(403)
    expect((await subir(pid, fixture('ficha-partido.pdf'), 'x.pdf', 'jugador')).status).toBe(403)
    expect(await (await pedir('GET', ruta(pid), 'jugador')).text()).not.toContain('secreto')
  })

  it.each([
    ['un vídeo', 'video.webm', 415],
    ['un archivo que no es PDF ni foto', 'texto.pdf', 415],
  ])('rechaza %s', async (_, nombre, estado) => {
    const pid = await crearPartido()
    const contenido = nombre === 'texto.pdf' ? Buffer.from('esto no es un PDF') : fixture(nombre)
    expect((await subir(pid, contenido, nombre)).status).toBe(estado)
    expect(await rutasEnDisco(pid)).toEqual([])
  })

  it('rechaza un archivo por encima del límite de las fotos', async () => {
    const pid = await crearPartido()
    const grande = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 * 1024 + 1)])
    const res = await subir(pid, grande, 'grande.pdf')
    expect(res.status).toBe(413)
    expect((await res.json()).error.mensaje).toBe('El archivo no puede pasar de 1 MB')
  })

  it(`como mucho ${MAXIMO_ARCHIVOS} por partido`, async () => {
    const pid = await crearPartido()
    for (let i = 0; i < MAXIMO_ARCHIVOS; i++) {
      expect((await subir(pid, fixture('ficha-partido.pdf'), `${i}.pdf`)).status).toBe(201)
    }
    const otro = await subir(pid, fixture('ficha-partido.pdf'), 'otro.pdf')
    expect((await otro.json()).error.codigo).toBe('demasiados_archivos')
    expect(await rutasEnDisco(pid)).toHaveLength(MAXIMO_ARCHIVOS)
  })

  it('no se toca un archivo de otro partido', async () => {
    const [a, b] = [await crearPartido(), await crearPartido()]
    const [archivo] = (await (
      await subir(a, fixture('ficha-partido.pdf'), 'a.pdf')
    ).json()) as Archivo[]
    for (const [metodo, cuerpo] of [
      ['GET', undefined],
      ['PATCH', { titulo: 'x' }],
      ['DELETE', undefined],
    ] as const) {
      const res = await pedir(metodo, ruta(b, `/archivos/${archivo?.id}`), 'delegado', cuerpo)
      expect(res.status).toBe(404)
    }
  })

  it('al borrar el partido o la plantilla se borran sus archivos del disco', async () => {
    const pid = await crearPartido()
    await subir(pid, fixture('ficha-partido.pdf'), 'a.pdf')
    const [delPartido] = await rutasEnDisco(pid)
    expect((await pedir('DELETE', ruta(pid), 'delegado')).status).toBe(204)
    expect(existsSync(delPartido ?? '')).toBe(false)

    const otra = await crearPlantilla('Juvenil')
    const enOtra = await crearPartido(otra)
    const form = new FormData()
    form.append('archivo', new File([new Uint8Array(fixture('ficha-partido.pdf'))], 'b.pdf'))
    await app.request(`/api${ruta(enOtra, '/archivos', otra)}`, {
      method: 'POST',
      headers: { origin: ORIGEN, cookie: cookies.admin ?? '' },
      body: form,
    })
    const [dePlantilla] = await rutasEnDisco(enOtra)
    expect(dePlantilla && existsSync(dePlantilla)).toBe(true)
    const borrada = await pedir('DELETE', `/plantillas/${otra}`, 'admin', {
      confirmacion: 'Juvenil',
    })
    expect(borrada.status).toBe(204)
    expect(existsSync(dePlantilla ?? '')).toBe(false)
  })

  it('la base de datos solo admite PDF o WebP', async () => {
    const pid = await crearPartido()
    let error: unknown
    try {
      await db.insert(archivosPartido).values({
        partidoId: pid,
        nombreOriginal: 'x.exe',
        archivo: 'partidos/x/y/z.exe',
        mime: 'application/octet-stream',
        tamanoBytes: 1,
      })
    } catch (e) {
      error = e
    }
    expect(restriccionViolada(error)).toBe('archivos_partido_mime')
  })
})
