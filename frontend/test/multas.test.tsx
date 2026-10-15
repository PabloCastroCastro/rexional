import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import { centimosDe, euros, type MotivoMulta, type Multa } from '../src/multas/datos'
import {
  abrir,
  conDatos,
  json,
  manejadores,
  peticiones,
  plantilla,
  ruta,
  senior26,
} from './simulacion'

// Hoy es miércoles 14 de octubre de 2026 en Madrid (solo se simula la fecha)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

const JUGADORES: JugadorPlantilla[] = [
  {
    jugadorId: 'j1',
    nombre: 'Brais',
    apellidos: 'Iglesias',
    dorsal: 1,
    posicion: null,
    activo: true,
  },
  { jugadorId: 'j2', nombre: 'Zoe', apellidos: null, dorsal: 7, posicion: null, activo: true },
]

const motivo = (
  id: string,
  descripcion: string,
  importeCentimos: number,
  extra: Partial<MotivoMulta> = {},
): MotivoMulta => ({
  id,
  descripcion,
  importeCentimos,
  tipoTarjeta: null,
  activo: true,
  multas: 0,
  ...extra,
})

const CATALOGO = [
  motivo('m1', 'Llegar tarde al entreno', 200, { multas: 3 }),
  motivo('m2', 'Tarjeta roja', 1000, { tipoTarjeta: 'roja' }),
]

const multa = (id: string, jugador: JugadorPlantilla, extra: Partial<Multa> = {}): Multa => ({
  id,
  jugadorId: jugador.jugadorId,
  nombre: jugador.nombre,
  apellidos: jugador.apellidos,
  dorsal: jugador.dorsal,
  motivoId: 'm1',
  motivo: 'Llegar tarde al entreno',
  importeCentimos: 200,
  fecha: '2026-10-13',
  fechaPago: null,
  ...extra,
})

const [BRAIS, ZOE] = JUGADORES as [JugadorPlantilla, JugadorPlantilla]
const MULTAS = [
  multa('a', BRAIS),
  multa('b', BRAIS, {
    motivo: 'Pinchar el balón',
    motivoId: null,
    importeCentimos: 450,
    fecha: '2026-10-01',
  }),
  multa('c', ZOE, { fechaPago: '2026-10-02', fecha: '2026-10-01' }),
]

function conMultas(p = senior26) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/jugadores'] = () => json(JUGADORES)
  manejadores['GET /api/plantillas/p1/motivos-multa'] = (peticion) =>
    json(
      new URL(peticion.url).searchParams.get('inactivos') === 'true'
        ? [...CATALOGO, motivo('m9', 'Móvil', 100, { activo: false })]
        : CATALOGO,
    )
  manejadores['GET /api/plantillas/p1/multas'] = (peticion) => {
    const q = new URL(peticion.url).searchParams
    return json(
      MULTAS.filter(
        (m) =>
          (!q.get('jugador') || m.jugadorId === q.get('jugador')) &&
          (q.get('estado') !== 'pendientes' || m.fechaPago === null) &&
          (q.get('estado') !== 'cobradas' || m.fechaPago !== null),
      ),
    )
  }
  manejadores['GET /api/plantillas/p1/multas/resumen'] = () =>
    json({
      pendienteCentimos: 650,
      cajaCentimos: 200,
      deudas: [{ ...BRAIS, pendienteCentimos: 650, multasPendientes: 2 }],
    })
}

describe('importes', () => {
  it('lee euros escritos de varias formas y los muestra con formato', () => {
    expect(['5', '5,5', '5,50', '5.50', '12 €', '0,05'].map(centimosDe)).toEqual([
      500, 550, 550, 550, 1200, 5,
    ])
    expect(['', 'cinco', '5,555', '-1'].map(centimosDe)).toEqual([null, null, null, null])
    expect(euros(1250)).toMatch(/^12,50\s€$/)
  })
})

describe('caja', () => {
  it('muestra totales y deudas, y salda con confirmación', async () => {
    conMultas()
    manejadores['POST /api/plantillas/p1/jugadores/j1/saldar'] = () =>
      json({ cobradas: 2, importeCentimos: 650 })
    abrir('/plantillas/p1/multas')
    expect(await screen.findByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Pendiente').parentElement).toHaveTextContent(/6,50\s€/)
    expect(screen.getByText('En caja').parentElement).toHaveTextContent(/2,00\s€/)

    const deudas = screen.getByRole('list', { name: 'Deudas' })
    expect(within(deudas).getByRole('link')).toHaveTextContent(/Brais Iglesias.*2 multas/)
    await userEvent.click(
      within(deudas).getByRole('button', { name: 'Saldar las multas de Brais Iglesias' }),
    )
    const confirmacion = screen.getByRole('alertdialog', {
      name: /¿Saldar 2 multas de Brais Iglesias \(6,50\s€\)\?/,
    })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Saldar' }))
    expect(await screen.findByText(/Brais Iglesias: 2 multas cobradas/)).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores/j1/saldar')).toHaveLength(1)
  })

  it('una deuda abre las multas pendientes de ese jugador', async () => {
    conMultas()
    const router = abrir('/plantillas/p1/multas')
    await userEvent.click(await screen.findByRole('link', { name: /Brais Iglesias/ }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/multas/lista'))
    expect(router.state.location.search).toBe('?jugador=j1&estado=pendientes')
    const lista = await screen.findByRole('list', { name: 'Multas' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
  })
})

describe('poner multas', () => {
  it('rellena el importe desde el catálogo, lo deja cambiar y permite poner otra', async () => {
    conMultas()
    manejadores['POST /api/plantillas/p1/multas'] = async (peticion) => {
      const cuerpo = (await peticion.json()) as Record<string, unknown>
      const jugador = cuerpo.jugadorId === 'j1' ? BRAIS : ZOE
      return json(
        multa('n', jugador, {
          motivo: (cuerpo.motivo as string) ?? 'Llegar tarde al entreno',
          importeCentimos: cuerpo.importeCentimos as number,
        }),
        201,
      )
    }
    abrir('/plantillas/p1/multas')
    await userEvent.click(await screen.findByRole('button', { name: 'Poner multa' }))
    let hoja = screen.getByRole('dialog', { name: 'Poner multa' })
    await userEvent.selectOptions(within(hoja).getByLabelText('Jugador'), '1 · Brais Iglesias')
    await userEvent.selectOptions(within(hoja).getByLabelText('Motivo'), 'm1')
    expect(within(hoja).getByLabelText('Importe (€)')).toHaveValue('2,00')
    expect(within(hoja).getByLabelText('Fecha')).toHaveValue('2026-10-14')
    await userEvent.clear(within(hoja).getByLabelText('Importe (€)'))
    await userEvent.type(within(hoja).getByLabelText('Importe (€)'), '3,5')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Poner multa' }))

    expect(await within(hoja).findByRole('status')).toHaveTextContent(
      /Multa puesta a Brais Iglesias: Llegar tarde al entreno, 3,50\s€/,
    )
    expect(enviado('POST /api/plantillas/p1/multas')).toEqual([
      { jugadorId: 'j1', motivoId: 'm1', importeCentimos: 350, fecha: '2026-10-14' },
    ])

    // Poner otra: motivo libre («Otro…») con importe obligatorio
    await userEvent.click(within(hoja).getByRole('button', { name: 'Poner otra' }))
    hoja = screen.getByRole('dialog', { name: 'Poner multa' })
    await userEvent.selectOptions(within(hoja).getByLabelText('Jugador'), '7 · Zoe')
    await userEvent.selectOptions(within(hoja).getByLabelText('Motivo'), 'Otro…')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Poner multa' }))
    expect(within(hoja).getByText('Escribe el motivo')).toBeInTheDocument()
    expect(within(hoja).getByText(/Indica un importe mayor que 0/)).toBeInTheDocument()

    await userEvent.type(within(hoja).getByLabelText('¿Por qué?'), 'Pinchar el balón')
    await userEvent.type(within(hoja).getByLabelText('Importe (€)'), '4')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Poner multa' }))
    expect(await within(hoja).findByRole('status')).toHaveTextContent(/Zoe: Pinchar el balón/)
    expect(enviado('POST /api/plantillas/p1/multas')[1]).toEqual({
      jugadorId: 'j2',
      motivo: 'Pinchar el balón',
      importeCentimos: 400,
      fecha: '2026-10-14',
    })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Hecho' }))
    expect(screen.queryByRole('dialog', { name: 'Poner multa' })).not.toBeInTheDocument()
  })
})

describe('lista de multas', () => {
  it('filtra por estado, cobra, deshace y borra', async () => {
    conMultas()
    manejadores['PATCH /api/plantillas/p1/multas/a'] = async (peticion) =>
      json({ ...MULTAS[0], ...(await peticion.json()) })
    manejadores['PATCH /api/plantillas/p1/multas/c'] = async (peticion) =>
      json({ ...MULTAS[2], ...(await peticion.json()) })
    manejadores['DELETE /api/plantillas/p1/multas/b'] = () => new Response(null, { status: 204 })
    abrir('/plantillas/p1/multas/lista')

    let lista = await screen.findByRole('list', { name: 'Multas' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText(/2 multas · 6,50\s€/)).toBeInTheDocument()
    await userEvent.click(
      within(lista).getByRole('button', {
        name: 'Cobrar a Brais Iglesias: Llegar tarde al entreno',
      }),
    )
    expect(await screen.findByText(/Cobrada: Brais Iglesias/)).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/multas/a')).toEqual([{ fechaPago: '2026-10-14' }])

    await userEvent.click(
      within(lista).getByRole('button', {
        name: 'Borrar la multa de Brais Iglesias: Pinchar el balón',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Borrar multa' }),
    )
    expect(await screen.findByText('Multa borrada')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cobradas' }))
    lista = await screen.findByRole('list', { name: 'Multas' })
    expect(within(lista).getByRole('listitem')).toHaveTextContent(/Zoe.*cobrada/)
    await userEvent.click(within(lista).getByRole('button', { name: /Deshacer el cobro de Zoe/ }))
    expect(await screen.findByText('Cobro deshecho: Zoe')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/multas/c')).toEqual([{ fechaPago: null }])
  })
})

describe('catálogo', () => {
  it('añade y edita motivos, y desactiva avisando de las multas ya puestas', async () => {
    conMultas()
    manejadores['POST /api/plantillas/p1/motivos-multa'] = async (peticion) =>
      json(motivo('m3', 'Móvil en el vestuario', 100, await peticion.json()), 201)
    manejadores['PATCH /api/plantillas/p1/motivos-multa/m1'] = async (peticion) =>
      json({ ...CATALOGO[0], ...(await peticion.json()) })
    abrir('/plantillas/p1/multas/catalogo')

    await userEvent.click(await screen.findByRole('button', { name: 'Añadir motivo' }))
    let hoja = screen.getByRole('dialog', { name: 'Añadir motivo' })
    await userEvent.type(within(hoja).getByLabelText(/Descripción/), 'Móvil en el vestuario')
    await userEvent.type(within(hoja).getByLabelText('Importe (€)'), '1')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText('Motivo añadido: Móvil en el vestuario')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/motivos-multa')).toEqual([
      { descripcion: 'Móvil en el vestuario', importeCentimos: 100, tipoTarjeta: null },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Editar Llegar tarde al entreno' }))
    hoja = screen.getByRole('dialog', { name: 'Editar Llegar tarde al entreno' })
    expect(within(hoja).getByLabelText('Importe (€)')).toHaveValue('2,00')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Desactivar' }))
    const confirmacion = screen.getByRole('alertdialog')
    expect(confirmacion).toHaveTextContent('Las 3 multas ya puestas con este motivo no cambian')
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Desactivar' }))
    expect(await screen.findByText('Llegar tarde al entreno desactivado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/motivos-multa/m1')).toEqual([{ activo: false }])
  })

  it('muestra los desactivados al pedirlo', async () => {
    conMultas()
    abrir('/plantillas/p1/multas/catalogo')
    await screen.findByText('Llegar tarde al entreno')
    expect(screen.queryByText('Móvil')).not.toBeInTheDocument()
    await userEvent.click(screen.getByLabelText('Ver desactivados'))
    expect(await screen.findByText('Móvil')).toBeInTheDocument()
    expect(screen.getByText('Desactivado')).toBeInTheDocument()
  })
})

describe('plantilla y rol jugador', () => {
  it('la plantilla muestra la deuda pendiente de cada jugador', async () => {
    conMultas()
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    await waitFor(() =>
      expect(within(lista).getAllByRole('listitem')[0]).toHaveTextContent(
        /6,50\s€ de multas pendientes/,
      ),
    )
    expect(within(lista).getAllByRole('listitem')[1]).not.toHaveTextContent('multas pendientes')
  })

  it('el rol jugador ve sus multas y el catálogo, sin caja ni acciones', async () => {
    conMultas(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/multas')
    const pestanas = await screen.findByRole('navigation', { name: 'Multas' })
    expect(
      within(pestanas)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Mis multas', 'Catálogo'])
    expect(await screen.findByRole('list', { name: 'Multas' })).toBeInTheDocument()
    expect(screen.queryByText('En caja')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Cobrar|Borrar|Poner multa/ }),
    ).not.toBeInTheDocument()
    expect(peticiones.map((p) => p.clave)).not.toContain('GET /api/plantillas/p1/multas/resumen')

    await userEvent.click(within(pestanas).getByRole('link', { name: 'Catálogo' }))
    expect(await screen.findByText('Llegar tarde al entreno')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar|Añadir motivo/ })).not.toBeInTheDocument()
  })
})

describe('multas desactivadas en la plantilla', () => {
  const sinMultas = (extra = {}) =>
    plantilla('p1', 'Alevín', '2026-27', { multasActivas: false, ...extra })

  it('no se ve la pestaña ni la deuda, y la sección invita a activarlas', async () => {
    conMultas(sinMultas())
    abrir('/plantillas/p1/jugadores')
    const navegacion = await screen.findByRole('navigation', { name: 'Secciones' })
    expect(
      within(navegacion)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Plantilla', 'Entrenos', 'Partidos', 'Más'])
    await screen.findByRole('list', { name: 'Jugadores' })
    expect(screen.queryByText(/multas pendientes/)).not.toBeInTheDocument()
    const pedidas = peticiones.map((p) => p.clave)
    expect(pedidas).not.toContain('GET /api/plantillas/p1/multas/resumen')
    expect(pedidas).not.toContain('GET /api/plantillas/p1/multas')
  })

  it('si se entra en la dirección de multas, se explica y se enlaza a Configuración', async () => {
    conMultas(sinMultas())
    abrir('/plantillas/p1/multas')
    expect(await screen.findByText('Esta plantilla no usa multas')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Activarlas en Configuración' })).toHaveAttribute(
      'href',
      '/plantillas/p1/mas/configuracion',
    )
  })

  it('el delegado no tiene el enlace a Configuración', async () => {
    conMultas(sinMultas({ rol: 'delegado', esAdminClub: false }))
    abrir('/plantillas/p1/multas')
    expect(await screen.findByText('Esta plantilla no usa multas')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Configuración/ })).not.toBeInTheDocument()
  })

  it('se desactivan desde Configuración', async () => {
    conMultas()
    manejadores['GET /api/clubes/c1/admins'] = () => json([])
    manejadores['PATCH /api/plantillas/p1'] = async (peticion) =>
      json({ ...senior26, ...(await peticion.json()) })
    abrir('/plantillas/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Esta plantilla' })
    const interruptor = within(bloque).getByRole('checkbox', { name: /Multas en esta plantilla/ })
    expect(interruptor).toBeChecked()
    await userEvent.click(interruptor)
    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Plantilla guardada')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1')).toEqual([
      { nombre: 'Senior', categoria: 'sénior', multasActivas: false },
    ])
  })
})
