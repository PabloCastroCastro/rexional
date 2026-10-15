import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, jugadores, membresias, user } from '../src/db/schema/index.js'
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

// Fechas relativas a hoy en Madrid, como hace la API
const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
const dia = (n: number) =>
  new Date(Date.parse(`${HOY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const DIA1 = '2026-09-01'
const DIA2 = '2026-09-03'

const base = () => `/plantillas/${ids.senior}`
const TODOS_LOS_DIAS = (hora: string) => [1, 2, 3, 4, 5, 6, 7].map((d) => ({ dia: d, hora }))

type Resumen = {
  id: string
  fecha: string
  hora: string | null
  horaFin?: string | null
  deHorario: boolean
}

async function entrenosEntre(desde: string, hasta: string, quien = 'delegado') {
  const res = await pedir('GET', `${base()}/entrenos?desde=${desde}&hasta=${hasta}`, quien)
  return (await res.json()) as (Resumen & { asiste: number; justificada: number; falta: number })[]
}

async function crearEntreno(fecha: string, hora?: string) {
  const res = await pedir('POST', `${base()}/entrenos`, 'delegado', { fecha, hora })
  expect(res.status).toBe(201)
  return (await res.json()) as Resumen
}

const pasarLista = (entrenoId: string, lista: unknown[], quien = 'delegado') =>
  pedir('PUT', `${base()}/entrenos/${entrenoId}/asistencias`, quien, { asistencias: lista })

const errorDe = async (res: Response) => (await res.json()).error

const filas = (entreno: { jugadores: { nombre: string; estado: string | null }[] }) =>
  entreno.jugadores.map((j) => [j.nombre, j.estado])

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)

  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Entrenos' })).json()
  clubesCreados.push(club.id)
  for (const [clave, nombre] of [
    ['senior', 'Senior'],
    ['juvenil', 'Juvenil'],
  ] as const) {
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: club.id,
      nombre,
      categoria: 'sénior',
      temporada: '2026-27',
    })
    ids[clave] = (await res.json()).id
  }
  await db.insert(membresias).values([
    { plantillaId: ids.senior ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])

  // Senior: Íker (1, sin asistencias), Brais (7), Zoe (sin dorsal) y Hugo (10, de baja).
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

describe('horario', () => {
  it('sin horario devuelve null', async () => {
    const res = await pedir('GET', `${base()}/horario`, 'jugador')
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  it('guardarlo crea los entrenos desde hoy hasta «hasta», nunca en el pasado', async () => {
    const horario = { desde: dia(-7), hasta: dia(13), sesiones: TODOS_LOS_DIAS('20:00') }
    const res = await pedir('PUT', `${base()}/horario`, 'delegado', horario)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ horario, creados: 14, borrados: 0 })

    const entrenos = await entrenosEntre(dia(-7), dia(20))
    expect(entrenos).toHaveLength(14)
    expect(entrenos.at(-1)).toMatchObject({ fecha: HOY, hora: '20:00', deHorario: true })
    expect(await (await pedir('GET', `${base()}/horario`, 'jugador')).json()).toEqual(horario)
  })

  it('al cambiarlo rehace los entrenos futuros sin asistencia y conserva los que la tienen', async () => {
    const [hoy] = await entrenosEntre(HOY, HOY)
    await pasarLista(hoy?.id ?? '', [{ jugadorId: ids.Brais, estado: 'asiste' }])

    const res = await pedir('PUT', `${base()}/horario`, 'delegado', {
      desde: HOY,
      hasta: dia(13),
      sesiones: TODOS_LOS_DIAS('19:00'),
    })
    expect(await res.json()).toMatchObject({ creados: 14, borrados: 13 })
    // Hoy quedan el de las 20:00, que tiene asistencia, y el nuevo de las 19:00
    expect((await entrenosEntre(HOY, HOY)).map((e) => [e.hora, e.asiste])).toEqual([
      ['19:00', 0],
      ['20:00', 1],
    ])
  })

  it('valida el horario', async () => {
    for (const horario of [
      { desde: HOY, hasta: dia(-1), sesiones: TODOS_LOS_DIAS('20:00') },
      { desde: HOY, hasta: dia(400), sesiones: TODOS_LOS_DIAS('20:00') },
      { desde: HOY, hasta: dia(7), sesiones: [] },
      { desde: HOY, hasta: dia(7), sesiones: [{ dia: 8, hora: '20:00' }] },
      { desde: HOY, hasta: dia(7), sesiones: [{ dia: 2, hora: '25:00' }] },
      {
        desde: HOY,
        hasta: dia(7),
        sesiones: [
          { dia: 2, hora: '20:00' },
          { dia: 2, hora: '20:00' },
        ],
      },
    ]) {
      const res = await pedir('PUT', `${base()}/horario`, 'delegado', horario)
      expect(res.status).toBe(400)
    }
  })

  it('quitarlo borra sus entrenos futuros sin asistencia', async () => {
    const res = await pedir('DELETE', `${base()}/horario`, 'delegado')
    expect(await res.json()).toEqual({ borrados: 14 })
    expect(await (await pedir('GET', `${base()}/horario`, 'delegado')).json()).toBeNull()
    expect((await entrenosEntre(HOY, dia(20))).map((e) => e.hora)).toEqual(['20:00'])
  })
})

describe('entrenos sueltos', () => {
  it('se crea un entreno en un día sin entreno y otro a distinta hora (doble sesión)', async () => {
    const suelto = await crearEntreno(DIA1)
    expect(suelto).toMatchObject({ fecha: DIA1, hora: null, deHorario: false })
    ids.dia1 = suelto.id

    const res = await pedir('POST', `${base()}/entrenos`, 'delegado', { fecha: DIA1 })
    expect(res.status).toBe(409)
    expect((await errorDe(res)).codigo).toBe('entreno_duplicado')

    ids.dia1b = (await crearEntreno(DIA1, '18:30')).id
    expect((await entrenosEntre(DIA1, DIA1)).map((e) => e.hora)).toEqual([null, '18:30'])
  })

  it('valida la fecha y la hora', async () => {
    for (const cuerpo of [{ fecha: '2026-02-30' }, { fecha: DIA1, hora: '8:00' }, {}]) {
      expect((await pedir('POST', `${base()}/entrenos`, 'delegado', cuerpo)).status).toBe(400)
    }
  })

  it('cancelar un entreno lo borra con su asistencia', async () => {
    await pasarLista(ids.dia1b ?? '', [{ jugadorId: ids.Zoe, estado: 'asiste' }])
    expect((await pedir('DELETE', `${base()}/entrenos/${ids.dia1b}`, 'delegado')).status).toBe(204)
    expect((await pedir('GET', `${base()}/entrenos/${ids.dia1b}`, 'delegado')).status).toBe(404)
    expect((await pedir('DELETE', `${base()}/entrenos/${ids.dia1b}`, 'delegado')).status).toBe(404)
  })

  it('un entreno de otra plantilla no se encuentra', async () => {
    const res = await pedir('POST', `/plantillas/${ids.juvenil}/entrenos`, 'admin', { fecha: DIA1 })
    const ajeno = (await res.json()).id
    expect((await pedir('GET', `${base()}/entrenos/${ajeno}`, 'delegado')).status).toBe(404)
    expect((await pasarLista(ajeno, [])).status).toBe(404)
  })
})

describe('pasar lista', () => {
  it('un entreno sin lista devuelve los jugadores activos sin estado', async () => {
    const entreno = await (await pedir('GET', `${base()}/entrenos/${ids.dia1}`, 'delegado')).json()
    expect(entreno).toMatchObject({ id: ids.dia1, fecha: DIA1, recuentos: { asiste: 0 } })
    expect(filas(entreno)).toEqual([
      ['Íker', null],
      ['Brais', null],
      ['Zoe', null],
    ])
  })

  it('guarda la lista completa y la sustituye en cada guardado', async () => {
    let entreno = await (
      await pasarLista(ids.dia1 ?? '', [
        { jugadorId: ids.Brais, estado: 'asiste' },
        { jugadorId: ids.Zoe, estado: 'justificada', motivo: '  Trabajo  ' },
      ])
    ).json()
    expect(entreno.recuentos).toEqual({ asiste: 1, justificada: 1, falta: 0 })
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Zoe').motivo).toBe(
      'Trabajo',
    )

    entreno = await (
      await pasarLista(ids.dia1 ?? '', [{ jugadorId: ids.Zoe, estado: 'justificada', motivo: ' ' }])
    ).json()
    expect(filas(entreno)).toEqual([
      ['Íker', null],
      ['Brais', null],
      ['Zoe', 'justificada'],
    ])
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Zoe').motivo).toBeNull()
  })

  it('una lista vacía deja el entreno sin asistencia, pero en el calendario', async () => {
    const id = (await crearEntreno('2026-09-05')).id
    await pasarLista(id, [{ jugadorId: ids.Brais, estado: 'asiste' }])
    const res = await pasarLista(id, [])
    expect((await res.json()).recuentos).toEqual({ asiste: 0, justificada: 0, falta: 0 })
    expect(await entrenosEntre('2026-09-05', '2026-09-05')).toHaveLength(1)
    await pedir('DELETE', `${base()}/entrenos/${id}`, 'delegado')
  })

  it('un jugador de baja aparece solo en los entrenos en que tiene asistencia', async () => {
    ids.dia2 = (await crearEntreno(DIA2)).id
    const entreno = await (
      await pasarLista(ids.dia2, [
        { jugadorId: ids.Brais, estado: 'falta' },
        { jugadorId: ids.Zoe, estado: 'asiste' },
        { jugadorId: ids.Hugo, estado: 'asiste' },
      ])
    ).json()
    expect(entreno.jugadores.find((j: { nombre: string }) => j.nombre === 'Hugo')).toMatchObject({
      activo: false,
      estado: 'asiste',
    })
    const otro = await (await pedir('GET', `${base()}/entrenos/${ids.dia1}`, 'delegado')).json()
    expect(otro.jugadores.map((j: { nombre: string }) => j.nombre)).not.toContain('Hugo')
  })

  it('valida la lista y rechaza jugadores sin ficha', async () => {
    for (const lista of [
      [
        { jugadorId: ids.Brais, estado: 'asiste' },
        { jugadorId: ids.Brais, estado: 'falta' },
      ],
      [{ jugadorId: ids.Brais, estado: 'asiste', motivo: 'Trabajo' }],
      [{ jugadorId: ids.Brais, estado: 'tarde' }],
    ]) {
      expect((await pasarLista(ids.dia1 ?? '', lista)).status).toBe(400)
    }
    for (const jugadorId of [ids.Bruno, '00000000-0000-7000-8000-000000000000']) {
      const res = await pasarLista(ids.dia1 ?? '', [{ jugadorId, estado: 'asiste' }])
      expect((await errorDe(res)).codigo).toBe('jugador_sin_ficha')
    }
  })

  it('no se pasa lista de un entreno futuro, pero se puede consultar', async () => {
    const futuro = await crearEntreno(dia(1))
    const res = await pasarLista(futuro.id, [{ jugadorId: ids.Brais, estado: 'asiste' }])
    expect(res.status).toBe(400)
    expect((await errorDe(res)).codigo).toBe('fecha_futura')
    expect((await pedir('GET', `${base()}/entrenos/${futuro.id}`, 'delegado')).status).toBe(200)
    await pedir('DELETE', `${base()}/entrenos/${futuro.id}`, 'delegado')
  })
})

describe('historial y resumen', () => {
  it('lista los entrenos del más reciente al más antiguo, con recuentos', async () => {
    const lista = await entrenosEntre(DIA1, DIA2)
    expect(lista.map((e) => [e.fecha, e.asiste, e.justificada, e.falta])).toEqual([
      [DIA2, 2, 0, 1],
      [DIA1, 0, 1, 0],
    ])
  })

  it('resumen por jugador con porcentaje sobre los entrenos con estado registrado', async () => {
    const res = await pedir('GET', `${base()}/asistencia/resumen`, 'delegado')
    // Brais: asiste hoy (horario), falta el día 2; Zoe: justificada el día 1, asiste el día 2
    expect(await res.json()).toEqual([
      expect.objectContaining({ nombre: 'Íker', porcentaje: null }),
      expect.objectContaining({ nombre: 'Brais', asiste: 1, falta: 1, porcentaje: 50 }),
      expect.objectContaining({ nombre: 'Hugo', activo: false, porcentaje: 100 }),
      expect.objectContaining({ nombre: 'Zoe', asiste: 1, justificada: 1, porcentaje: 50 }),
    ])
  })
})

describe('permisos', () => {
  it('solo delegado o superior gestiona el calendario y pasa lista', async () => {
    const horario = { desde: HOY, hasta: dia(7), sesiones: TODOS_LOS_DIAS('20:00') }
    for (const [metodo, ruta, cuerpo] of [
      ['PUT', '/horario', horario],
      ['DELETE', '/horario', undefined],
      ['POST', '/entrenos', { fecha: DIA1, hora: '09:00' }],
      ['DELETE', `/entrenos/${ids.dia1}`, undefined],
      ['PUT', `/entrenos/${ids.dia1}/asistencias`, { asistencias: [] }],
    ] as const) {
      expect((await pedir(metodo, `${base()}${ruta}`, 'jugador', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, `${base()}${ruta}`, 'ajeno', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, `${base()}${ruta}`, undefined, cuerpo)).status).toBe(401)
    }
  })

  it('el rol jugador ve los recuentos, pero de los jugadores solo su fila', async () => {
    expect(await entrenosEntre(DIA1, DIA2, 'jugador')).toHaveLength(2)

    // Sin jugador vinculado a su usuario, no recibe ninguna fila
    let entreno = await (await pedir('GET', `${base()}/entrenos/${ids.dia2}`, 'jugador')).json()
    expect(entreno.recuentos).toEqual({ asiste: 2, justificada: 0, falta: 1 })
    expect(entreno.jugadores).toEqual([])

    await db
      .update(jugadores)
      .set({ usuarioId: ids.jugador ?? '' })
      .where(eq(jugadores.id, ids.Zoe ?? ''))
    entreno = await (await pedir('GET', `${base()}/entrenos/${ids.dia2}`, 'jugador')).json()
    expect(filas(entreno)).toEqual([['Zoe', 'asiste']])

    const resumen = await (await pedir('GET', `${base()}/asistencia/resumen`, 'jugador')).json()
    expect(resumen).toEqual([expect.objectContaining({ nombre: 'Zoe', porcentaje: 50 })])
  })
})

describe('hora de fin y cambiar la hora', () => {
  it('el horario lleva hora de fin a los entrenos que crea', async () => {
    const res = await pedir('PUT', `${base()}/horario`, 'delegado', {
      desde: dia(40),
      hasta: dia(46),
      sesiones: TODOS_LOS_DIAS('20:00').map((s) => ({ ...s, horaFin: '21:30' })),
    })
    expect(res.status).toBe(200)
    const creados = await entrenosEntre(dia(40), dia(46))
    expect(creados).toHaveLength(7)
    expect(creados.every((e) => e.hora === '20:00' && e.horaFin === '21:30')).toBe(true)
    // La lista va del más reciente al más antiguo: el último es el del día 40
    ids.delHorario = creados.at(-1)?.id ?? ''
  })

  it('valida la hora de fin del horario', async () => {
    const res = await pedir('PUT', `${base()}/horario`, 'delegado', {
      desde: dia(40),
      hasta: dia(46),
      sesiones: [{ dia: 2, hora: '20:00', horaFin: '19:00' }],
    })
    expect(res.status).toBe(400)
  })

  it('un entreno suelto puede llevar hora de fin, siempre después de la de inicio', async () => {
    let res = await pedir('POST', `${base()}/entrenos`, 'delegado', {
      fecha: dia(50),
      hora: '10:00',
      horaFin: '11:15',
    })
    expect(await res.json()).toMatchObject({ hora: '10:00', horaFin: '11:15' })
    for (const cuerpo of [
      { fecha: dia(51), hora: '10:00', horaFin: '09:00' },
      { fecha: dia(51), hora: '10:00', horaFin: '10:00' },
      { fecha: dia(51), horaFin: '11:00' },
    ]) {
      res = await pedir('POST', `${base()}/entrenos`, 'delegado', cuerpo)
      expect(res.status).toBe(400)
      expect((await res.json()).error.detalles).toEqual([
        expect.objectContaining({ campo: 'horaFin' }),
      ])
    }
  })

  it('se cambia la hora de un entreno y, si era del horario, pasa a suelto', async () => {
    const ruta = `${base()}/entrenos/${ids.delHorario}`
    const res = await pedir('PATCH', ruta, 'delegado', { hora: '18:30', horaFin: '20:00' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ hora: '18:30', horaFin: '20:00', deHorario: false })

    // Al volver a guardar el horario no se toca: se crea otro a la hora del horario
    await pedir('PUT', `${base()}/horario`, 'delegado', {
      desde: dia(40),
      hasta: dia(46),
      sesiones: TODOS_LOS_DIAS('20:00').map((s) => ({ ...s, horaFin: '21:30' })),
    })
    const ese = await entrenosEntre(dia(40), dia(40))
    expect(ese.map((e) => [e.hora, e.horaFin, e.deHorario])).toEqual([
      ['18:30', '20:00', false],
      ['20:00', '21:30', true],
    ])
  })

  it('valida el cambio de hora', async () => {
    const ruta = `${base()}/entrenos/${ids.delHorario}`
    // A la misma hora que el otro entreno de ese día
    let res = await pedir('PATCH', ruta, 'delegado', { hora: '20:00' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.codigo).toBe('entreno_duplicado')
    res = await pedir('PATCH', ruta, 'delegado', { hora: '18:30', horaFin: '18:00' })
    expect(res.status).toBe(400)
    // Quitar la hora quita también la de fin
    res = await pedir('PATCH', ruta, 'delegado', { hora: null })
    expect(await res.json()).toMatchObject({ hora: null, horaFin: null })
  })

  it('solo delegado o superior cambia la hora; un entreno de otra plantilla no se encuentra', async () => {
    const ruta = `${base()}/entrenos/${ids.delHorario}`
    expect((await pedir('PATCH', ruta, 'jugador', { hora: '17:00' })).status).toBe(403)
    expect((await pedir('PATCH', ruta, 'ajeno', { hora: '17:00' })).status).toBe(403)
    const otro = await pedir('POST', `/plantillas/${ids.juvenil}/entrenos`, 'admin', {
      fecha: dia(60),
    })
    const ajeno = (await otro.json()).id
    expect(
      (await pedir('PATCH', `${base()}/entrenos/${ajeno}`, 'delegado', { hora: '17:00' })).status,
    ).toBe(404)
  })
})
