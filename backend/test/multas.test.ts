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

describe('multas', () => {
  type Multa = {
    id: string
    jugadorId: string
    nombre: string
    motivoId: string | null
    motivo: string
    importeCentimos: number
    fecha: string
    fechaPago: string | null
  }
  const HOY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  const base = () => `/plantillas/${ids.senior}`

  async function poner(cuerpo: Record<string, unknown>, estado = 201) {
    const res = await pedir('POST', `${base()}/multas`, 'delegado', cuerpo)
    expect(res.status).toBe(estado)
    return res.json()
  }

  async function listarMultas(consulta = '', quien = 'delegado') {
    return (await (await pedir('GET', `${base()}/multas${consulta}`, quien)).json()) as Multa[]
  }

  it('pone una multa del catálogo copiando motivo e importe, con la fecha de hoy', async () => {
    // Zoe y Hugo (de baja) en el Senior; Bruno solo en el Juvenil
    const lista = await db
      .insert(jugadores)
      .values(
        ['Zoe', 'Hugo', 'Bruno'].map((nombre) => ({ clubId: clubesCreados[0] ?? '', nombre })),
      )
      .returning()
    for (const j of lista) ids[j.nombre] = j.id
    await db.insert(fichas).values([
      {
        plantillaId: ids.senior ?? '',
        jugadorId: ids.Zoe ?? '',
        clubId: clubesCreados[0] ?? '',
        temporada: '2026-27',
      },
      {
        plantillaId: ids.senior ?? '',
        jugadorId: ids.Hugo ?? '',
        clubId: clubesCreados[0] ?? '',
        temporada: '2026-27',
        activo: false,
      },
      {
        plantillaId: ids.juvenil ?? '',
        jugadorId: ids.Bruno ?? '',
        clubId: clubesCreados[0] ?? '',
        temporada: '2026-27',
      },
    ])

    const faltar = await motivo('Faltar sin avisar')
    const multa = await poner({ jugadorId: ids.Zoe, motivoId: faltar.id })
    expect(multa).toMatchObject({
      nombre: 'Zoe',
      motivoId: faltar.id,
      motivo: 'Faltar sin avisar',
      importeCentimos: 500,
      fecha: HOY,
      fechaPago: null,
    })
    // El importe del catálogo se puede cambiar
    const cara = await poner({ jugadorId: ids.Zoe, motivoId: faltar.id, importeCentimos: 700 })
    expect(cara.importeCentimos).toBe(700)
  })

  it('pone una multa con motivo libre e importe obligatorio', async () => {
    const multa = await poner({
      jugadorId: ids.brais,
      motivo: ' Pinchar el balón del míster ',
      importeCentimos: 400,
      fecha: '2026-10-01',
    })
    expect(multa).toMatchObject({
      motivoId: null,
      motivo: 'Pinchar el balón del míster',
      importeCentimos: 400,
    })
    await poner({ jugadorId: ids.brais, motivo: 'Sin importe' }, 400)
  })

  it('rechaza motivos inactivos o de otra plantilla, jugadores sin ficha e importes a 0', async () => {
    const inactivo = (await listar(true)).find((m) => !m.activo)
    let error = (await poner({ jugadorId: ids.brais, motivoId: inactivo?.id }, 400)).error
    expect(error).toMatchObject({ codigo: 'motivo_no_valido', detalles: [{ campo: 'motivoId' }] })

    const [delJuvenil] = (await (
      await pedir('GET', `/plantillas/${ids.juvenil}/motivos-multa`, 'admin')
    ).json()) as Motivo[]
    error = (await poner({ jugadorId: ids.brais, motivoId: delJuvenil?.id }, 400)).error
    expect(error.codigo).toBe('motivo_no_valido')

    const tarde = await motivo('Llegar tarde')
    error = (await poner({ jugadorId: ids.Bruno, motivoId: tarde.id }, 400)).error
    expect(error.codigo).toBe('jugador_sin_ficha')

    // Un jugador de baja sí puede tener multas (de antes de la baja)
    await poner({ jugadorId: ids.Hugo, motivoId: tarde.id, fecha: '2026-09-15' })

    const gratis = await (
      await pedir('POST', catalogo(), 'delegado', { descripcion: 'Aviso', importeCentimos: 0 })
    ).json()
    error = (await poner({ jugadorId: ids.brais, motivoId: gratis.id }, 400)).error
    expect(error.detalles).toEqual([
      { campo: 'importeCentimos', mensaje: 'Indica un importe mayor que 0' },
    ])

    await poner({ jugadorId: ids.brais, motivoId: tarde.id, motivo: 'Las dos cosas' }, 400)
  })

  it('filtra por jugador y estado, la más reciente primero', async () => {
    const deZoe = await listarMultas(`?jugador=${ids.Zoe}`)
    expect(deZoe.map((m) => m.importeCentimos)).toEqual([700, 500])
    const deBrais = await listarMultas(`?jugador=${ids.brais}`)
    expect(deBrais.map((m) => m.fecha)).toEqual(['2026-10-13', '2026-10-01'])
    expect(await listarMultas('?estado=cobradas')).toEqual([])
    expect((await pedir('GET', `${base()}/multas?estado=todas`, 'delegado')).status).toBe(400)
  })

  it('cobra, deshace el cobro, edita y borra', async () => {
    const [multa] = await listarMultas(`?jugador=${ids.Zoe}`)
    const ruta = `${base()}/multas/${multa?.id}`
    let res = await pedir('PATCH', ruta, 'delegado', { fechaPago: HOY })
    expect((await res.json()).fechaPago).toBe(HOY)
    expect((await listarMultas('?estado=cobradas')).map((m) => m.id)).toEqual([multa?.id])

    res = await pedir('PATCH', ruta, 'delegado', { fechaPago: '2020-01-01' })
    expect(res.status).toBe(400)
    expect((await res.json()).error.detalles).toEqual([
      { campo: 'fechaPago', mensaje: 'La fecha de cobro no puede ser anterior a la de la multa' },
    ])

    res = await pedir('PATCH', ruta, 'delegado', { fechaPago: null, importeCentimos: 600 })
    expect(await res.json()).toMatchObject({ fechaPago: null, importeCentimos: 600 })

    expect((await pedir('DELETE', ruta, 'delegado')).status).toBe(204)
    expect((await pedir('DELETE', ruta, 'delegado')).status).toBe(404)
  })

  it('saldar cobra de una vez las pendientes de un jugador', async () => {
    const res = await pedir('POST', `${base()}/jugadores/${ids.brais}/saldar`, 'delegado')
    expect(await res.json()).toEqual({ cobradas: 2, importeCentimos: 600 })
    expect(await listarMultas(`?jugador=${ids.brais}&estado=pendientes`)).toEqual([])
    expect(
      await (await pedir('POST', `${base()}/jugadores/${ids.brais}/saldar`, 'delegado', {})).json(),
    ).toEqual({ cobradas: 0, importeCentimos: 0 })
    expect(
      (await pedir('POST', `${base()}/jugadores/${ids.Bruno}/saldar`, 'delegado')).status,
    ).toBe(404)
  })

  it('resumen: pendiente, caja y deudas de mayor a menor', async () => {
    const res = await pedir('GET', `${base()}/multas/resumen`, 'delegado')
    // Pendientes: Zoe 500, Hugo 300 (Llegar tarde); cobradas: las 600 de Brais
    expect(await res.json()).toEqual({
      pendienteCentimos: 800,
      cajaCentimos: 600,
      deudas: [
        expect.objectContaining({ nombre: 'Zoe', pendienteCentimos: 500, multasPendientes: 1 }),
        expect.objectContaining({ nombre: 'Hugo', pendienteCentimos: 300, multasPendientes: 1 }),
      ],
    })
  })

  it('el rol jugador solo ve sus multas; no gestiona ni ve el resumen', async () => {
    expect(await listarMultas('', 'jugador')).toEqual([])
    await db
      .update(jugadores)
      .set({ usuarioId: ids.jugador ?? '' })
      .where(eq(jugadores.id, ids.Zoe ?? ''))
    const suyas = await listarMultas(`?jugador=${ids.brais}`, 'jugador')
    expect(suyas.map((m) => m.nombre)).toEqual(['Zoe'])

    const [multa] = suyas
    for (const [metodo, ruta, cuerpo] of [
      ['GET', `${base()}/multas/resumen`, undefined],
      ['POST', `${base()}/multas`, { jugadorId: ids.Zoe, motivo: 'X', importeCentimos: 100 }],
      ['PATCH', `${base()}/multas/${multa?.id}`, { fechaPago: HOY }],
      ['DELETE', `${base()}/multas/${multa?.id}`, undefined],
      ['POST', `${base()}/jugadores/${ids.Zoe}/saldar`, undefined],
    ] as const) {
      expect((await pedir(metodo, ruta, 'jugador', cuerpo)).status).toBe(403)
      expect((await pedir(metodo, ruta, 'ajeno', cuerpo)).status).toBe(403)
    }
  })
})

describe('multas desactivadas en la plantilla', () => {
  const base = () => `/plantillas/${ids.senior}`

  it('solo entrenador o superior las desactiva, y la plantilla lo indica', async () => {
    expect((await pedir('PATCH', base(), 'delegado', { multasActivas: false })).status).toBe(403)
    const res = await pedir('PATCH', base(), 'admin', { multasActivas: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ multasActivas: false })
    const lista = await (await pedir('GET', '/plantillas', 'delegado')).json()
    expect(lista.find((p: { id: string }) => p.id === ids.senior)).toMatchObject({
      multasActivas: false,
    })
  })

  it('con las multas desactivadas no se cambia nada, pero lo que hay se puede consultar', async () => {
    const [motivo] = await listar()
    const [multa] = await (await pedir('GET', `${base()}/multas`, 'delegado')).json()
    for (const [metodo, ruta, cuerpo] of [
      ['POST', `${base()}/multas`, { jugadorId: ids.brais, motivo: 'X', importeCentimos: 100 }],
      ['PATCH', `${base()}/multas/${multa?.id}`, { fechaPago: '2026-10-14' }],
      ['DELETE', `${base()}/multas/${multa?.id}`, undefined],
      ['POST', `${base()}/jugadores/${ids.brais}/saldar`, undefined],
      ['POST', catalogo(), { descripcion: 'Nuevo', importeCentimos: 100 }],
      ['PATCH', `${catalogo()}/${motivo?.id}`, { importeCentimos: 900 }],
    ] as const) {
      const res = await pedir(metodo, ruta, 'delegado', cuerpo)
      expect(res.status).toBe(409)
      expect((await res.json()).error.codigo).toBe('multas_desactivadas')
    }
    for (const ruta of [`${base()}/multas`, `${base()}/multas/resumen`, catalogo()]) {
      expect((await pedir('GET', ruta, 'delegado')).status).toBe(200)
    }
  })

  it('al reactivarlas vuelven como estaban', async () => {
    const antes = await (await pedir('GET', `${base()}/multas`, 'delegado')).json()
    await pedir('PATCH', base(), 'admin', { multasActivas: true })
    const despues = await (await pedir('GET', `${base()}/multas`, 'delegado')).json()
    expect(despues).toEqual(antes)
    const res = await pedir('POST', `${base()}/multas`, 'delegado', {
      jugadorId: ids.brais,
      motivo: 'Otra vez activas',
      importeCentimos: 100,
    })
    expect(res.status).toBe(201)
  })

  it('la plantilla de la temporada siguiente toma el valor de la anterior', async () => {
    await pedir('PATCH', `/plantillas/${ids.juvenil}`, 'admin', { multasActivas: false })
    const res = await pedir('POST', '/plantillas', 'admin', {
      clubId: clubesCreados[0],
      nombre: 'Juvenil',
      categoria: 'juvenil',
      temporada: '2027-28',
      plantillaAnteriorId: ids.juvenil,
    })
    expect(await res.json()).toMatchObject({ multasActivas: false })
    const nueva = await pedir('POST', '/plantillas', 'admin', {
      clubId: clubesCreados[0],
      nombre: 'Alevín',
      categoria: 'alevín',
      temporada: '2026-27',
    })
    expect(await nueva.json()).toMatchObject({ multasActivas: true })
  })
})
