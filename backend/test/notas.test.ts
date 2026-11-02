import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, membresias, notasPartido, user } from '../src/db/schema/index.js'
import { MAXIMO_NOTAS } from '../src/rutas/notas.js'
import { restriccionViolada } from '../src/validacion.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Notas del cuerpo técnico durante el partido (GH-149)

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

type Nota = { id: string; tipo: string; texto: string; minuto: number | null; autor: string | null }

async function crearPartido() {
  const res = await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
    rival: 'CD Proba Rival',
    fecha: '2026-10-11',
  })
  return (await res.json()).id as string
}

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'entrenador', 'jugador']) await usuario(clave)
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
    { plantillaId: ids.senior ?? '', usuarioId: ids.entrenador ?? '', rol: 'entrenador' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('notas del partido', () => {
  it('el cuerpo técnico anota, cambia y borra; se ordenan por minuto y sin minuto al final', async () => {
    const pid = await crearPartido()
    const primera = await pedir('POST', ruta(pid, '/notas'), 'delegado', {
      tipo: 'tactica',
      texto: '  Presionar la salida por la izquierda  ',
      minuto: 30,
    })
    expect(primera.status).toBe(201)
    await pedir('POST', ruta(pid, '/notas'), 'entrenador', {
      tipo: 'otra',
      texto: 'Revisar el calentamiento',
    })
    await pedir('POST', ruta(pid, '/notas'), 'entrenador', {
      tipo: 'incidencia',
      texto: 'Golpe en el tobillo del 7',
      minuto: 12,
    })

    const notas: Nota[] = await (await pedir('GET', ruta(pid, '/notas'), 'delegado')).json()
    expect(notas.map((n) => [n.minuto, n.tipo, n.texto])).toEqual([
      [12, 'incidencia', 'Golpe en el tobillo del 7'],
      [30, 'tactica', 'Presionar la salida por la izquierda'],
      [null, 'otra', 'Revisar el calentamiento'],
    ])
    expect(notas[1]?.autor).toBe('delegado')

    // Cualquiera del cuerpo técnico cambia la nota de otro; minuto null lo quita
    const [incidencia, tactica] = notas
    const cambiada = await pedir('PATCH', ruta(pid, `/notas/${tactica?.id}`), 'entrenador', {
      texto: 'Presionar la salida por la derecha',
      minuto: null,
    })
    expect(cambiada.status).toBe(200)
    // Sin minuto pasa al final; entre las que no tienen, por orden de alta
    const tras: Nota[] = await cambiada.json()
    expect(tras.map((n) => n.id)).toEqual([incidencia?.id, tactica?.id, notas[2]?.id])
    expect(tras[1]).toMatchObject({
      texto: 'Presionar la salida por la derecha',
      minuto: null,
      autor: 'delegado',
    })

    const borrada = await pedir('DELETE', ruta(pid, `/notas/${incidencia?.id}`), 'delegado')
    expect(borrada.status).toBe(200)
    expect(await borrada.json()).toHaveLength(2)
    expect((await pedir('DELETE', ruta(pid, `/notas/${incidencia?.id}`), 'delegado')).status).toBe(
      404,
    )
  })

  it('el jugador no las ve ni las crea, y no van en el detalle del partido', async () => {
    const pid = await crearPartido()
    await pedir('POST', ruta(pid, '/notas'), 'delegado', { tipo: 'tactica', texto: 'Secreta' })
    expect((await pedir('GET', ruta(pid, '/notas'), 'jugador')).status).toBe(403)
    expect(
      (await pedir('POST', ruta(pid, '/notas'), 'jugador', { tipo: 'otra', texto: 'x' })).status,
    ).toBe(403)
    const detalle = await (await pedir('GET', ruta(pid), 'jugador')).text()
    expect(detalle).not.toContain('Secreta')
  })

  it.each([
    ['un texto vacío', { tipo: 'otra', texto: '   ' }],
    ['un texto demasiado largo', { tipo: 'otra', texto: 'x'.repeat(1001) }],
    ['un tipo desconocido', { tipo: 'gol', texto: 'x' }],
    ['un minuto fuera de rango', { tipo: 'otra', texto: 'x', minuto: 151 }],
    ['campos de más', { tipo: 'otra', texto: 'x', otro: 1 }],
  ])('rechaza %s', async (_, cuerpo) => {
    const pid = await crearPartido()
    expect((await pedir('POST', ruta(pid, '/notas'), 'delegado', cuerpo)).status).toBe(400)
  })

  it('un cambio sin nada que cambiar es un error', async () => {
    const pid = await crearPartido()
    const [nota] = (await (
      await pedir('POST', ruta(pid, '/notas'), 'delegado', { tipo: 'otra', texto: 'x' })
    ).json()) as Nota[]
    expect((await pedir('PATCH', ruta(pid, `/notas/${nota?.id}`), 'delegado', {})).status).toBe(400)
  })

  it(`como mucho ${MAXIMO_NOTAS} por partido`, async () => {
    const pid = await crearPartido()
    await db.insert(notasPartido).values(
      Array.from({ length: MAXIMO_NOTAS }, (_, i) => ({
        partidoId: pid,
        tipo: 'otra' as const,
        texto: `Nota ${i}`,
      })),
    )
    const otra = await pedir('POST', ruta(pid, '/notas'), 'delegado', { tipo: 'otra', texto: 'x' })
    expect((await otra.json()).error.codigo).toBe('demasiadas_notas')
  })

  it('no se toca una nota de otro partido', async () => {
    const [a, b] = [await crearPartido(), await crearPartido()]
    const [nota] = (await (
      await pedir('POST', ruta(a, '/notas'), 'delegado', { tipo: 'otra', texto: 'x' })
    ).json()) as Nota[]
    expect(
      (await pedir('PATCH', ruta(b, `/notas/${nota?.id}`), 'delegado', { texto: 'y' })).status,
    ).toBe(404)
    expect((await pedir('DELETE', ruta(b, `/notas/${nota?.id}`), 'delegado')).status).toBe(404)
  })

  it('la base de datos exige texto y minuto válido, y se borran con el partido', async () => {
    const pid = await crearPartido()
    for (const [valores, restriccion] of [
      [{ texto: ' ' }, 'notas_partido_texto_valido'],
      [{ texto: 'x', minuto: 151 }, 'notas_partido_minuto_valido'],
    ] as const) {
      let error: unknown
      try {
        await db.insert(notasPartido).values({ partidoId: pid, tipo: 'otra', ...valores })
      } catch (e) {
        error = e
      }
      expect(restriccionViolada(error)).toBe(restriccion)
    }

    await pedir('POST', ruta(pid, '/notas'), 'delegado', { tipo: 'otra', texto: 'x' })
    expect((await pedir('DELETE', ruta(pid), 'delegado')).status).toBe(204)
    expect(await db.$count(notasPartido, inArray(notasPartido.partidoId, [pid]))).toBe(0)
  })
})
