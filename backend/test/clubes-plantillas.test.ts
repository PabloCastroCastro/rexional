import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  adminsClub,
  clubes,
  fichas,
  jugadores,
  membresias,
  plantillas,
  user,
} from '../src/db/schema/index.js'
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
  return u
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

async function crearClub(quien: string, nombre: string) {
  const res = await pedir('POST', '/clubes', quien, { nombre })
  const club = await res.json()
  clubesCreados.push(club.id)
  return club
}

async function crearPlantilla(quien: string, datos: Record<string, unknown>) {
  return pedir('POST', '/plantillas', quien, { categoria: 'sénior', ...datos })
}

beforeAll(async () => {
  await usuario('admin')
  await usuario('otro-admin')
  await usuario('entrenador')
  await usuario('jugador')
  await usuario('ajeno')
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('clubes', () => {
  it('crear un club hace al creador su administrador', async () => {
    const res = await pedir('POST', '/clubes', 'admin', { nombre: '  CD Prueba  ' })
    expect(res.status).toBe(201)
    const club = await res.json()
    clubesCreados.push(club.id)
    expect(club).toMatchObject({ nombre: 'CD Prueba', esAdmin: true, colorPrincipal: '#14553d' })
    ids.club = club.id
    const admins = await db.select().from(adminsClub).where(eq(adminsClub.clubId, club.id))
    expect(admins.map((a) => a.usuarioId)).toEqual([ids.admin])
  })

  it('crear un club exige sesión y un nombre', async () => {
    expect((await pedir('POST', '/clubes', undefined, { nombre: 'X' })).status).toBe(401)
    const res = await pedir('POST', '/clubes', 'admin', { nombre: '   ' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.detalles[0].campo).toBe('nombre')
  })

  it('mis clubes incluye los que administro aunque no tengan plantillas', async () => {
    const res = await pedir('GET', '/clubes', 'admin')
    const lista = await res.json()
    expect(lista).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: ids.club, esAdmin: true })]),
    )
    expect(await (await pedir('GET', '/clubes', 'ajeno')).json()).toEqual([])
  })

  it('solo los administradores cambian el nombre del club', async () => {
    const res = await pedir('PATCH', `/clubes/${ids.club}`, 'admin', {
      nombre: ' CD Prueba Renombrado ',
    })
    expect(res.status).toBe(200)
    expect((await res.json()).nombre).toBe('CD Prueba Renombrado')
    expect((await pedir('PATCH', `/clubes/${ids.club}`, 'ajeno', { nombre: 'X' })).status).toBe(403)
    expect((await pedir('PATCH', `/clubes/${ids.club}`, 'admin', { nombre: '' })).status).toBe(400)
    // Solo el nombre: los colores llegan con su propia validación en el ciclo 5
    expect(
      (await pedir('PATCH', `/clubes/${ids.club}`, 'admin', { colorPrincipal: '#000000' })).status,
    ).toBe(400)
    await pedir('PATCH', `/clubes/${ids.club}`, 'admin', { nombre: 'CD Prueba' })
  })

  it('el detalle del club es para quien tiene acceso', async () => {
    expect((await pedir('GET', `/clubes/${ids.club}`, 'admin')).status).toBe(200)
    expect((await pedir('GET', `/clubes/${ids.club}`, 'ajeno')).status).toBe(403)
  })
})

describe('administradores del club', () => {
  it('añadir un usuario existente por email', async () => {
    const otro = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, ids['otro-admin'] ?? ''))
    const res = await pedir('POST', `/clubes/${ids.club}/admins`, 'admin', {
      email: otro[0]?.email.toUpperCase(),
    })
    expect(res.status).toBe(201)
    expect((await res.json()).usuarioId).toBe(ids['otro-admin'])
    const lista = await (await pedir('GET', `/clubes/${ids.club}/admins`, 'admin')).json()
    expect(lista).toHaveLength(2)
  })

  it('un email desconocido: 404; un administrador repetido: 409', async () => {
    const desconocido = await pedir('POST', `/clubes/${ids.club}/admins`, 'admin', {
      email: 'nadie@prueba.test',
    })
    expect(desconocido.status).toBe(404)
    expect((await desconocido.json()).error.codigo).toBe('usuario_no_encontrado')
    const [otro] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, ids['otro-admin'] ?? ''))
    const repetido = await pedir('POST', `/clubes/${ids.club}/admins`, 'admin', {
      email: otro?.email,
    })
    expect(repetido.status).toBe(409)
  })

  it('solo los administradores del club los gestionan', async () => {
    expect((await pedir('GET', `/clubes/${ids.club}/admins`, 'ajeno')).status).toBe(403)
    expect((await pedir('DELETE', `/clubes/${ids.club}/admins/${ids.admin}`, 'ajeno')).status).toBe(
      403,
    )
  })

  it('retirar administradores, pero nunca el último', async () => {
    expect(
      (await pedir('DELETE', `/clubes/${ids.club}/admins/${ids['otro-admin']}`, 'admin')).status,
    ).toBe(204)
    const res = await pedir('DELETE', `/clubes/${ids.club}/admins/${ids.admin}`, 'admin')
    expect(res.status).toBe(409)
    expect((await res.json()).error.codigo).toBe('ultimo_administrador')
    expect((await pedir('DELETE', `/clubes/${ids.club}/admins/${ids.ajeno}`, 'admin')).status).toBe(
      404,
    )
  })
})

describe('crear plantillas', () => {
  it('el administrador del club crea una plantilla', async () => {
    const res = await crearPlantilla('admin', {
      clubId: ids.club,
      nombre: 'Senior',
      temporada: '2025-26',
    })
    expect(res.status).toBe(201)
    const plantilla = await res.json()
    expect(plantilla).toMatchObject({
      nombre: 'Senior',
      temporada: '2025-26',
      rol: 'admin',
      esAdminClub: true,
    })
    ids.senior25 = plantilla.id
  })

  it('la de la temporada siguiente enlaza con su plantilla anterior', async () => {
    const res = await crearPlantilla('admin', {
      clubId: ids.club,
      nombre: 'Senior',
      temporada: '2026-27',
      plantillaAnteriorId: ids.senior25,
    })
    expect(res.status).toBe(201)
    const plantilla = await res.json()
    expect(plantilla.plantillaAnteriorId).toBe(ids.senior25)
    ids.senior26 = plantilla.id
    const juvenil = await (
      await crearPlantilla('admin', {
        clubId: ids.club,
        nombre: 'Juvenil',
        temporada: '2026-27',
        categoria: 'juvenil',
      })
    ).json()
    ids.juvenil26 = juvenil.id
  })

  it('rechaza un nombre repetido en la temporada', async () => {
    const res = await crearPlantilla('admin', {
      clubId: ids.club,
      nombre: 'Senior',
      temporada: '2026-27',
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.codigo).toBe('plantilla_duplicada')
  })

  it('rechaza una plantilla anterior de otra temporada posterior o de otro club', async () => {
    const posterior = await crearPlantilla('admin', {
      clubId: ids.club,
      nombre: 'Veteranos',
      temporada: '2025-26',
      plantillaAnteriorId: ids.senior26,
    })
    expect(posterior.status).toBe(400)
    expect((await posterior.json()).error.codigo).toBe('plantilla_anterior_no_valida')

    const otroClub = await crearClub('ajeno', 'Otro club')
    const deOtroClub = await crearPlantilla('ajeno', {
      clubId: otroClub.id,
      nombre: 'Senior',
      temporada: '2027-28',
      plantillaAnteriorId: ids.senior26,
    })
    expect(deOtroClub.status).toBe(400)
  })

  it.each([
    ['2026-28', 'consecutivos'],
    ['2026/27', 'AAAA-AA'],
  ])('rechaza la temporada %s', async (temporada, texto) => {
    const res = await crearPlantilla('admin', { clubId: ids.club, nombre: 'X', temporada })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain(texto)
  })

  it('solo los administradores del club crean plantillas; club inexistente: 404', async () => {
    const res = await crearPlantilla('ajeno', {
      clubId: ids.club,
      nombre: 'Cadete',
      temporada: '2026-27',
    })
    expect(res.status).toBe(403)
    const inexistente = await crearPlantilla('admin', {
      clubId: '00000000-0000-7000-8000-000000000000',
      nombre: 'Cadete',
      temporada: '2026-27',
    })
    expect(inexistente.status).toBe(404)
  })
})

describe('mis plantillas', () => {
  beforeAll(async () => {
    // El entrenador lo es del Senior 2026-27; el jugador, del Juvenil 2026-27
    await db.insert(membresias).values([
      { plantillaId: ids.senior26 ?? '', usuarioId: ids.entrenador ?? '', rol: 'entrenador' },
      { plantillaId: ids.juvenil26 ?? '', usuarioId: ids.jugador ?? '', rol: 'jugador' },
    ])
  })

  it('el administrador del club ve todas, ordenadas por temporada (la más reciente primero) y nombre', async () => {
    const lista = await (await pedir('GET', `/plantillas?club=${ids.club}`, 'admin')).json()
    expect(
      lista.map((p: { nombre: string; temporada: string }) => `${p.nombre} ${p.temporada}`),
    ).toEqual(['Juvenil 2026-27', 'Senior 2026-27', 'Senior 2025-26'])
    expect(
      lista.every((p: { rol: string; esAdminClub: boolean }) => p.rol === 'admin' && p.esAdminClub),
    ).toBe(true)
    expect(lista[0].club).toMatchObject({ id: ids.club, nombre: 'CD Prueba' })
  })

  it('cada miembro ve solo las suyas, con su rol', async () => {
    const delEntrenador = await (await pedir('GET', '/plantillas', 'entrenador')).json()
    expect(delEntrenador.map((p: { id: string; rol: string }) => [p.id, p.rol])).toEqual([
      [ids.senior26, 'entrenador'],
    ])
    const delJugador = await (await pedir('GET', `/plantillas?club=${ids.club}`, 'jugador')).json()
    expect(delJugador.map((p: { id: string }) => p.id)).toEqual([ids.juvenil26])
  })

  it('sin sesión: 401; un club mal escrito: 400', async () => {
    expect((await pedir('GET', '/plantillas')).status).toBe(401)
    expect((await pedir('GET', '/plantillas?club=otro', 'admin')).status).toBe(400)
  })
})

describe('ver, editar y borrar una plantilla', () => {
  it('cualquier miembro la ve; un ajeno no', async () => {
    const res = await pedir('GET', `/plantillas/${ids.senior26}`, 'entrenador')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      nombre: 'Senior',
      temporada: '2026-27',
      rol: 'entrenador',
    })
    expect((await pedir('GET', `/plantillas/${ids.senior26}`, 'jugador')).status).toBe(403)
  })

  it('el entrenador cambia el nombre y la categoría, pero no la temporada', async () => {
    const res = await pedir('PATCH', `/plantillas/${ids.senior26}`, 'entrenador', {
      nombre: 'Senior A',
      categoria: 'sénior A',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      nombre: 'Senior A',
      categoria: 'sénior A',
      temporada: '2026-27',
    })
    const conTemporada = await pedir('PATCH', `/plantillas/${ids.senior26}`, 'entrenador', {
      temporada: '2027-28',
    })
    expect(conTemporada.status).toBe(400)
    expect((await pedir('PATCH', `/plantillas/${ids.senior26}`, 'entrenador', {})).status).toBe(400)
  })

  it('un jugador no la edita; un nombre repetido: 409', async () => {
    expect(
      (await pedir('PATCH', `/plantillas/${ids.juvenil26}`, 'jugador', { nombre: 'X' })).status,
    ).toBe(403)
    const repetido = await pedir('PATCH', `/plantillas/${ids.juvenil26}`, 'admin', {
      nombre: 'Senior A',
    })
    expect(repetido.status).toBe(409)
  })

  it('borrar exige ser administrador del club y escribir su nombre', async () => {
    // Una ficha y un jugador para comprobar que el jugador sigue en el club
    const [jugador] = await db
      .insert(jugadores)
      .values({ clubId: ids.club ?? '', nombre: 'Brais' })
      .returning()
    await db.insert(fichas).values({
      plantillaId: ids.senior25 ?? '',
      jugadorId: jugador?.id ?? '',
      clubId: ids.club ?? '',
      temporada: '2025-26',
      dorsal: 7,
    })

    expect(
      (
        await pedir('DELETE', `/plantillas/${ids.senior25}`, 'entrenador', {
          confirmacion: 'Senior',
        })
      ).status,
    ).toBe(403)
    const mal = await pedir('DELETE', `/plantillas/${ids.senior25}`, 'admin', {
      confirmacion: 'senior',
    })
    expect(mal.status).toBe(400)
    expect((await mal.json()).error.codigo).toBe('confirmacion_incorrecta')

    expect(
      (await pedir('DELETE', `/plantillas/${ids.senior25}`, 'admin', { confirmacion: 'Senior' }))
        .status,
    ).toBe(204)
    expect(await db.$count(plantillas, eq(plantillas.id, ids.senior25 ?? ''))).toBe(0)
    expect(await db.$count(fichas, eq(fichas.plantillaId, ids.senior25 ?? ''))).toBe(0)
    expect(await db.$count(jugadores, eq(jugadores.id, jugador?.id ?? ''))).toBe(1)
    // La siguiente pierde el enlace con la borrada
    const [siguiente] = await db
      .select()
      .from(plantillas)
      .where(eq(plantillas.id, ids.senior26 ?? ''))
    expect(siguiente?.plantillaAnteriorId).toBeNull()
  })
})
