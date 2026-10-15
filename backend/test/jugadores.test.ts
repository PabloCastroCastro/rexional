import { and, eq, inArray, like } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, jugadores, membresias, user } from '../src/db/schema/index.js'
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

async function crearClub(nombre: string) {
  const club = await (await pedir('POST', '/clubes', 'admin', { nombre })).json()
  clubesCreados.push(club.id)
  return club.id as string
}

async function crearPlantilla(clubId: string, nombre: string, temporada: string) {
  const res = await pedir('POST', '/plantillas', 'admin', {
    clubId,
    nombre,
    categoria: 'sénior',
    temporada,
  })
  return (await res.json()).id as string
}

async function alta(plantilla: string, cuerpo: Record<string, unknown>) {
  const res = await pedir('POST', `/plantillas/${plantilla}/jugadores`, 'delegado', cuerpo)
  expect(res.status).toBe(201)
  return res.json()
}

const nombres = (lista: { nombre: string }[]) => lista.map((j) => j.nombre)

beforeAll(async () => {
  await usuario('admin')
  await usuario('delegado')
  await usuario('jugador')
  await usuario('ajeno')

  ids.club = await crearClub('CD Jugadores')
  ids.otroClub = await crearClub('CD Vecino')
  ids.senior = await crearPlantilla(ids.club, 'Senior', '2026-27')
  ids.juvenil = await crearPlantilla(ids.club, 'Juvenil', '2026-27')
  ids.seniorAnterior = await crearPlantilla(ids.club, 'Senior', '2025-26')
  ids.vecino = await crearPlantilla(ids.otroClub, 'Senior', '2026-27')

  await db.insert(membresias).values([
    { plantillaId: ids.senior, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.juvenil, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.seniorAnterior, usuarioId: ids.delegado ?? '', rol: 'delegado' },
    { plantillaId: ids.senior, usuarioId: ids.jugador ?? '', rol: 'jugador' },
  ])
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('jugadores de la plantilla', () => {
  it('alta de un jugador nuevo en el club con su ficha', async () => {
    const jugador = await alta(ids.senior ?? '', {
      nombre: '  Brais  ',
      dorsal: 7,
      posicion: 'delantero',
    })
    expect(jugador).toMatchObject({
      nombre: 'Brais',
      dorsal: 7,
      posicion: 'delantero',
      activo: true,
    })
    ids.brais = jugador.jugadorId
    const [enBd] = await db.select().from(jugadores).where(eq(jugadores.id, jugador.jugadorId))
    expect(enBd?.clubId).toBe(ids.club)
  })

  it('dorsal y posición son opcionales', async () => {
    const jugador = await alta(ids.senior ?? '', { nombre: 'Zoe' })
    expect(jugador).toMatchObject({ dorsal: null, posicion: null })
    ids.zoe = jugador.jugadorId
  })

  it('lista ordenada por dorsal, sin dorsal al final, y por nombre en español', async () => {
    await alta(ids.senior ?? '', { nombre: 'álvaro' })
    await alta(ids.senior ?? '', { nombre: 'Íker', dorsal: 1 })
    const res = await pedir('GET', `/plantillas/${ids.senior}/jugadores`, 'jugador')
    expect(res.status).toBe(200)
    expect(nombres(await res.json())).toEqual(['Íker', 'Brais', 'álvaro', 'Zoe'])
  })

  it('error claro si el dorsal ya está en uso por un jugador activo', async () => {
    const res = await pedir('POST', `/plantillas/${ids.senior}/jugadores`, 'delegado', {
      nombre: 'Bruno',
      dorsal: 7,
    })
    expect(res.status).toBe(409)
    const { error } = await res.json()
    expect(error).toMatchObject({
      codigo: 'dorsal_en_uso',
      mensaje: 'El dorsal 7 ya lo lleva Brais',
      detalles: [{ campo: 'dorsal' }],
    })
    // La transacción se deshace: no queda un jugador suelto en el club
    const sueltos = await db
      .select()
      .from(jugadores)
      .where(and(eq(jugadores.clubId, ids.club ?? ''), eq(jugadores.nombre, 'Bruno')))
    expect(sueltos).toEqual([])
  })

  it('el mismo dorsal sirve en otra plantilla', async () => {
    const jugador = await alta(ids.juvenil ?? '', { nombre: 'Hugo', dorsal: 7 })
    ids.hugo = jugador.jugadorId
  })

  it('valida los datos del alta', async () => {
    const ruta = `/plantillas/${ids.senior}/jugadores`
    for (const cuerpo of [
      { nombre: '' },
      { nombre: 'X', dorsal: 100 },
      { nombre: 'X', dorsal: 1.5 },
      { nombre: 'X', posicion: 'líbero' },
      { nombre: 'X', jugadorId: ids.brais },
      {},
    ]) {
      expect((await pedir('POST', ruta, 'delegado', cuerpo)).status).toBe(400)
    }
  })

  it('añadir un jugador existente del club en otra temporada', async () => {
    const res = await pedir('POST', `/plantillas/${ids.seniorAnterior}/jugadores`, 'delegado', {
      jugadorId: ids.brais,
      dorsal: 9,
      posicion: 'centrocampista',
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ jugadorId: ids.brais, nombre: 'Brais', dorsal: 9 })
  })

  it('un jugador tiene como máximo una ficha por temporada', async () => {
    let res = await pedir('POST', `/plantillas/${ids.juvenil}/jugadores`, 'delegado', {
      jugadorId: ids.brais,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatchObject({
      codigo: 'ficha_en_temporada',
      mensaje: 'Brais ya tiene ficha en Senior en la temporada 2026-27',
    })

    res = await pedir('POST', `/plantillas/${ids.senior}/jugadores`, 'delegado', {
      jugadorId: ids.brais,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.mensaje).toBe('Brais ya está en esta plantilla')
  })

  it('no se puede añadir un jugador de otro club', async () => {
    const [ajeno] = await db
      .insert(jugadores)
      .values({ clubId: ids.otroClub ?? '', nombre: 'De fuera' })
      .returning()
    const res = await pedir('POST', `/plantillas/${ids.senior}/jugadores`, 'delegado', {
      jugadorId: ajeno?.id,
    })
    expect(res.status).toBe(404)
  })

  it('editar el nombre del jugador y los datos de su ficha', async () => {
    const res = await pedir(
      'PATCH',
      `/plantillas/${ids.senior}/jugadores/${ids.brais}`,
      'delegado',
      {
        nombre: 'Brais Méndez',
        dorsal: 10,
        posicion: 'centrocampista',
      },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      nombre: 'Brais Méndez',
      dorsal: 10,
      posicion: 'centrocampista',
    })
    // El nombre es del jugador: también cambia en la otra temporada; la ficha de allí no
    const anterior = await (
      await pedir('GET', `/plantillas/${ids.seniorAnterior}/jugadores`, 'delegado')
    ).json()
    expect(anterior).toEqual([expect.objectContaining({ nombre: 'Brais Méndez', dorsal: 9 })])
  })

  it('quitar el dorsal y la posición', async () => {
    const ruta = `/plantillas/${ids.senior}/jugadores/${ids.zoe}`
    await pedir('PATCH', ruta, 'delegado', { dorsal: 5, posicion: 'portero' })
    const res = await pedir('PATCH', ruta, 'delegado', { dorsal: null, posicion: null })
    expect(await res.json()).toMatchObject({ dorsal: null, posicion: null })
  })

  it('editar con un dorsal en uso da error', async () => {
    const res = await pedir('PATCH', `/plantillas/${ids.senior}/jugadores/${ids.zoe}`, 'delegado', {
      dorsal: 10,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error.mensaje).toBe('El dorsal 10 ya lo lleva Brais Méndez')
  })

  it('valida los datos de la edición', async () => {
    const ruta = `/plantillas/${ids.senior}/jugadores/${ids.brais}`
    for (const cuerpo of [{}, { nombre: ' ' }, { dorsal: -1 }, { jugadorId: ids.zoe }]) {
      expect((await pedir('PATCH', ruta, 'delegado', cuerpo)).status).toBe(400)
    }
  })

  it('editar un jugador que no está en la plantilla da 404', async () => {
    const res = await pedir(
      'PATCH',
      `/plantillas/${ids.senior}/jugadores/${ids.hugo}`,
      'delegado',
      {
        dorsal: 3,
      },
    )
    expect(res.status).toBe(404)
  })

  it('baja lógica y vista de bajas', async () => {
    const res = await pedir(
      'PATCH',
      `/plantillas/${ids.senior}/jugadores/${ids.brais}`,
      'delegado',
      {
        activo: false,
      },
    )
    expect(res.status).toBe(200)
    expect((await res.json()).activo).toBe(false)

    const activos = await (
      await pedir('GET', `/plantillas/${ids.senior}/jugadores`, 'delegado')
    ).json()
    expect(nombres(activos)).not.toContain('Brais Méndez')
    const bajas = await (
      await pedir('GET', `/plantillas/${ids.senior}/jugadores?activos=false`, 'delegado')
    ).json()
    expect(nombres(bajas)).toEqual(['Brais Méndez'])
    expect(
      (await pedir('GET', `/plantillas/${ids.senior}/jugadores?activos=x`, 'delegado')).status,
    ).toBe(400)
  })

  it('el dorsal de una baja queda libre', async () => {
    const res = await pedir('PATCH', `/plantillas/${ids.senior}/jugadores/${ids.zoe}`, 'delegado', {
      dorsal: 10,
    })
    expect(res.status).toBe(200)
  })

  it('reactivar con el dorsal ocupado da error; con otro dorsal, no', async () => {
    const ruta = `/plantillas/${ids.senior}/jugadores/${ids.brais}`
    let res = await pedir('PATCH', ruta, 'delegado', { activo: true })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatchObject({
      codigo: 'dorsal_en_uso',
      mensaje: 'El dorsal 10 ya lo lleva Zoe',
    })

    res = await pedir('PATCH', ruta, 'delegado', { activo: true, dorsal: 8 })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ activo: true, dorsal: 8 })
  })

  it('un jugador puede ver la plantilla pero no modificarla', async () => {
    expect((await pedir('GET', `/plantillas/${ids.senior}/jugadores`, 'jugador')).status).toBe(200)
    expect(
      (await pedir('POST', `/plantillas/${ids.senior}/jugadores`, 'jugador', { nombre: 'X' }))
        .status,
    ).toBe(403)
    expect(
      (
        await pedir('PATCH', `/plantillas/${ids.senior}/jugadores/${ids.zoe}`, 'jugador', {
          dorsal: 3,
        })
      ).status,
    ).toBe(403)
  })

  it('sin acceso a la plantilla, nada', async () => {
    expect((await pedir('GET', `/plantillas/${ids.senior}/jugadores`)).status).toBe(401)
    expect((await pedir('GET', `/plantillas/${ids.senior}/jugadores`, 'ajeno')).status).toBe(403)
    expect(
      (await pedir('POST', `/plantillas/${ids.vecino}/jugadores`, 'delegado', { nombre: 'X' }))
        .status,
    ).toBe(403)
  })
})

describe('jugadores del club', () => {
  it('buscar jugadores del club por nombre, con sus temporadas', async () => {
    const res = await pedir('GET', `/clubes/${ids.club}/jugadores?q=BRAIS`, 'delegado')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([
      {
        id: ids.brais,
        nombre: 'Brais Méndez',
        apellidos: null,
        temporadas: ['2026-27', '2025-26'],
      },
    ])
  })

  it('sin búsqueda, todos los del club por nombre; nunca los de otro club', async () => {
    const lista = await (await pedir('GET', `/clubes/${ids.club}/jugadores`, 'delegado')).json()
    expect(nombres(lista)).toEqual(['álvaro', 'Brais Méndez', 'Hugo', 'Íker', 'Zoe'])
    expect(lista.find((j: { nombre: string }) => j.nombre === 'Zoe').temporadas).toEqual([
      '2026-27',
    ])
  })

  it('devuelve todos los jugadores del club, sin cortar la lista', async () => {
    // GH-80: la búsqueda se cortaba en 20 jugadores sin avisar
    await db
      .insert(jugadores)
      .values(
        Array.from({ length: 25 }, (_, i) => ({ clubId: ids.club ?? '', nombre: `Relleno ${i}` })),
      )
    const lista = await (await pedir('GET', `/clubes/${ids.club}/jugadores`, 'delegado')).json()
    expect(lista).toHaveLength(30)
    const filtrada = await (
      await pedir('GET', `/clubes/${ids.club}/jugadores?q=relleno`, 'delegado')
    ).json()
    expect(filtrada).toHaveLength(25)
    await db
      .delete(jugadores)
      .where(and(eq(jugadores.clubId, ids.club ?? ''), like(jugadores.nombre, 'Relleno %')))
  })

  it('los comodines de la búsqueda se tratan como texto', async () => {
    const lista = await (
      await pedir('GET', `/clubes/${ids.club}/jugadores?q=%25`, 'delegado')
    ).json()
    expect(lista).toEqual([])
  })

  it('buscar exige ser delegado en alguna plantilla del club', async () => {
    expect((await pedir('GET', `/clubes/${ids.club}/jugadores`, 'jugador')).status).toBe(403)
    expect((await pedir('GET', `/clubes/${ids.club}/jugadores`, 'ajeno')).status).toBe(403)
    expect((await pedir('GET', `/clubes/${ids.club}/jugadores`, 'admin')).status).toBe(200)
  })

  it('trayectoria de un jugador por temporadas', async () => {
    const res = await pedir('GET', `/clubes/${ids.club}/jugadores/${ids.brais}`, 'delegado')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: ids.brais,
      nombre: 'Brais Méndez',
      apellidos: null,
      fichas: [
        {
          plantillaId: ids.senior,
          plantilla: 'Senior',
          categoria: 'sénior',
          temporada: '2026-27',
          dorsal: 8,
          posicion: 'centrocampista',
          activo: true,
        },
        {
          plantillaId: ids.seniorAnterior,
          plantilla: 'Senior',
          categoria: 'sénior',
          temporada: '2025-26',
          dorsal: 9,
          posicion: 'centrocampista',
          activo: true,
        },
      ],
    })
  })

  it('un jugador de otro club no se encuentra', async () => {
    const [ajeno] = await db.select().from(jugadores).where(eq(jugadores.nombre, 'De fuera'))
    expect(
      (await pedir('GET', `/clubes/${ids.club}/jugadores/${ajeno?.id}`, 'delegado')).status,
    ).toBe(404)
  })

  it('el rol jugador solo ve su propia trayectoria', async () => {
    expect((await pedir('GET', `/clubes/${ids.club}/jugadores/${ids.zoe}`, 'jugador')).status).toBe(
      403,
    )
    await db
      .update(jugadores)
      .set({ usuarioId: ids.jugador ?? '' })
      .where(eq(jugadores.id, ids.zoe ?? ''))
    expect((await pedir('GET', `/clubes/${ids.club}/jugadores/${ids.zoe}`, 'jugador')).status).toBe(
      200,
    )
    expect(
      (await pedir('GET', `/clubes/${ids.club}/jugadores/${ids.brais}`, 'jugador')).status,
    ).toBe(403)
  })
})

describe('nombre y apellidos', () => {
  // Plantilla aparte, para no cambiar el orden ni los datos de las pruebas anteriores
  it('alta con apellidos, orden por apellidos y nombre, y mensajes con el nombre completo', async () => {
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: ids.club,
      nombre: 'Veteranos',
      categoria: 'veteranos',
      temporada: '2026-27',
    })
    ids.veteranos = (await res.json()).id
    await db
      .insert(membresias)
      .values({ plantillaId: ids.veteranos ?? '', usuarioId: ids.delegado ?? '', rol: 'delegado' })
    const ruta = `/plantillas/${ids.veteranos}/jugadores`

    const ana = await (
      await pedir('POST', ruta, 'delegado', {
        nombre: ' Ana ',
        apellidos: ' Vázquez Rey ',
        dorsal: 3,
      })
    ).json()
    expect(ana).toMatchObject({ nombre: 'Ana', apellidos: 'Vázquez Rey' })
    for (const cuerpo of [
      { nombre: 'Berta', apellidos: 'Álvarez', dorsal: 3 },
      { nombre: 'Carla', apellidos: null },
      { nombre: 'Abril', apellidos: 'Álvarez' },
    ]) {
      const r = await pedir('POST', ruta, 'delegado', cuerpo)
      if (cuerpo.nombre === 'Berta') {
        // El dorsal 3 ya lo lleva Ana: el mensaje usa el nombre completo
        expect((await r.json()).error.mensaje).toBe('El dorsal 3 ya lo lleva Ana Vázquez Rey')
        await pedir('POST', ruta, 'delegado', { ...cuerpo, dorsal: null })
      }
    }

    // A igual dorsal (sin dorsal): Abril y Berta Álvarez, Carla (sin apellidos, por su nombre)
    const lista = await (await pedir('GET', ruta, 'delegado')).json()
    expect(lista.map((j: { nombre: string }) => j.nombre)).toEqual([
      'Ana',
      'Abril',
      'Berta',
      'Carla',
    ])
    ids.ana = ana.jugadorId
  })

  it('valida los apellidos y se pueden cambiar o quitar', async () => {
    const ruta = `/plantillas/${ids.veteranos}/jugadores`
    expect((await pedir('POST', ruta, 'delegado', { nombre: 'X', apellidos: '  ' })).status).toBe(
      400,
    )
    let res = await pedir('PATCH', `${ruta}/${ids.ana}`, 'delegado', { apellidos: 'Rey' })
    expect(await res.json()).toMatchObject({ nombre: 'Ana', apellidos: 'Rey' })
    res = await pedir('PATCH', `${ruta}/${ids.ana}`, 'delegado', { apellidos: null })
    expect(await res.json()).toMatchObject({ nombre: 'Ana', apellidos: null })
    await pedir('PATCH', `${ruta}/${ids.ana}`, 'delegado', { apellidos: 'Vázquez Rey' })
  })

  it('la búsqueda del club mira nombre y apellidos', async () => {
    const buscar = async (q: string) =>
      (
        await (
          await pedir('GET', `/clubes/${ids.club}/jugadores?q=${encodeURIComponent(q)}`, 'delegado')
        ).json()
      ).map((j: { nombre: string; apellidos: string | null }) => [j.nombre, j.apellidos])
    expect(await buscar('vázquez')).toEqual([['Ana', 'Vázquez Rey']])
    expect(await buscar('ana vázquez')).toEqual([['Ana', 'Vázquez Rey']])
    expect(await buscar('álvarez')).toEqual([
      ['Abril', 'Álvarez'],
      ['Berta', 'Álvarez'],
    ])
  })
})
