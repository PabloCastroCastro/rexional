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
  entrenos: 0,
  golesEncajados: 0,
  minutosConEncajados: 0,
  ...datos,
})

const ESTADISTICAS: EstadisticasPlantilla = {
  equipo: {
    jugados: 6,
    ganados: 4,
    empatados: 1,
    perdidos: 1,
    golesFavor: 16,
    golesContra: 7,
    sinMinutoEnContra: 0,
  },
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

  it('minutos por entreno: de más a menos, sin mínimo de minutos y sin entrenos al final', async () => {
    conEstadisticas(senior26, {
      ...ESTADISTICAS,
      jugadores: [
        fila('j1', 'Íker', 1, { partidos: 6, minutos: 540, entrenos: 29 }),
        fila('j2', 'Brais', 7, { partidos: 5, minutos: 340, entrenos: 9 }),
        fila('j3', 'Zoe', 9, { partidos: 1, minutos: 40, entrenos: 0 }),
        fila('j4', 'Noa', 13, { entrenos: 15 }),
        // Ni juega ni entrena: no sale
        fila('j5', 'Leo', 20),
      ],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    await userEvent.click(await screen.findByRole('button', { name: 'Minutos por entreno' }))
    expect(filas('Minutos por entreno')).toEqual([
      "7Dorsal 7Brais · 340' en 9 entrenos37,8",
      "1Dorsal 1Íker · 540' en 29 entrenos18,6",
      "13Dorsal 13Noa · 0' en 15 entrenos0,0",
      "9Dorsal 9Zoe · 40' en 0 entrenos—",
    ])
  })

  it('goles en contra: de menos a más por 90, con los mismos primero quien más juega, y el aviso de los partidos sin minuto', async () => {
    conEstadisticas(senior26, {
      equipo: { ...ESTADISTICAS.equipo, sinMinutoEnContra: 2 },
      jugadores: [
        fila('j1', 'Íker', 1, { minutos: 630, golesEncajados: 5, minutosConEncajados: 630 }),
        fila('j2', 'Brais', 7, { minutos: 302, golesEncajados: 1, minutosConEncajados: 302 }),
        fila('j3', 'Zoe', 9, { minutos: 40, golesEncajados: 0, minutosConEncajados: 40 }),
        fila('j4', 'Noa', 13, { minutos: 90, golesEncajados: 0, minutosConEncajados: 90 }),
        // Solo jugó partidos sin el minuto de los goles en contra: no sale
        fila('j5', 'Leo', 20, { minutos: 90 }),
      ],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    await userEvent.click(await screen.findByRole('button', { name: 'Goles en contra' }))
    expect(filas('Goles en contra')).toEqual([
      "13Dorsal 13Noa · 0 en 90'0,00",
      "9Dorsal 9Zoe · 0 en 40'0,00",
      "7Dorsal 7Brais · 1 en 302'0,30",
      "1Dorsal 1Íker · 5 en 630'0,71",
    ])
    expect(screen.getByRole('note')).toHaveTextContent(
      '2 partidos no cuentan: les falta el minuto de algún gol en contra.',
    )
  })

  it('goles en contra sin ningún partido con el minuto lo explica', async () => {
    conEstadisticas(senior26, {
      ...ESTADISTICAS,
      equipo: { ...ESTADISTICAS.equipo, sinMinutoEnContra: 6 },
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    await userEvent.click(await screen.findByRole('button', { name: 'Goles en contra' }))
    expect(
      screen.getByText('Todavía no hay partidos con el minuto de los goles en contra.'),
    ).toBeInTheDocument()
  })

  it('minutos por entreno sin haber pasado lista lo explica', async () => {
    conEstadisticas()
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    await userEvent.click(await screen.findByRole('button', { name: 'Minutos por entreno' }))
    expect(screen.getByText('Todavía no se ha pasado lista en ningún entreno.')).toBeInTheDocument()
  })

  it('sin partidos jugados lo explica', async () => {
    conEstadisticas(senior26, {
      equipo: {
        jugados: 0,
        ganados: 0,
        empatados: 0,
        perdidos: 0,
        golesFavor: 0,
        golesContra: 0,
        sinMinutoEnContra: 0,
      },
      jugadores: [],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    expect(await screen.findByText('Todavía no hay partidos jugados')).toBeInTheDocument()
  })

  it('un jugador ve los resultados y las suyas', async () => {
    conEstadisticas(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), {
      ...ESTADISTICAS,
      jugadores: [
        {
          ...(ESTADISTICAS.jugadores[1] as EstadisticasJugador),
          entrenos: 20,
          golesEncajados: 3,
          minutosConEncajados: 300,
        },
      ],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const mias = await screen.findByRole('region', { name: 'Tus estadísticas' })
    expect(mias).toHaveTextContent("5 partidos (4 de titular) · 410' · 2 goles · 3 amarillas")
    expect(mias).toHaveTextContent("20,5 minutos por entreno (410' en 20 entrenos)")
    expect(mias).toHaveTextContent("0,90 goles en contra por 90' con él en el campo (3 en 300')")
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
