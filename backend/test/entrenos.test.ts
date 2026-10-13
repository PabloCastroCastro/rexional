import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, entrenos, fichas, jugadores, membresias, user } from '../src/db/schema/index.js'
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

const DIA1 = '2026-09-01'
const DIA2 = '2026-09-03'
const ruta = (fecha: string) => `/plantillas/${ids.senior}/entrenos/${fecha}`

async function pasarLista(fecha: string, lista: unknown[], quien = 'delegado') {
  return pedir('PUT', `${ruta(fecha)}/asistencias`, quien, { asistencias: lista })
}

async function errorDe(res: Response) {
  return (await res.json()).error
}

const filas = (entreno: { jugadores: { nombre: string; estado: string | null }[] }) =>
  entreno.jugadores.map((j) => [j.nombre, j.estado])

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)

  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Entrenos' })).json()
  clubesCreados.push(club.id)
  ids.club = club.id
  for (const [clave, nombre] of [
    ['senior', 'Senior'],
    ['juvenil', 'Juvenil'],
  ]) {
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre,
      categoria: 'sénior',
      temporada: '2026-27',
    })
    ids[clave ?? ''] = (await res.json()).id
  }
  await db.insert(membresias).values([
    { plantillaId: ids.senior ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])

  // Senior: Brais (7), Zoe (sin dorsal), Íker (1, sin asistencias) y Hugo (10, de baja).
  // Bruno solo tiene ficha en el Juvenil.
  const lista = await db
    .insert(jugadores)
    .values(
      ['Brais', 'Zoe', 'Íker', 'Hugo', 'Bruno'].map((nombre) => ({ clubId: club.id, nombre })),
    )
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

describe('pasar lista', () => {
  it('un día sin entreno devuelve los jugadores activos sin estado', async () => {
    const res = await pedir('GET', ruta(DIA1), 'delegado')
    expect(res.status).toBe(200)
    const entreno = await res.json()
    expect(entreno).toMatchObject({
      fecha: DIA1,
      existe: false,
      recuentos: { asiste: 0, justificada: 0, falta: 0 },
    })
    expect(filas(entreno)).toEqual([
      ['Íker', null],
      ['Brais', null],
      ['Zoe', null],
    ])
  })

  it('la primera lista crea el entreno', async () => {
    const res = await pasarLista(DIA1, [
      { jugadorId: ids.Brais, estado: 'asiste' },
      { jugadorId: ids.Zoe, estado: 'justificada', motivo: '  Trabajo  ' },
    ])
    expect(res.status).toBe(200)
    const entreno = await res.json()
    expect(entreno).toMatchObject({
      existe: true,
      recuentos: { asiste: 1, justificada: 1, falta: 0 },
    })
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Zoe')).toMatchObject({
      estado: 'justificada',
      motivo: 'Trabajo',
    })
    expect(
      await db.$count(
        entrenos,
        and(eq(entrenos.plantillaId, ids.senior ?? ''), eq(entrenos.fecha, DIA1)),
      ),
    ).toBe(1)
  })

  it('cada guardado sustituye la lista completa', async () => {
    const entreno = await (await pasarLista(DIA1, [{ jugadorId: ids.Zoe, estado: 'falta' }])).json()
    expect(filas(entreno)).toEqual([
      ['Íker', null],
      ['Brais', null],
      ['Zoe', 'falta'],
    ])
    expect(entreno.recuentos).toEqual({ asiste: 0, justificada: 0, falta: 1 })
  })

  it('un motivo vacío se guarda como sin motivo', async () => {
    const entreno = await (
      await pasarLista(DIA1, [{ jugadorId: ids.Zoe, estado: 'justificada', motivo: '  ' }])
    ).json()
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Zoe').motivo).toBeNull()
  })

  it('un jugador de baja aparece solo en los días en que tiene asistencia', async () => {
    const entreno = await (
      await pasarLista(DIA2, [
        { jugadorId: ids.Brais, estado: 'falta' },
        { jugadorId: ids.Zoe, estado: 'asiste' },
        { jugadorId: ids.Hugo, estado: 'asiste' },
      ])
    ).json()
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Hugo')).toMatchObject({
      activo: false,
      estado: 'asiste',
    })
    const otroDia = await (await pedir('GET', ruta(DIA1), 'delegado')).json()
    expect(otroDia.jugadores.map((j: { nombre: string }) => j.nombre)).not.toContain('Hugo')
  })

  it('una lista vacía borra el entreno', async () => {
    await pasarLista('2026-09-05', [{ jugadorId: ids.Brais, estado: 'asiste' }])
    const res = await pasarLista('2026-09-05', [])
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ existe: false })
    const historial = await (
      await pedir('GET', `/plantillas/${ids.senior}/entrenos`, 'delegado')
    ).json()
    expect(historial.map((e: { fecha: string }) => e.fecha)).not.toContain('2026-09-05')
  })

  it('valida la lista', async () => {
    for (const lista of [
      [
        { jugadorId: ids.Brais, estado: 'asiste' },
        { jugadorId: ids.Brais, estado: 'falta' },
      ],
      [{ jugadorId: ids.Brais, estado: 'asiste', motivo: 'Trabajo' }],
      [{ jugadorId: ids.Brais, estado: 'tarde' }],
      [{ jugadorId: 'no-es-un-id', estado: 'asiste' }],
    ]) {
      const res = await pasarLista(DIA1, lista)
      expect(res.status).toBe(400)
      expect((await errorDe(res)).codigo).toBe('validacion')
    }
  })

  it('rechaza jugadores sin ficha en la plantilla', async () => {
    for (const jugadorId of [ids.Bruno, '00000000-0000-7000-8000-000000000000']) {
      const res = await pasarLista(DIA1, [{ jugadorId, estado: 'asiste' }])
      expect(res.status).toBe(400)
      expect((await errorDe(res)).codigo).toBe('jugador_sin_ficha')
    }
  })

  it('rechaza fechas que no existen y días futuros', async () => {
    expect((await pedir('GET', ruta('2026-02-30'), 'delegado')).status).toBe(400)
    expect((await pedir('GET', ruta('13-10-2026'), 'delegado')).status).toBe(400)

    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
    const manana = new Date(new Date(`${hoy}T12:00:00Z`).getTime() + 86_400_000)
      .toISOString()
      .slice(0, 10)
    const res = await pasarLista(manana, [{ jugadorId: ids.Brais, estado: 'asiste' }])
    expect(res.status).toBe(400)
    expect((await errorDe(res)).codigo).toBe('fecha_futura')
    // Mañana sí se puede consultar (vacío): la planificación llega en el ciclo 7
    expect((await pedir('GET', ruta(manana), 'delegado')).status).toBe(200)
  })
})

describe('historial y resumen', () => {
  it('historial del más reciente al más antiguo, con recuentos', async () => {
    const res = await pedir('GET', `/plantillas/${ids.senior}/entrenos`, 'delegado')
    expect(await res.json()).toEqual([
      { fecha: DIA2, asiste: 2, justificada: 0, falta: 1 },
      { fecha: DIA1, asiste: 0, justificada: 1, falta: 0 },
    ])
  })

  it('resumen por jugador con porcentaje sobre los entrenos con estado registrado', async () => {
    const res = await pedir('GET', `/plantillas/${ids.senior}/asistencia/resumen`, 'delegado')
    expect(await res.json()).toEqual([
      expect.objectContaining({ nombre: 'Íker', asiste: 0, porcentaje: null }),
      expect.objectContaining({ nombre: 'Brais', asiste: 0, falta: 1, porcentaje: 0 }),
      expect.objectContaining({ nombre: 'Hugo', activo: false, asiste: 1, porcentaje: 100 }),
      expect.objectContaining({ nombre: 'Zoe', asiste: 1, justificada: 1, porcentaje: 50 }),
    ])
  })
})

describe('permisos', () => {
  it('solo delegado o superior pasa lista', async () => {
    expect((await pasarLista(DIA1, [], 'jugador')).status).toBe(403)
    expect((await pasarLista(DIA1, [], 'ajeno')).status).toBe(403)
    expect(
      (await pedir('PUT', `${ruta(DIA1)}/asistencias`, undefined, { asistencias: [] })).status,
    ).toBe(401)
  })

  it('sin acceso a la plantilla no se ve nada', async () => {
    for (const r of [ruta(DIA1), `/plantillas/${ids.senior}/entrenos`]) {
      expect((await pedir('GET', r, 'ajeno')).status).toBe(403)
    }
  })

  it('el rol jugador ve los recuentos, pero de los jugadores solo su fila', async () => {
    const historial = await pedir('GET', `/plantillas/${ids.senior}/entrenos`, 'jugador')
    expect((await historial.json()).length).toBe(2)

    // Sin jugador vinculado a su usuario, no recibe ninguna fila
    let entreno = await (await pedir('GET', ruta(DIA2), 'jugador')).json()
    expect(entreno.recuentos).toEqual({ asiste: 2, justificada: 0, falta: 1 })
    expect(entreno.jugadores).toEqual([])

    await db
      .update(jugadores)
      .set({ usuarioId: ids.jugador ?? '' })
      .where(eq(jugadores.id, ids.Zoe ?? ''))
    entreno = await (await pedir('GET', ruta(DIA2), 'jugador')).json()
    expect(filas(entreno)).toEqual([['Zoe', 'asiste']])

    const resumen = await (
      await pedir('GET', `/plantillas/${ids.senior}/asistencia/resumen`, 'jugador')
    ).json()
    expect(resumen).toEqual([expect.objectContaining({ nombre: 'Zoe', porcentaje: 50 })])
  })
})
