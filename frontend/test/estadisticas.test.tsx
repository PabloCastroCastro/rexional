import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { EstadisticasJugador, EstadisticasPlantilla } from '../src/partidos/datos'
import { abrir, conDatos, json, manejadores, plantilla, senior26 } from './simulacion'

// Estadísticas de la temporada en Partidos y en la ficha del jugador

const fila = (
  jugadorId: string,
  nombre: string,
  dorsal: number,
  datos: Partial<EstadisticasJugador> = {},
): EstadisticasJugador => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  activo: true,
  partidos: 0,
  titularidades: 0,
  minutos: 0,
  goles: 0,
  asistencias: 0,
  amarillas: 0,
  rojas: 0,
  golesPropia: 0,
  ...datos,
})

const ESTADISTICAS: EstadisticasPlantilla = {
  equipo: { jugados: 6, ganados: 4, empatados: 1, perdidos: 1, golesFavor: 16, golesContra: 7 },
  jugadores: [
    fila('j1', 'Íker', 1, { partidos: 6, titularidades: 6, minutos: 540 }),
    fila('j2', 'Brais', 7, { partidos: 5, titularidades: 4, minutos: 410, goles: 2, amarillas: 3 }),
    fila('j3', 'Zoe', 9, {
      partidos: 6,
      titularidades: 6,
      minutos: 520,
      goles: 5,
      asistencias: 1,
      rojas: 1,
    }),
  ],
}

function conEstadisticas(p = senior26, estadisticas = ESTADISTICAS) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/estadisticas'] = () => json(estadisticas)
  manejadores['GET /api/plantillas/p1/partidos'] = () => json([])
}

const filas = (nombre: string) =>
  within(screen.getByRole('list', { name: nombre }))
    .getAllByRole('listitem')
    .map((li) => li.textContent)

describe('estadísticas de la temporada', () => {
  it('resultados del equipo y clasificaciones, solo con quien tiene algo', async () => {
    conEstadisticas()
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const resultados = await screen.findByRole('region', { name: 'Resultados' })
    expect(within(resultados).getByText('Ganados').nextSibling).toHaveTextContent('4')
    expect(resultados).toHaveTextContent('Goles: 16 a favor y 7 en contra (+9)')

    expect(filas('Goleadores')).toEqual(['9Dorsal 9Zoe5', '7Dorsal 7Brais2'])
    await userEvent.click(screen.getByRole('button', { name: 'Minutos' }))
    expect(filas('Minutos')).toEqual([
      "1Dorsal 1Íker540'",
      "9Dorsal 9Zoe520'",
      "7Dorsal 7Brais410'",
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Tarjetas' }))
    // Una roja pesa más que tres amarillas
    expect(filas('Tarjetas')).toEqual(['9Dorsal 9Zoe1 roja', '7Dorsal 7Brais3 amarillas'])
    await userEvent.click(screen.getByRole('button', { name: 'Asistencias' }))
    expect(screen.getByRole('link', { name: 'Zoe' })).toHaveAttribute(
      'href',
      '/plantillas/p1/jugadores/j3',
    )
  })

  it('sin partidos jugados lo explica', async () => {
    conEstadisticas(senior26, {
      equipo: { jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesFavor: 0, golesContra: 0 },
      jugadores: [],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    expect(await screen.findByText('Todavía no hay partidos jugados')).toBeInTheDocument()
  })

  it('un jugador ve los resultados y las suyas', async () => {
    conEstadisticas(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), {
      ...ESTADISTICAS,
      jugadores: [ESTADISTICAS.jugadores[1] as EstadisticasJugador],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const mias = await screen.findByRole('region', { name: 'Tus estadísticas' })
    expect(mias).toHaveTextContent("5 partidos (4 de titular) · 410' · 2 goles · 3 amarillas")
    expect(screen.queryByRole('button', { name: 'Goleadores' })).not.toBeInTheDocument()
  })
})

describe('ficha del jugador', () => {
  it('sus partidos en la plantilla y los números de cada temporada', async () => {
    conEstadisticas()
    manejadores['GET /api/plantillas/p1/jugadores'] = (peticion) =>
      json(
        new URL(peticion.url).searchParams.get('activos') === 'false'
          ? []
          : [
              {
                jugadorId: 'j3',
                nombre: 'Zoe',
                apellidos: null,
                dorsal: 9,
                posicion: null,
                activo: true,
              },
            ],
      )
    manejadores['GET /api/clubes/c1/jugadores/j3'] = () =>
      json({
        id: 'j3',
        nombre: 'Zoe',
        apellidos: null,
        fichas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2026-27',
            dorsal: 9,
            posicion: null,
            activo: true,
          },
          {
            plantillaId: 'p3',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2025-26',
            dorsal: 9,
            posicion: null,
            activo: true,
          },
        ],
      })
    const totales = {
      partidos: 0,
      titularidades: 0,
      minutos: 0,
      goles: 0,
      asistencias: 0,
      amarillas: 0,
      rojas: 0,
      golesPropia: 0,
    }
    manejadores['GET /api/clubes/c1/jugadores/j3/estadisticas'] = () =>
      json({
        jugadorId: 'j3',
        nombre: 'Zoe',
        apellidos: null,
        temporadas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            temporada: '2026-27',
            dorsal: 9,
            ...totales,
            partidos: 6,
            goles: 5,
          },
          { plantillaId: 'p3', plantilla: 'Senior', temporada: '2025-26', dorsal: 9, ...totales },
        ],
        totales: { ...totales, partidos: 6, goles: 5 },
      })
    abrir('/plantillas/p1/jugadores/j3')
    const partidos = await screen.findByRole('region', { name: 'Partidos en esta plantilla' })
    expect(partidos).toHaveTextContent(
      "6 partidos (6 de titular) · 520' · 5 goles · 1 asistencia · 1 roja",
    )
    const temporadas = screen.getByRole('region', { name: 'Temporadas en el club' })
    expect(await within(temporadas).findByText(/6 partidos · 5 goles/)).toBeInTheDocument()
    expect(temporadas).not.toHaveTextContent('0 partidos')
  })
})
