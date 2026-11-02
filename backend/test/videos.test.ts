import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, membresias, user, videosPartido } from '../src/db/schema/index.js'
import { MAXIMO_VIDEOS } from '../src/rutas/videos.js'
import { restriccionViolada } from '../src/validacion.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Enlaces al vídeo de un partido (GH-134)

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

const ruta = (pid: string, resto = '') => `/plantillas/${ids.senior}/partidos/${pid}${resto}`

type Video = { id: string; url: string; titulo: string | null }

async function crearPartido() {
  const res = await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
    rival: 'CD Proba Rival',
    fecha: '2026-10-11',
  })
  return (await res.json()).id as string
}

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
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('vídeos del partido', () => {
  it('el cuerpo técnico los añade, cambia y quita; cualquier miembro los ve en el partido', async () => {
    const pid = await crearPartido()
    const nuevo = await pedir('POST', ruta(pid, '/videos'), 'delegado', {
      url: 'https://www.youtube.com/watch?v=abc',
      titulo: ' 1ª parte ',
    })
    expect(nuevo.status).toBe(201)
    await pedir('POST', ruta(pid, '/videos'), 'delegado', {
      url: 'https://drive.google.com/file/d/xyz',
    })

    // El jugador los ve, por orden de alta, y el título vacío es null
    const partido = await (await pedir('GET', ruta(pid), 'jugador')).json()
    expect(partido.videos).toEqual([
      { id: expect.any(String), url: 'https://www.youtube.com/watch?v=abc', titulo: '1ª parte' },
      { id: expect.any(String), url: 'https://drive.google.com/file/d/xyz', titulo: null },
    ])
    const [primero, segundo] = partido.videos as Video[]

    const cambiado = await pedir('PATCH', ruta(pid, `/videos/${segundo?.id}`), 'delegado', {
      titulo: '2ª parte',
    })
    expect(cambiado.status).toBe(200)
    expect((await cambiado.json()).videos[1]).toMatchObject({ titulo: '2ª parte' })
    // Un título vacío lo quita
    const sinTitulo = await pedir('PATCH', ruta(pid, `/videos/${primero?.id}`), 'delegado', {
      titulo: '  ',
    })
    expect((await sinTitulo.json()).videos[0]).toMatchObject({ titulo: null })

    const quitado = await pedir('DELETE', ruta(pid, `/videos/${primero?.id}`), 'delegado')
    expect(quitado.status).toBe(200)
    expect((await quitado.json()).videos).toHaveLength(1)
    expect((await pedir('DELETE', ruta(pid, `/videos/${primero?.id}`), 'delegado')).status).toBe(
      404,
    )
  })

  it('el jugador no los gestiona', async () => {
    const pid = await crearPartido()
    const url = 'https://www.youtube.com/watch?v=abc'
    expect((await pedir('POST', ruta(pid, '/videos'), 'jugador', { url })).status).toBe(403)
  })

  it.each([
    ['una URL que no es web', { url: 'javascript:alert(1)' }],
    ['un texto que no es URL', { url: 'youtube' }],
    ['un título demasiado largo', { url: 'https://youtu.be/abc', titulo: 'x'.repeat(81) }],
    ['campos de más', { url: 'https://youtu.be/abc', otro: 1 }],
  ])('rechaza %s', async (_, cuerpo) => {
    const pid = await crearPartido()
    expect((await pedir('POST', ruta(pid, '/videos'), 'delegado', cuerpo)).status).toBe(400)
  })

  it(`como mucho ${MAXIMO_VIDEOS} por partido`, async () => {
    const pid = await crearPartido()
    for (let i = 0; i < MAXIMO_VIDEOS; i++) {
      const res = await pedir('POST', ruta(pid, '/videos'), 'delegado', {
        url: `https://youtu.be/v${i}`,
      })
      expect(res.status).toBe(201)
    }
    const otro = await pedir('POST', ruta(pid, '/videos'), 'delegado', {
      url: 'https://youtu.be/otro',
    })
    expect((await otro.json()).error.codigo).toBe('demasiados_videos')
  })

  it('no se toca un vídeo de otro partido', async () => {
    const [a, b] = [await crearPartido(), await crearPartido()]
    const { videos } = await (
      await pedir('POST', ruta(a, '/videos'), 'delegado', { url: 'https://youtu.be/a' })
    ).json()
    const id = (videos as Video[])[0]?.id
    expect(
      (await pedir('PATCH', ruta(b, `/videos/${id}`), 'delegado', { titulo: 'x' })).status,
    ).toBe(404)
    expect((await pedir('DELETE', ruta(b, `/videos/${id}`), 'delegado')).status).toBe(404)
  })

  it('la base de datos solo admite URLs web y se borran con el partido', async () => {
    const pid = await crearPartido()
    let error: unknown
    try {
      await db.insert(videosPartido).values({ partidoId: pid, url: 'ftp://x' })
    } catch (e) {
      error = e
    }
    expect(restriccionViolada(error)).toBe('videos_partido_url_web')

    await pedir('POST', ruta(pid, '/videos'), 'delegado', { url: 'https://youtu.be/a' })
    expect((await pedir('DELETE', ruta(pid), 'delegado')).status).toBe(204)
    expect(await db.$count(videosPartido, inArray(videosPartido.partidoId, [pid]))).toBe(0)
  })
})
