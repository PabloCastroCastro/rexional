import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AsistenciaJugador, ResumenEntreno } from '../src/entrenos/datos'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import { abrir, conDatos, json, manejadores, plantilla, senior26 } from './simulacion'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const HISTORIAL: ResumenEntreno[] = [
  {
    id: 'e1',
    fecha: '2026-10-13',
    hora: null,
    horaFin: null,
    deHorario: true,
    asiste: 12,
    justificada: 1,
    falta: 2,
  },
  {
    id: 'e2',
    fecha: '2026-10-01',
    hora: null,
    horaFin: null,
    deHorario: true,
    asiste: 10,
    justificada: 0,
    falta: 3,
  },
  {
    id: 'e3',
    fecha: '2026-09-29',
    hora: null,
    horaFin: null,
    deHorario: true,
    asiste: 14,
    justificada: 1,
    falta: 0,
  },
]

// El historial pide hasta hoy y los próximos desde mañana: la API simulada filtra igual
const historialSimulado = (peticion: Request, proximos: ResumenEntreno[] = []) => {
  const consulta = new URL(peticion.url).searchParams
  const desde = consulta.get('desde')
  if (desde && desde === consulta.get('hasta'))
    return json(HISTORIAL.filter((e) => e.fecha === desde))
  return json(desde ? proximos : HISTORIAL)
}

const resumen = (
  jugadorId: string,
  nombre: string,
  asiste: number,
  justificada: number,
  falta: number,
): AsistenciaJugador => {
  const total = asiste + justificada + falta
  return {
    jugadorId,
    nombre,
    apellidos: null,
    activo: true,
    asiste,
    justificada,
    falta,
    porcentaje: total ? Math.round((100 * asiste) / total) : null,
  }
}

const ficha = (jugadorId: string, nombre: string, dorsal: number): JugadorPlantilla => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: null,
  activo: true,
})

describe('historial de entrenos', () => {
  it('agrupa por mes, del más reciente al más antiguo, con los recuentos', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/entrenos'] = historialSimulado
    abrir('/plantillas/p1/entrenos/historial')

    const octubre = await screen.findByRole('region', { name: 'octubre de 2026' })
    const enlaces = within(octubre).getAllByRole('link')
    expect(enlaces.map((a) => a.textContent)).toEqual([
      expect.stringMatching(/Ayer · martes, 13 oct.*12 asisten.*1 justificadas.*2 faltan/),
      expect.stringMatching(/jueves, 1 oct.*10 asisten/),
    ])
    expect(
      within(screen.getByRole('region', { name: 'septiembre de 2026' })).getAllByRole('link'),
    ).toHaveLength(1)
  })

  it('cada entreno abre ese día en pasar lista', async () => {
    conDatos({ plantillas: [senior26] })
    // El historial pide hasta hoy; pasar lista, los entrenos de un día
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) => {
      const desde = new URL(peticion.url).searchParams.get('desde')
      return json(desde ? HISTORIAL.filter((e) => e.fecha === desde) : HISTORIAL)
    }
    manejadores['GET /api/plantillas/p1/entrenos/e2'] = () =>
      json({
        id: 'e2',
        fecha: '2026-10-01',
        hora: null,
        deHorario: true,
        recuentos: { asiste: 10, justificada: 0, falta: 3 },
        jugadores: [],
      })
    const router = abrir('/plantillas/p1/entrenos/historial')
    await userEvent.click(await screen.findByRole('link', { name: /jueves, 1 oct/ }))
    expect(await screen.findByText('jueves, 1 oct')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/plantillas/p1/entrenos')
    expect(router.state.location.search).toBe('?fecha=2026-10-01&entreno=e2')
    expect(screen.getByRole('link', { name: 'Pasar lista' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('las pestañas cambian entre pasar lista e historial', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/entrenos'] = () => json([])
    abrir('/plantillas/p1/entrenos')
    const pestanas = await screen.findByRole('navigation', { name: 'Entrenos' })
    await userEvent.click(within(pestanas).getByRole('link', { name: 'Historial' }))
    expect(await screen.findByText('Todavía no hay entrenos')).toBeInTheDocument()
  })

  it('sin entrenos invita a fijar el horario solo a quien puede', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/entrenos'] = () => json([])
    abrir('/plantillas/p1/entrenos/historial')
    expect(await screen.findByRole('link', { name: 'Fijar el horario' })).toHaveAttribute(
      'href',
      '/plantillas/p1/entrenos/horario',
    )
  })

  it('el rol jugador ve el estado vacío sin la invitación', async () => {
    conDatos({
      plantillas: [plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false })],
    })
    manejadores['GET /api/plantillas/p1/entrenos'] = () => json([])
    abrir('/plantillas/p1/entrenos/historial')
    expect(await screen.findByText('Todavía no hay entrenos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Fijar el horario' })).not.toBeInTheDocument()
  })
})

describe('asistencia en la plantilla', () => {
  it('muestra el porcentaje de cada jugador, o una raya si no tiene registros', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/jugadores'] = () =>
      json([ficha('j1', 'Íker', 1), ficha('j2', 'Brais', 7), ficha('j3', 'Zoe', 9)])
    manejadores['GET /api/plantillas/p1/asistencia/resumen'] = () =>
      json([
        resumen('j1', 'Íker', 9, 1, 0),
        resumen('j2', 'Brais', 6, 1, 3),
        resumen('j3', 'Zoe', 0, 0, 0),
      ])
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(await within(lista).findByText(/90 %/)).toBeInTheDocument()
    const filas = within(lista)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(filas).toEqual([
      expect.stringMatching(/Íker.*90 % de asistencia/),
      expect.stringMatching(/Brais.*60 % de asistencia/),
      expect.stringMatching(/Zoe.*Sin asistencia registrada/),
    ])
  })

  it('el rol jugador solo ve su porcentaje (la API no envía el de los demás)', async () => {
    conDatos({
      plantillas: [plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false })],
    })
    manejadores['GET /api/plantillas/p1/jugadores'] = () =>
      json([ficha('j1', 'Íker', 1), ficha('j2', 'Brais', 7)])
    manejadores['GET /api/plantillas/p1/asistencia/resumen'] = () =>
      json([resumen('j2', 'Brais', 8, 0, 2)])
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(await within(lista).findByText(/80 %/)).toBeInTheDocument()
    const [iker] = within(lista).getAllByRole('listitem')
    expect(iker).not.toHaveTextContent(/%|Sin asistencia/)
  })

  it('la ficha del jugador muestra su asistencia en la plantilla', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/clubes/c1/jugadores/j2'] = () =>
      json({
        id: 'j2',
        nombre: 'Brais',
        fichas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2026-27',
            dorsal: 7,
            posicion: null,
            activo: true,
          },
        ],
      })
    manejadores['GET /api/plantillas/p1/asistencia/resumen'] = () =>
      json([resumen('j2', 'Brais', 6, 1, 3)])
    abrir('/plantillas/p1/jugadores/j2')
    const bloque = await screen.findByRole('region', { name: 'Asistencia en esta plantilla' })
    expect(bloque).toHaveTextContent('60 % de asistencia')
    expect(bloque).toHaveTextContent('6 asistencias · 1 justificada · 3 faltas')
  })
})
