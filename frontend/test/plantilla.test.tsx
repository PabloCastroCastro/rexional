import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
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

const BRAIS: JugadorPlantilla = {
  jugadorId: 'j1',
  nombre: 'Brais',
  apellidos: null,
  dorsal: 7,
  posicion: 'delantero',
  activo: true,
}
const ZOE: JugadorPlantilla = {
  jugadorId: 'j2',
  nombre: 'Zoe',
  apellidos: null,
  dorsal: null,
  posicion: null,
  activo: true,
}
const HUGO: JugadorPlantilla = {
  jugadorId: 'j3',
  nombre: 'Hugo',
  apellidos: null,
  dorsal: 10,
  posicion: 'defensa',
  activo: false,
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

// La API devuelve activos o bajas según ?activos=
function conJugadores(jugadores: JugadorPlantilla[], p = senior26) {
  conDatos({ plantillas: [p] })
  manejadores[`GET /api/plantillas/${p.id}/jugadores`] = (peticion) => {
    const activos = new URL(peticion.url).searchParams.get('activos') !== 'false'
    return json(jugadores.filter((j) => j.activo === activos))
  }
}

const error409 = (codigo: string, mensaje: string, campo?: string) =>
  json({ error: { codigo, mensaje, ...(campo && { detalles: [{ campo, mensaje }] }) } }, 409)

const filas = (lista: HTMLElement) =>
  within(lista)
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('lista de la plantilla', () => {
  it('muestra los jugadores con dorsal y posición, en el orden de la API', async () => {
    conJugadores([BRAIS, ZOE, HUGO])
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(filas(lista)).toEqual([
      expect.stringMatching(/Dorsal 7.*Brais.*Delantero/),
      expect.stringMatching(/Sin dorsal.*Zoe.*Sin posición/),
    ])
    expect(within(lista).getByRole('link', { name: /Brais/ })).toHaveAttribute(
      'href',
      '/plantillas/p1/jugadores/j1',
    )
  })

  it('el estado vacío invita a añadir el primer jugador', async () => {
    conJugadores([])
    abrir('/plantillas/p1/jugadores')
    expect(await screen.findByText('Todavía no hay jugadores')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Añadir el primer jugador' }))
    expect(screen.getByRole('dialog', { name: 'Añadir jugador' })).toBeInTheDocument()
  })

  it('el rol jugador ve la lista sin controles de edición', async () => {
    conJugadores(
      [BRAIS],
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }),
    )
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Bajas' }))
    expect(await screen.findByText('No hay bajas')).toBeInTheDocument()
  })

  it('el estado vacío del rol jugador no invita a añadir', async () => {
    conJugadores([], plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/jugadores')
    expect(await screen.findByText('Todavía no hay jugadores')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Añadir/ })).not.toBeInTheDocument()
  })
})

describe('alta de jugadores', () => {
  it('añade un jugador nuevo en el club', async () => {
    conJugadores([BRAIS])
    manejadores['POST /api/plantillas/p1/jugadores'] = async (peticion) =>
      json({ jugadorId: 'j4', activo: true, ...(await peticion.json()) }, 201)
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), ' Íker ')
    await userEvent.type(within(hoja).getByLabelText(/Dorsal/), '1')
    await userEvent.selectOptions(within(hoja).getByLabelText('Posición'), 'Portero')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))

    expect(await screen.findByText('Íker añadido a la plantilla')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([
      { nombre: 'Íker', apellidos: null, dorsal: 1, posicion: 'portero' },
    ])
  })

  it('nombre y apellidos van por separado y la lista muestra el nombre completo', async () => {
    conJugadores([{ ...BRAIS, apellidos: 'Iglesias' }])
    manejadores['POST /api/plantillas/p1/jugadores'] = async (peticion) =>
      json({ jugadorId: 'j5', activo: true, ...(await peticion.json()) }, 201)
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).getByText('Brais Iglesias')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Xoán')
    await userEvent.type(within(hoja).getByLabelText(/Apellidos/), ' Rodríguez Pazos ')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(
      await screen.findByText('Xoán Rodríguez Pazos añadido a la plantilla'),
    ).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([
      { nombre: 'Xoán', apellidos: 'Rodríguez Pazos', dorsal: null, posicion: null },
    ])
  })

  it('un dorsal en uso se muestra en el campo', async () => {
    conJugadores([BRAIS])
    manejadores['POST /api/plantillas/p1/jugadores'] = () =>
      error409('dorsal_en_uso', 'El dorsal 7 ya lo lleva Brais', 'dorsal')
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Bruno')
    await userEvent.type(within(hoja).getByLabelText(/Dorsal/), '7')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))

    expect(await within(hoja).findByText('El dorsal 7 ya lo lleva Brais')).toBeInTheDocument()
    expect(within(hoja).getByLabelText(/Dorsal/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('añade un jugador del club desde el buscador', async () => {
    conJugadores([])
    manejadores['GET /api/clubes/c1/jugadores'] = () =>
      json([
        { id: 'j8', nombre: 'Brais', temporadas: ['2025-26'] },
        { id: 'j9', nombre: 'Bruno', temporadas: ['2026-27', '2025-26'] },
      ])
    manejadores['POST /api/plantillas/p1/jugadores'] = () =>
      json({ jugadorId: 'j8', nombre: 'Brais', dorsal: 9, posicion: null, activo: true }, 201)
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir el primer jugador' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Ya es del club' }))
    await userEvent.type(within(hoja).getByLabelText('Buscar en el club'), 'br')

    const resultados = await within(hoja).findByRole('list', { name: 'Jugadores del club' })
    const bruno = within(resultados).getByRole('button', { name: /Bruno/ })
    expect(bruno).toBeDisabled()
    expect(bruno).toHaveTextContent('Ya tiene ficha en 2026-27')
    await waitFor(() =>
      expect(peticiones.map((p) => p.clave)).toContain('GET /api/clubes/c1/jugadores'),
    )

    await userEvent.click(within(resultados).getByRole('button', { name: /Brais/ }))
    expect(within(hoja).getByText('Temporadas: 2025-26')).toBeInTheDocument()
    await userEvent.type(within(hoja).getByLabelText(/Dorsal/), '9')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))

    expect(await screen.findByText('Brais añadido a la plantilla')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([
      { jugadorId: 'j8', dorsal: 9, posicion: null },
    ])
  })

  it('sin elegir a nadie del club no se envía nada', async () => {
    conJugadores([])
    manejadores['GET /api/clubes/c1/jugadores'] = () => json([])
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir el primer jugador' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Ya es del club' }))
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(within(hoja).getByText('Elige un jugador del club')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([])
  })
})

describe('ficha del jugador', () => {
  const trayectoria = {
    id: 'j1',
    nombre: 'Brais',
    apellidos: null,
    fichas: [
      {
        plantillaId: 'p1',
        plantilla: 'Senior',
        categoria: 'sénior',
        temporada: '2026-27',
        dorsal: 7,
        posicion: 'delantero',
        activo: true,
      },
      {
        plantillaId: 'p3',
        plantilla: 'Juvenil',
        categoria: 'juvenil',
        temporada: '2025-26',
        dorsal: null,
        posicion: null,
        activo: true,
      },
    ],
  }

  it('muestra su trayectoria por temporadas', async () => {
    conJugadores([BRAIS])
    manejadores['GET /api/clubes/c1/jugadores/j1'] = () => json(trayectoria)
    abrir('/plantillas/p1/jugadores/j1')
    expect(await screen.findByRole('heading', { name: 'Brais' })).toBeInTheDocument()
    const seccion = screen.getByRole('region', { name: 'Temporadas en el club' })
    expect(filas(within(seccion).getByRole('list'))).toEqual([
      expect.stringMatching(/2026-27.*Senior \(esta plantilla\).*Dorsal 7 · Delantero/),
      expect.stringMatching(/2025-26.*Juvenil.*Sin dorsal/),
    ])
  })

  it('edita el nombre, el dorsal y la posición', async () => {
    conJugadores([BRAIS])
    manejadores['GET /api/clubes/c1/jugadores/j1'] = () => json(trayectoria)
    manejadores['PATCH /api/plantillas/p1/jugadores/j1'] = async (peticion) =>
      json({ ...BRAIS, ...(await peticion.json()) })
    abrir('/plantillas/p1/jugadores/j1')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const hoja = screen.getByRole('dialog', { name: 'Editar a Brais' })
    expect(within(hoja).getByText(/cambian en todas sus temporadas/)).toBeInTheDocument()
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), ' Méndez')
    await userEvent.clear(within(hoja).getByLabelText(/Dorsal/))
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Jugador guardado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/jugadores/j1')).toEqual([
      { nombre: 'Brais Méndez', dorsal: null, posicion: 'delantero' },
    ])
  })

  it('dar de baja pide confirmación y vuelve a la lista', async () => {
    conJugadores([BRAIS])
    manejadores['GET /api/clubes/c1/jugadores/j1'] = () => json(trayectoria)
    manejadores['PATCH /api/plantillas/p1/jugadores/j1'] = () => json({ ...BRAIS, activo: false })
    const router = abrir('/plantillas/p1/jugadores/j1')
    await userEvent.click(await screen.findByRole('button', { name: 'Dar de baja' }))

    const confirmacion = screen.getByRole('alertdialog', { name: '¿Dar de baja a Brais?' })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Cancelar' }))
    expect(enviado('PATCH /api/plantillas/p1/jugadores/j1')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Dar de baja' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Dar de baja' }),
    )
    expect(await screen.findByText('Brais dado de baja')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/jugadores/j1')).toEqual([{ activo: false }])
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/jugadores'))
  })
})

describe('bajas', () => {
  it('reactiva un jugador desde la vista de bajas', async () => {
    conJugadores([BRAIS, HUGO])
    manejadores['PATCH /api/plantillas/p1/jugadores/j3'] = () => json({ ...HUGO, activo: true })
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Bajas' }))
    const lista = await screen.findByRole('list', { name: 'Bajas' })
    expect(filas(lista)).toEqual([expect.stringMatching(/Hugo/)])
    await userEvent.click(within(lista).getByRole('button', { name: 'Reactivar a Hugo' }))

    expect(await screen.findByText('Hugo vuelve a la plantilla')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/jugadores/j3')).toEqual([{ activo: true }])
  })

  it('si su dorsal está ocupado, pide otro antes de reactivar', async () => {
    conJugadores([BRAIS, HUGO])
    manejadores['PATCH /api/plantillas/p1/jugadores/j3'] = async (peticion) => {
      const cuerpo = await peticion.json()
      return cuerpo.dorsal === undefined
        ? error409('dorsal_en_uso', 'El dorsal 10 ya lo lleva Zoe', 'dorsal')
        : json({ ...HUGO, ...cuerpo })
    }
    abrir('/plantillas/p1/jugadores?ver=bajas')
    const lista = await screen.findByRole('list', { name: 'Bajas' })
    await userEvent.click(within(lista).getByRole('button', { name: 'Reactivar a Hugo' }))

    const hoja = await screen.findByRole('dialog', { name: 'Reactivar a Hugo' })
    expect(within(hoja).getByText('El dorsal 10 ya lo lleva Zoe')).toBeInTheDocument()
    const dorsal = within(hoja).getByLabelText(/Dorsal/)
    await userEvent.clear(dorsal)
    await userEvent.type(dorsal, '11')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Reactivar' }))

    expect(await screen.findByText('Hugo vuelve a la plantilla')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/jugadores/j3')).toEqual([
      { activo: true },
      { dorsal: 11, posicion: 'defensa', activo: true },
    ])
  })
})
