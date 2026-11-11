import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import type { Partido } from '../src/partidos/datos'
import { abrir, conDatos, json, manejadores, peticiones, senior26 } from './simulacion'

// Jugadores invitados en Jugadores, Añadir jugador y la convocatoria (GH-188)

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

const ficha = (
  jugadorId: string,
  nombre: string,
  extra: Partial<JugadorPlantilla> = {},
): JugadorPlantilla => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal: null,
  posicion: null,
  activo: true,
  tipo: 'propia',
  enDinamica: true,
  procedencia: null,
  ...extra,
})

const BRAIS = ficha('j1', 'Brais', { dorsal: 7 })
const MATEO = ficha('j2', 'Mateo', {
  tipo: 'invitado',
  enDinamica: false,
  procedencia: 'Juvenil A',
})
const HUGO = ficha('j3', 'Hugo', { tipo: 'invitado', procedencia: 'A prueba' })

const INVITABLES = [
  { jugadorId: 'j7', nombre: 'Iago', apellidos: 'Pazos', plantilla: 'Juvenil A' },
  { jugadorId: 'j8', nombre: 'Xoel', apellidos: null, plantilla: 'Senior B' },
]

function conJugadores(jugadores: JugadorPlantilla[]) {
  conDatos({ plantillas: [senior26] })
  manejadores['GET /api/plantillas/p1/jugadores'] = (peticion) => {
    const activos = new URL(peticion.url).searchParams.get('activos') !== 'false'
    return json(jugadores.filter((j) => j.activo === activos))
  }
  manejadores['GET /api/plantillas/p1/invitables'] = (peticion) => {
    const q = (new URL(peticion.url).searchParams.get('q') ?? '').toLowerCase()
    return json(INVITABLES.filter((j) => j.nombre.toLowerCase().includes(q)))
  }
  manejadores['POST /api/plantillas/p1/jugadores'] = async (peticion) =>
    json({ ...ficha('j9', 'Nuevo'), ...(await peticion.json()) }, 201)
}

async function abrirAlta() {
  abrir('/plantillas/p1/jugadores')
  await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
  const hoja = screen.getByRole('dialog', { name: 'Añadir jugador' })
  await userEvent.click(within(hoja).getByRole('button', { name: 'Invitado' }))
  return hoja
}

describe('invitados en Jugadores', () => {
  it('van aparte, en un apartado plegado, con su procedencia, su dinámica y sus partidos', async () => {
    conJugadores([BRAIS, MATEO, HUGO])
    manejadores['GET /api/plantillas/p1/estadisticas'] = () =>
      json({ jugadores: [{ jugadorId: 'j2', partidos: 3 }] })
    abrir('/plantillas/p1/jugadores')
    const propios = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(propios).getAllByRole('listitem')).toHaveLength(1)

    const apartado = screen.getByText('Invitados · 2').closest('details')
    expect(apartado).not.toHaveAttribute('open')
    await userEvent.click(screen.getByText('Invitados · 2'))
    const invitados = screen.getByRole('list', { name: 'Invitados' })
    await waitFor(() =>
      expect(within(invitados).getAllByRole('listitem')[0]).toHaveTextContent(
        /Mateo.*Invitado.*Juvenil A · Solo partidos · 3 partidos/,
      ),
    )
    expect(within(invitados).getAllByRole('listitem')[1]).toHaveTextContent(
      /Hugo.*A prueba · En la dinámica · 0 partidos/,
    )
  })
})

describe('añadir un invitado', () => {
  it('de otra plantilla del club, solo para partidos por defecto', async () => {
    conJugadores([BRAIS])
    const hoja = await abrirAlta()
    const interruptorAntes = within(hoja).queryByRole('switch')
    expect(interruptorAntes).not.toBeInTheDocument()

    await userEvent.type(within(hoja).getByLabelText(/Buscar en otras plantillas/), 'iag')
    await userEvent.click(await within(hoja).findByRole('button', { name: /Iago Pazos/ }))
    expect(within(hoja).getByText('Juvenil A')).toBeInTheDocument()
    const interruptor = within(hoja).getByRole('switch', { name: /En la dinámica del equipo/ })
    expect(interruptor).not.toBeChecked()
    await userEvent.type(within(hoja).getByLabelText(/Dorsal/), '7')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))

    await waitFor(() =>
      expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([
        { invitado: true, jugadorId: 'j7', enDinamica: false, dorsal: 7, posicion: null },
      ]),
    )
  })

  it('de fuera del club, con su procedencia y en la dinámica', async () => {
    conJugadores([BRAIS])
    const hoja = await abrirAlta()
    await userEvent.click(within(hoja).getByRole('button', { name: 'Es de fuera del club' }))
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Antón')

    // Sin procedencia no se envía
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(await within(hoja).findByText('Indica de dónde viene')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([])

    await userEvent.click(within(hoja).getByRole('button', { name: 'A prueba' }))
    await userEvent.click(within(hoja).getByRole('switch', { name: /En la dinámica/ }))
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))

    await waitFor(() =>
      expect(enviado('POST /api/plantillas/p1/jugadores')).toEqual([
        {
          invitado: true,
          nombre: 'Antón',
          apellidos: null,
          procedencia: 'A prueba',
          enDinamica: true,
          dorsal: null,
          posicion: null,
        },
      ]),
    )
  })

  it('sin elegir a nadie avisa', async () => {
    conJugadores([BRAIS])
    const hoja = await abrirAlta()
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(
      within(hoja).getByText('Elige un jugador de otra plantilla o da de alta a alguien de fuera'),
    ).toBeInTheDocument()
  })

  it('al editar un invitado se cambia su dinámica', async () => {
    conJugadores([BRAIS, MATEO])
    manejadores['GET /api/clubes/c1/jugadores/j2'] = () =>
      json({
        id: 'j2',
        nombre: 'Mateo',
        apellidos: null,
        fichas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2026-27',
            dorsal: null,
            posicion: null,
            activo: true,
            tipo: 'invitado',
            enDinamica: false,
            procedencia: 'Juvenil A',
          },
        ],
      })
    manejadores['PATCH /api/plantillas/p1/jugadores/j2'] = async (peticion) =>
      json({ ...MATEO, ...(await peticion.json()) })
    abrir('/plantillas/p1/jugadores/j2')
    expect(await screen.findByText(/Invitado · Juvenil A · Solo partidos/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Editar' }))
    const hoja = screen.getByRole('dialog')
    await userEvent.click(within(hoja).getByRole('switch', { name: /En la dinámica/ }))
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(enviado('PATCH /api/plantillas/p1/jugadores/j2')).toEqual([
        { dorsal: null, posicion: null, enDinamica: true },
      ]),
    )
  })
})

describe('convocar a jugadores de otras plantillas', () => {
  const jugador = (jugadorId: string, nombre: string, extra = {}) => ({
    jugadorId,
    nombre,
    apellidos: null,
    dorsal: null,
    posicion: null,
    activo: true,
    tipo: 'propia' as const,
    procedencia: null,
    convocado: true,
    titular: null,
    minutos: null,
    ...extra,
  })
  const PARTIDO: Partido = {
    id: 'p1',
    rival: 'SD Compostela',
    competicion: 'Preferente',
    fecha: '2026-10-18',
    hora: '17:00',
    horaCitacion: '16:00',
    lugar: null,
    local: true,
    estado: 'programado',
    golesFavor: null,
    golesContra: null,
    eventos: [],
    acta: null,
    videos: [],
    jugadores: [
      jugador('j1', 'Brais'),
      jugador('j2', 'Mateo', { tipo: 'invitado', procedencia: 'Juvenil A' }),
    ],
  } as Partido

  it('los invitados salen marcados y se añaden más desde el buscador', async () => {
    conJugadores([BRAIS])
    manejadores['GET /api/plantillas/p1/partidos/p1'] = () => json(PARTIDO)
    manejadores['PUT /api/plantillas/p1/partidos/p1/convocados'] = () => json(PARTIDO)
    abrir('/plantillas/p1/partidos/p1/convocatoria')

    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).getAllByRole('listitem')[1]).toHaveTextContent(
      /Mateo.*Invitado.*Invitado · Juvenil A/,
    )

    await userEvent.click(await screen.findByRole('button', { name: /Xoel/ }))
    const externos = screen.getByRole('list', { name: 'Convocados de otras plantillas' })
    expect(externos).toHaveTextContent(/Xoel.*Senior B/)
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados de 3')
    // Ya elegido, no vuelve a salir en el buscador
    expect(
      within(screen.getByRole('list', { name: 'Jugadores de otras plantillas' })).queryByText(
        'Xoel',
      ),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria' }))
    await waitFor(() =>
      expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([
        { jugadores: ['j1', 'j2', 'j8'] },
      ]),
    )
  })
})
