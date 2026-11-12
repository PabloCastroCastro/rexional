import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import type { FichaLeida } from '../src/jugadores/FichaFederacion'
import { type Plantilla, temporadaDe } from '../src/plantillas/datos'
import { abrir, conDatos, json, manejadores, peticiones, plantilla, senior26 } from './simulacion'

// Plantilla desde la ficha del equipo de la federación (GH-197): al crearla o en «Añadir jugador»

const LEER = 'POST /api/clubes/c1/ficha-federacion'
const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const pdf = () => new File(['%PDF-1.4'], 'ficha.pdf', { type: 'application/pdf' })
const actual = temporadaDe(new Date())

const persona = (ficha: string, nombre: string, apellidos: string, jugadorId: string | null) => ({
  ficha,
  nombre,
  apellidos,
  funcion: 'Aficionado',
  jugadorId,
})

// Brais ya es del club; Mateo tiene ficha en el Juvenil esta temporada; Hugo ya está en el Senior
// 2026-27; Xoán es nuevo
const leida = (temporada: string): FichaLeida => ({
  equipo: 'CD Proba "B"',
  categoria: '2ª Futgal',
  jugadores: [
    persona('ABELLA CASTRO, BRAIS', 'Brais', 'Abella Castro', 'j1'),
    persona('LÓPEZ DO CAMPO, HUGO', 'Hugo', 'López do Campo', 'j2'),
    persona('MUIÑO REY, MATEO', 'Mateo', 'Muiño Rey', 'j3'),
    persona('FERNÁNDEZ DE LA FUENTE, XOÁN', 'Xoán', 'Fernández de la Fuente', null),
  ],
  cuerpoTecnico: [
    {
      ficha: 'SUAREZ PENA, GONZALO',
      nombre: 'Gonzalo',
      apellidos: 'Suarez Pena',
      funcion: 'Entrenador titular',
    },
  ],
  club: [
    { id: 'j1', nombre: 'Brais', apellidos: 'Abella', fichas: [] },
    {
      id: 'j2',
      nombre: 'Hugo',
      apellidos: 'López',
      fichas: [{ plantillaId: 'p1', plantilla: 'Senior', temporada, tipo: 'propia' }],
    },
    {
      id: 'j3',
      nombre: 'Mateo',
      apellidos: 'Muiño Rey',
      fichas: [{ plantillaId: 'p2', plantilla: 'Juvenil', temporada, tipo: 'propia' }],
    },
    { id: 'j4', nombre: 'Xoán', apellidos: null, fichas: [] },
  ],
})

const filas = () =>
  within(screen.getByRole('region', { name: 'Jugadores de la ficha' })).getAllByRole('listitem')

describe('nueva plantilla desde la ficha de la federación', () => {
  it('rellena nombre y categoría, revisa los jugadores y crea todo junto', async () => {
    let plantillas: Plantilla[] = []
    conDatos({ plantillas: [] })
    manejadores['GET /api/plantillas'] = () => json(plantillas)
    manejadores[LEER] = () => json(leida(actual))
    manejadores['POST /api/plantillas'] = async (peticion) => {
      const cuerpo = await peticion.json()
      plantillas = [plantilla('nueva', cuerpo.nombre, cuerpo.temporada)]
      return json(plantillas[0], 201)
    }
    abrir('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva plantilla' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva plantilla' })
    await userEvent.upload(
      within(hoja).getByLabelText('Archivo de la ficha del equipo en PDF'),
      pdf(),
    )

    expect(await within(hoja).findByLabelText(/Nombre/)).toHaveValue('CD Proba "B"')
    expect(within(hoja).getByLabelText(/Categoría/)).toHaveValue('2ª Futgal')
    expect(enviado(LEER)[0]).toMatch(/name="archivo"/)
    const [brais, hugo, mateo, xoan] = filas()
    expect(brais).toHaveTextContent(/Brais Abella.*Ya es del club.*ABELLA CASTRO, BRAIS/)
    // Hugo ya tiene ficha propia en el Senior de esta temporada
    expect(hugo).toHaveTextContent(`Tiene ficha en Senior en ${actual}: no se añade`)
    expect(mateo).toHaveTextContent(`Tiene ficha en Juvenil en ${actual}: no se añade`)
    expect(within(mateo as HTMLElement).getByRole('checkbox')).toBeDisabled()
    expect(xoan).toHaveTextContent('Xoán Fernández de la Fuente')
    expect(xoan).toHaveTextContent('Nuevo en el club')
    expect(within(hoja).getByText('Cuerpo técnico · 1')).toBeInTheDocument()

    // Xoán es el Xoán del club: se empareja a mano
    await userEvent.click(within(xoan as HTMLElement).getByRole('button', { name: /Corregir/ }))
    await userEvent.selectOptions(within(hoja).getByLabelText('Jugador del club'), 'j4')
    expect(within(hoja).getByText(/Se añadirán 2 jugadores: 0 nuevos/)).toBeInTheDocument()

    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear con 2 jugadores' }))
    await waitFor(() => expect(enviado('POST /api/plantillas')).toHaveLength(1))
    expect(enviado('POST /api/plantillas')[0]).toEqual({
      clubId: 'c1',
      nombre: 'CD Proba "B"',
      categoria: '2ª Futgal',
      temporada: actual,
      plantillaAnteriorId: null,
      jugadores: [{ jugadorId: 'j1' }, { jugadorId: 'j4' }],
    })
  })

  it('un PDF que no es una ficha se explica', async () => {
    conDatos({ plantillas: [] })
    manejadores[LEER] = () =>
      json(
        {
          error: {
            codigo: 'ficha_no_legible',
            mensaje: 'No parece la ficha de un equipo de la Federación Gallega',
          },
        },
        400,
      )
    abrir('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva plantilla' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva plantilla' })
    await userEvent.upload(
      within(hoja).getByLabelText('Archivo de la ficha del equipo en PDF'),
      pdf(),
    )
    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No parece la ficha')
    expect(within(hoja).getByRole('button', { name: 'Crear' })).toBeInTheDocument()
  })
})

describe('añadir jugadores desde la federación', () => {
  const HUGO: JugadorPlantilla = {
    jugadorId: 'j2',
    nombre: 'Hugo',
    apellidos: 'López',
    dorsal: 9,
    posicion: null,
    activo: true,
    tipo: 'propia',
    enDinamica: true,
    procedencia: null,
  }
  const IAGO: JugadorPlantilla = { ...HUGO, jugadorId: 'j5', nombre: 'Iago', apellidos: null }

  it('omite a los que ya están, avisa de los que faltan y añade el resto', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/jugadores'] = () => json([HUGO, IAGO])
    manejadores[LEER] = () => json(leida('2026-27'))
    manejadores['POST /api/plantillas/p1/jugadores/lote'] = () => json([HUGO, HUGO], 201)
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Desde la federación' }))
    await userEvent.upload(
      within(hoja).getByLabelText('Archivo de la ficha del equipo en PDF'),
      pdf(),
    )

    await within(hoja).findByText(/Ficha de/)
    const [, hugo] = filas()
    expect(hugo).toHaveTextContent('Ya está en la plantilla')
    expect(within(hugo as HTMLElement).getByRole('checkbox')).not.toBeChecked()
    expect(within(hoja).getByText(/No están en la ficha: Iago/)).toBeInTheDocument()

    // Xoán, nuevo, con el nombre corregido
    const xoan = filas()[3] as HTMLElement
    await userEvent.click(within(xoan).getByRole('button', { name: /Corregir/ }))
    const apellidos = within(xoan).getByLabelText('Apellidos')
    await userEvent.clear(apellidos)
    await userEvent.type(apellidos, 'Fernández')

    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir 2 jugadores' }))
    await waitFor(() => expect(enviado('POST /api/plantillas/p1/jugadores/lote')).toHaveLength(1))
    expect(enviado('POST /api/plantillas/p1/jugadores/lote')[0]).toEqual({
      jugadores: [{ jugadorId: 'j1' }, { nombre: 'Xoán', apellidos: 'Fernández' }],
    })
    expect(await screen.findByText('2 jugadores añadidos a la plantilla')).toBeInTheDocument()
  })

  it('un nuevo sin nombre no se envía', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores[LEER] = () => json(leida('2026-27'))
    abrir('/plantillas/p1/jugadores')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Desde la federación' }))
    await userEvent.upload(
      within(hoja).getByLabelText('Archivo de la ficha del equipo en PDF'),
      pdf(),
    )
    const xoan = (await within(hoja).findAllByRole('listitem'))[3] as HTMLElement
    await userEvent.click(within(xoan).getByRole('button', { name: /Corregir/ }))
    await userEvent.clear(within(xoan).getByLabelText('Nombre'))
    await userEvent.click(within(hoja).getByRole('button', { name: /Añadir \d jugadores/ }))
    expect(within(hoja).getByRole('alert')).toHaveTextContent('Escribe el nombre')
    expect(enviado('POST /api/plantillas/p1/jugadores/lote')).toHaveLength(0)
  })
})
