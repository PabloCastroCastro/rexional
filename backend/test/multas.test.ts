import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import { clubes, fichas, jugadores, membresias, multas, user } from '../src/db/schema/index.js'
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

type Motivo = {
  id: string
  descripcion: string
  importeCentimos: number
  tipoTarjeta: 'amarilla' | 'roja' | null
  activo: boolean
  multas: number
}

const catalogo = () => `/plantillas/${ids.senior}/motivos-multa`

async function listar(inactivos = false, quien = 'delegado') {
  const res = await pedir('GET', `${catalogo()}${inactivos ? '?inactivos=true' : ''}`, quien)
  return (await res.json()) as Motivo[]
}

const motivo = async (descripcion: string) =>
  (await listar(true)).find((m) => m.descripcion === descripcion) as Motivo

beforeAll(async () => {
  for (const clave of ['admin', 'delegado', 'jugador', 'ajeno']) await usuario(clave)

  const club = await (await pedir('POST', '/clubes', 'admin', { nombre: 'CD Multas' })).json()
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
  const [brais] = await db
    .insert(jugadores)
    .values({ clubId: club.id, nombre: 'Brais', apellidos: 'Iglesias' })
    .returning()
  ids.brais = brais?.id ?? ''
  await db.insert(fichas).values({
    plantillaId: ids.senior ?? '',
    jugadorId: ids.brais,
    clubId: club.id,
    temporada: '2026-27',
    dorsal: 7,
  })
})

afterAll(async () => {
  if (clubesCreados.length) await db.delete(clubes).where(inArray(clubes.id, clubesCreados))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('catálogo de multas', () => {
  it('lista el catálogo de la plantilla por orden alfabético; lo ve cualquier miembro', async () => {
    const lista = await listar(false, 'jugador')
    expect(lista.map((m) => [m.descripcion, m.importeCentimos, m.tipoTarjeta])).toEqual([
      ['Faltar sin avisar', 500, null],
      ['Llegar tarde al entreno', 200, null],
      ['Olvidar la equipación', 300, null],
      ['Tarjeta amarilla por protestar', 500, 'amarilla'],
      ['Tarjeta roja', 1000, 'roja'],
    ])
    expect(lista.every((m) => m.activo && m.multas === 0)).toBe(true)
  })

  it('añade un motivo, con o sin tarjeta', async () => {
    let res = await pedir('POST', catalogo(), 'delegado', {
      descripcion: '  Móvil en el vestuario ',
      importeCentimos: 100,
    })
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({
      descripcion: 'Móvil en el vestuario',
      importeCentimos: 100,
      tipoTarjeta: null,
      activo: true,
      multas: 0,
    })
    res = await pedir('POST', catalogo(), 'delegado', {
      descripcion: 'Doble amarilla',
      importeCentimos: 800,
      tipoTarjeta: 'amarilla',
    })
    expect((await res.json()).tipoTarjeta).toBe('amarilla')
  })

  it('valida los datos y rechaza una descripción activa repetida', async () => {
    for (const cuerpo of [
      { descripcion: ' ', importeCentimos: 100 },
      { descripcion: 'X', importeCentimos: -1 },
      { descripcion: 'X', importeCentimos: 1.5 },
      { descripcion: 'X', importeCentimos: 100, tipoTarjeta: 'azul' },
      { descripcion: 'X' },
    ]) {
      expect((await pedir('POST', catalogo(), 'delegado', cuerpo)).status).toBe(400)
    }
    const res = await pedir('POST', catalogo(), 'delegado', {
      descripcion: 'llegar TARDE al entreno',
      importeCentimos: 300,
    })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatchObject({
      codigo: 'motivo_duplicado',
      detalles: [{ campo: 'descripcion' }],
    })
  })

  it('edita el importe y la tarjeta; null quita la tarjeta', async () => {
    const roja = await motivo('Tarjeta roja')
    let res = await pedir('PATCH', `${catalogo()}/${roja.id}`, 'delegado', {
      importeCentimos: 1500,
    })
    expect(await res.json()).toMatchObject({ importeCentimos: 1500, tipoTarjeta: 'roja' })
    res = await pedir('PATCH', `${catalogo()}/${roja.id}`, 'delegado', { tipoTarjeta: null })
    expect((await res.json()).tipoTarjeta).toBeNull()
    expect((await pedir('PATCH', `${catalogo()}/${roja.id}`, 'delegado', {})).status).toBe(400)
  })

  it('cambiar o desactivar un motivo no altera las multas ya puestas', async () => {
    const tarde = await motivo('Llegar tarde al entreno')
    await db.insert(multas).values({
      plantillaId: ids.senior ?? '',
      jugadorId: ids.brais ?? '',
      motivoId: tarde.id,
      motivo: tarde.descripcion,
      importeCentimos: tarde.importeCentimos,
      fecha: '2026-10-13',
    })
    expect((await motivo('Llegar tarde al entreno')).multas).toBe(1)

    await pedir('PATCH', `${catalogo()}/${tarde.id}`, 'delegado', {
      descripcion: 'Llegar tarde',
      importeCentimos: 300,
    })
    const res = await pedir('PATCH', `${catalogo()}/${tarde.id}`, 'delegado', { activo: false })
    expect(await res.json()).toMatchObject({ activo: false, multas: 1 })

    const [multa] = await db.select().from(multas).where(eq(multas.motivoId, tarde.id))
    expect(multa).toMatchObject({ motivo: 'Llegar tarde al entreno', importeCentimos: 200 })
  })

  it('los desactivados solo aparecen al pedirlos y se pueden reactivar', async () => {
    expect((await listar()).map((m) => m.descripcion)).not.toContain('Llegar tarde')
    const tarde = await motivo('Llegar tarde')
    expect(tarde.activo).toBe(false)

    // Con otro motivo activo de la misma descripción no se puede reactivar
    await pedir('POST', catalogo(), 'delegado', {
      descripcion: 'Llegar tarde',
      importeCentimos: 250,
    })
    let res = await pedir('PATCH', `${catalogo()}/${tarde.id}`, 'delegado', { activo: true })
    expect(res.status).toBe(409)

    const nuevo = await (await listar()).find((m) => m.descripcion === 'Llegar tarde')
    await pedir('PATCH', `${catalogo()}/${nuevo?.id}`, 'delegado', { activo: false })
    res = await pedir('PATCH', `${catalogo()}/${tarde.id}`, 'delegado', { activo: true })
    expect(await res.json()).toMatchObject({ activo: true, importeCentimos: 300 })
  })

  it('un motivo de otra plantilla no se encuentra', async () => {
    const res = await pedir('GET', `/plantillas/${ids.juvenil}/motivos-multa`, 'admin')
    const [ajeno] = (await res.json()) as Motivo[]
    expect(
      (await pedir('PATCH', `${catalogo()}/${ajeno?.id}`, 'delegado', { importeCentimos: 1 }))
        .status,
    ).toBe(404)
  })

  it('solo delegado o superior gestiona el catálogo', async () => {
    const [primero] = await listar()
    for (const [metodo, ruta, cuerpo] of [
      ['POST', catalogo(), { descripcion: 'X', importeCentimos: 100 }],
      ['PATCH', `${catalogo()}/${primero?.id}`, { importeCentimos: 100 }],
    ] as const) {
      expect((await pedir(metodo, ruta, 'jugador', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, ruta, 'ajeno', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, ruta, undefined, cuerpo)).status).toBe(401)
    }
    expect((await pedir('GET', catalogo(), 'ajeno')).status).toBe(403)
  })
})
