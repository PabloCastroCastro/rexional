import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, membresias, user } from '../src/db/schema/index.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Fichas de invitado (GH-187): jugadores de otras plantillas del club, o de fuera, que juegan con
// una plantilla sin dejar la suya

const app = crearApp()
const usuarios: string[] = []
const clubesCreados: string[] = []
const cookies: Record<string, string> = {}
const ids: Record<string, string> = {}

type Jugador = {
  jugadorId: string
  nombre: string
  dorsal: number | null
  activo: boolean
  tipo: 'propia' | 'invitado'
  enDinamica: boolean
  procedencia: string | null
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

async function crearPlantilla(clubId: string, nombre: string, temporada = '2026-27') {
  const res = await pedir('POST', '/plantillas', 'admin', {
    clubId,
    nombre,
    categoria: 'sénior',
    temporada,
  })
  return (await res.json()).id as string
}

async function alta(plantilla: string | undefined, cuerpo: Record<string, unknown>, estado = 201) {
  const res = await pedir('POST', `/plantillas/${plantilla}/jugadores`, 'delegado', cuerpo)
  const datos = await res.json()
  expect(res.status, JSON.stringify(datos)).toBe(estado)
  return datos
}

const editar = (
  plantilla: string | undefined,
  jugadorId: string | undefined,
  cuerpo: Record<string, unknown>,
) => pedir('PATCH', `/plantillas/${plantilla}/jugadores/${jugadorId}`, 'delegado', cuerpo)

async function lista(plantilla: string | undefined, activos = true) {
  const res = await pedir(
    'GET',
    `/plantillas/${plantilla}/jugadores?activos=${activos}`,
    'delegado',
  )
  return (await res.json()) as Jugador[]
}

const deLista = async (plantilla: string | undefined, jugadorId: string | undefined) =>
  (await lista(plantilla)).find((j) => j.jugadorId === jugadorId)

beforeAll(async () => {
  await usuario('admin')
  await usuario('delegado')
  await usuario('jugador')

  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Invitados' })).json()
  clubesCreados.push(club.id)
  const otro = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Ajeno' })).json()
  clubesCreados.push(otro.id)
  ids.club = club.id
  ids.senior = await crearPlantilla(club.id, 'Senior')
  ids.juvenil = await crearPlantilla(club.id, 'Juvenil A')
  ids.equipoB = await crearPlantilla(club.id, 'Senior B')
  ids.anterior = await crearPlantilla(club.id, 'Juvenil A', '2025-26')
  ids.ajena = await crearPlantilla(otro.id, 'Senior')

  await db.insert(membresias).values(
    [ids.senior, ids.juvenil, ids.equipoB, ids.anterior, ids.ajena].map((plantillaId) => ({
      plantillaId: plantillaId ?? '',
      usuarioId: ids.delegado ?? '',
      rol: 'delegado' as const,
    })),
  )
  await db
    .insert(membresias)
    .values({ plantillaId: ids.senior, usuarioId: ids.jugador ?? '', rol: 'jugador' })

  ids.brais = (await alta(ids.senior, { nombre: 'Brais', dorsal: 7 })).jugadorId
  ids.mateo = (await alta(ids.juvenil, { nombre: 'Mateo', dorsal: 9 })).jugadorId
  ids.iago = (await alta(ids.juvenil, { nombre: 'Iago', dorsal: 4 })).jugadorId
  ids.xoel = (await alta(ids.equipoB, { nombre: 'Xoel' })).jugadorId
  ids.bajaJuvenil = (await alta(ids.juvenil, { nombre: 'Uxío' })).jugadorId
  await editar(ids.juvenil, ids.bajaJuvenil, { activo: false })
  // Del club, pero sin ficha esta temporada
  ids.antiguo = (await alta(ids.anterior, { nombre: 'Antón' })).jugadorId
  ids.ajeno = (await alta(ids.ajena, { nombre: 'Foráneo' })).jugadorId
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('alta de invitados', () => {
  it('las fichas de siempre son propias y en la dinámica', async () => {
    expect(await deLista(ids.senior, ids.brais)).toMatchObject({
      tipo: 'propia',
      enDinamica: true,
      procedencia: null,
    })
  })

  it('invitado de otra plantilla del club: su procedencia es esa plantilla', async () => {
    const mateo = await alta(ids.senior, { invitado: true, jugadorId: ids.mateo, dorsal: 7 })
    expect(mateo).toMatchObject({
      nombre: 'Mateo',
      tipo: 'invitado',
      enDinamica: false,
      procedencia: 'Juvenil A',
      // El dorsal de un invitado puede coincidir con el de un jugador propio
      dorsal: 7,
    })
    // Sigue en su plantilla, igual que antes
    expect(await deLista(ids.juvenil, ids.mateo)).toMatchObject({ tipo: 'propia', dorsal: 9 })
  })

  it('la procedencia de un jugador con ficha propia no se guarda aunque se envíe', async () => {
    const xoel = await alta(ids.senior, {
      invitado: true,
      jugadorId: ids.xoel,
      procedencia: 'Otra cosa',
      enDinamica: true,
    })
    expect(xoel).toMatchObject({ procedencia: 'Senior B', enDinamica: true })
  })

  it('alta rápida de alguien de fuera, con la procedencia en texto', async () => {
    const nuevo = await alta(ids.senior, {
      invitado: true,
      nombre: 'Hugo',
      apellidos: 'Pazos',
      procedencia: '  A prueba  ',
    })
    expect(nuevo).toMatchObject({ tipo: 'invitado', enDinamica: false, procedencia: 'A prueba' })
    ids.hugo = nuevo.jugadorId
    // Sin procedencia no se da de alta a alguien de fuera
    await alta(ids.senior, { invitado: true, nombre: 'Sin origen' }, 400)
  })

  it('del club sin ficha esta temporada: hace falta la procedencia', async () => {
    const error = await alta(ids.senior, { invitado: true, jugadorId: ids.antiguo }, 400)
    expect(error.error.detalles?.[0]?.campo).toBe('procedencia')
    const anton = await alta(ids.senior, {
      invitado: true,
      jugadorId: ids.antiguo,
      procedencia: 'Club asociado: CD Mar',
    })
    expect(anton.procedencia).toBe('Club asociado: CD Mar')
  })

  it('no se invita a quien ya está en la plantilla ni a un jugador de otro club', async () => {
    const repetido = await alta(ids.senior, { invitado: true, jugadorId: ids.mateo }, 409)
    expect(repetido.error.mensaje).toContain('como invitado')
    await alta(ids.senior, { invitado: true, jugadorId: ids.brais }, 409)
    await alta(ids.senior, { invitado: true, jugadorId: ids.ajeno }, 404)
  })

  it('una sola ficha propia por temporada; las de invitado no cuentan', async () => {
    // Mateo es propio del Juvenil A: no puede serlo también del B
    const error = await alta(ids.equipoB, { jugadorId: ids.mateo }, 409)
    expect(error.error.mensaje).toContain('Juvenil A')
    // Pero sí invitado en varias plantillas
    await alta(ids.equipoB, { invitado: true, jugadorId: ids.mateo })
    // Y quien solo es invitado puede tener ficha propia en otra plantilla
    const hugo = await alta(ids.juvenil, { jugadorId: ids.hugo })
    expect(hugo.tipo).toBe('propia')
    // Desde entonces, su procedencia en el Senior es esa plantilla
    expect((await deLista(ids.senior, ids.hugo))?.procedencia).toBe('Juvenil A')
  })

  it('en la lista, los invitados van detrás de los propios', async () => {
    const senior = await lista(ids.senior)
    const ultimoPropio = senior.findLastIndex((j) => j.tipo === 'propia')
    const primerInvitado = senior.findIndex((j) => j.tipo === 'invitado')
    expect(ultimoPropio).toBeLessThan(primerInvitado)
  })
})

describe('editar invitados', () => {
  it('encender y apagar la dinámica del equipo y cambiar la procedencia', async () => {
    let res = await editar(ids.senior, ids.antiguo, { enDinamica: true, procedencia: 'A prueba' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ enDinamica: true, procedencia: 'A prueba' })
    res = await editar(ids.senior, ids.antiguo, { enDinamica: false })
    expect((await res.json()).enDinamica).toBe(false)
  })

  it('las fichas propias no tienen dinámica ni procedencia que cambiar', async () => {
    for (const cuerpo of [{ enDinamica: false }, { procedencia: 'X' }]) {
      const res = await editar(ids.senior, ids.brais, cuerpo)
      expect(res.status).toBe(400)
    }
  })

  it('baja y reactivación del invitado, con su dorsal aunque esté repetido', async () => {
    let res = await editar(ids.senior, ids.mateo, { activo: false })
    expect((await res.json()).activo).toBe(false)
    expect((await lista(ids.senior, false)).map((j) => j.jugadorId)).toContain(ids.mateo)
    res = await editar(ids.senior, ids.mateo, { activo: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ activo: true, dorsal: 7 })
  })
})

describe('buscar jugadores para invitar', () => {
  it('los de las otras plantillas del club en la temporada, sin los que ya están', async () => {
    const res = await pedir('GET', `/plantillas/${ids.senior}/invitables`, 'delegado')
    expect(res.status).toBe(200)
    const filas = (await res.json()) as { jugadorId: string; nombre: string; plantilla: string }[]
    // Mateo, Xoel y Hugo ya están; Uxío está de baja; Antón no tiene ficha esta temporada
    expect(filas).toEqual([
      { jugadorId: ids.iago, nombre: 'Iago', apellidos: null, plantilla: 'Juvenil A' },
    ])
  })

  it('busca por nombre', async () => {
    const res = await pedir('GET', `/plantillas/${ids.equipoB}/invitables?q=iag`, 'delegado')
    expect((await res.json()).map((j: { nombre: string }) => j.nombre)).toEqual(['Iago'])
  })

  it('delegado o superior', async () => {
    const res = await pedir('GET', `/plantillas/${ids.senior}/invitables`, 'jugador')
    expect(res.status).toBe(403)
  })
})

describe('convocar a jugadores de otras plantillas', () => {
  it('se les crea la ficha de invitado, solo para partidos', async () => {
    const partido = await (
      await pedir('POST', `/plantillas/${ids.senior}/partidos`, 'delegado', {
        rival: 'SD Rival',
        fecha: '2026-11-15',
      })
    ).json()
    ids.partido = partido.id
    const res = await pedir(
      'PUT',
      `/plantillas/${ids.senior}/partidos/${partido.id}/convocados`,
      'delegado',
      {
        jugadores: [ids.brais, ids.iago],
      },
    )
    const detalle = await res.json()
    expect(res.status, JSON.stringify(detalle)).toBe(200)
    const iago = detalle.jugadores.find((j: { jugadorId: string }) => j.jugadorId === ids.iago)
    expect(iago).toMatchObject({ convocado: true, tipo: 'invitado', procedencia: 'Juvenil A' })
    expect(await deLista(ids.senior, ids.iago)).toMatchObject({
      tipo: 'invitado',
      enDinamica: false,
    })
  })

  it('no se convoca a quien no tiene ficha activa en el club esta temporada', async () => {
    for (const jugador of [ids.bajaJuvenil, ids.ajeno]) {
      const res = await pedir(
        'PUT',
        `/plantillas/${ids.senior}/partidos/${ids.partido}/convocados`,
        'delegado',
        { jugadores: [ids.brais, jugador] },
      )
      expect(res.status).toBe(400)
    }
    const [ficha] = await db
      .select()
      .from(fichas)
      .where(
        and(eq(fichas.plantillaId, ids.senior ?? ''), eq(fichas.jugadorId, ids.bajaJuvenil ?? '')),
      )
    expect(ficha).toBeUndefined()
  })
})

describe('entrenos y multas', () => {
  it('la lista del entreno solo lleva a los invitados en la dinámica', async () => {
    const entreno = await (
      await pedir('POST', `/plantillas/${ids.senior}/entrenos`, 'delegado', { fecha: '2026-11-02' })
    ).json()
    ids.entreno = entreno.id
    const detalle = await (
      await pedir('GET', `/plantillas/${ids.senior}/entrenos/${entreno.id}`, 'delegado')
    ).json()
    const enLista = detalle.jugadores.map((j: { jugadorId: string }) => j.jugadorId)
    // Xoel está en la dinámica; Mateo, Iago y Antón, solo para partidos
    expect(enLista).toContain(ids.xoel)
    expect(enLista).toContain(ids.brais)
    expect(enLista).not.toContain(ids.mateo)
    expect(enLista).not.toContain(ids.iago)
  })

  it('no se pasa lista a un invitado solo para partidos', async () => {
    const res = await pedir(
      'PUT',
      `/plantillas/${ids.senior}/entrenos/${ids.entreno}/asistencias`,
      'delegado',
      {
        asistencias: [{ jugadorId: ids.mateo, estado: 'asiste' }],
      },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error.codigo).toBe('fuera_de_dinamica')
  })

  it('no se multa a un invitado solo para partidos', async () => {
    const res = await pedir('POST', `/plantillas/${ids.senior}/multas`, 'delegado', {
      jugadorId: ids.mateo,
      motivo: 'Llegar tarde',
      importeCentimos: 200,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.codigo).toBe('fuera_de_dinamica')
  })

  it('al apagar la dinámica se conservan sus asistencias y multas', async () => {
    let res = await pedir(
      'PUT',
      `/plantillas/${ids.senior}/entrenos/${ids.entreno}/asistencias`,
      'delegado',
      {
        asistencias: [{ jugadorId: ids.xoel, estado: 'asiste' }],
      },
    )
    expect(res.status).toBe(200)
    res = await pedir('POST', `/plantillas/${ids.senior}/multas`, 'delegado', {
      jugadorId: ids.xoel,
      motivo: 'Llegar tarde',
      importeCentimos: 200,
    })
    expect(res.status).toBe(201)

    await editar(ids.senior, ids.xoel, { enDinamica: false })

    const detalle = await (
      await pedir('GET', `/plantillas/${ids.senior}/entrenos/${ids.entreno}`, 'delegado')
    ).json()
    expect(
      detalle.jugadores.find((j: { jugadorId: string }) => j.jugadorId === ids.xoel),
    ).toMatchObject({
      estado: 'asiste',
      tipo: 'invitado',
    })
    // Su asistencia se puede volver a guardar con el resto de la lista
    res = await pedir(
      'PUT',
      `/plantillas/${ids.senior}/entrenos/${ids.entreno}/asistencias`,
      'delegado',
      {
        asistencias: [
          { jugadorId: ids.xoel, estado: 'asiste' },
          { jugadorId: ids.brais, estado: 'falta' },
        ],
      },
    )
    expect(res.status).toBe(200)

    const resumen = await (
      await pedir('GET', `/plantillas/${ids.senior}/asistencia/resumen`, 'delegado')
    ).json()
    const enResumen = resumen.map((j: { jugadorId: string }) => j.jugadorId)
    expect(enResumen).toContain(ids.xoel)
    expect(enResumen).not.toContain(ids.mateo)

    const multas = await (await pedir('GET', `/plantillas/${ids.senior}/multas`, 'delegado')).json()
    expect(multas.map((m: { jugadorId: string }) => m.jugadorId)).toContain(ids.xoel)
    // Y se le pueden cobrar
    res = await pedir(
      'POST',
      `/plantillas/${ids.senior}/jugadores/${ids.xoel}/saldar`,
      'delegado',
      {},
    )
    expect(res.status).toBe(200)
    expect((await res.json()).cobradas).toBe(1)
  })
})
