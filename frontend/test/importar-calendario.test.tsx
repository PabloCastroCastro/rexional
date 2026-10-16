import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CalendarioLeido } from '../src/partidos/calendario'
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

// Importar el calendario de la competición en PDF. Hoy es el 16 de octubre de 2026 (solo se simula
// la fecha): las jornadas de septiembre ya pasaron

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-16T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const LEIDO: CalendarioLeido = {
  competicion: 'PRIMERA INVENTADA | GRUPO 9',
  temporada: '2026-2027',
  equipos: ['ATLÉTICO PRADO "B"', 'C.D. RÍO VERDE', 'REXIONAL S.D.'],
  equipo: 'REXIONAL S.D.',
  jornadas: [
    {
      numero: 1,
      fecha: '2026-09-13',
      enfrentamientos: [{ local: 'REXIONAL S.D.', visitante: 'C.D. RÍO VERDE' }],
      descansa: 'ATLÉTICO PRADO "B"',
    },
    {
      numero: 2,
      fecha: '2026-10-18',
      enfrentamientos: [{ local: 'ATLÉTICO PRADO "B"', visitante: 'REXIONAL S.D.' }],
      descansa: 'C.D. RÍO VERDE',
    },
    {
      numero: 3,
      fecha: '2026-10-25',
      enfrentamientos: [{ local: 'C.D. RÍO VERDE', visitante: 'ATLÉTICO PRADO "B"' }],
      descansa: 'REXIONAL S.D.',
    },
    {
      numero: 4,
      fecha: '2026-11-01',
      enfrentamientos: [{ local: 'C.D. RÍO VERDE', visitante: 'REXIONAL S.D.' }],
      descansa: 'ATLÉTICO PRADO "B"',
    },
  ],
  // La jornada 2 ya está apuntada a mano, el sábado y con el nombre a su manera
  existentes: [{ fecha: '2026-10-17', rival: 'Atlético Prado B' }],
}

const LEER = 'POST /api/plantillas/p1/partidos/calendario/leer'
const IMPORTAR = 'POST /api/plantillas/p1/partidos/calendario'
const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const pdf = () => new File(['%PDF-1.4'], 'Calendario.pdf', { type: 'application/pdf' })
const partidos = () =>
  within(screen.getByRole('list', { name: 'Partidos del calendario' })).getAllByRole('listitem')

describe('importar el calendario', () => {
  it('lee el PDF, propone los partidos que faltan y crea los elegidos', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/partidos'] = () => json([])
    manejadores[LEER] = () => json(LEIDO)
    manejadores[IMPORTAR] = () => json({ creados: 2, omitidos: [] })
    const router = abrir('/plantillas/p1/partidos')
    await userEvent.click(await screen.findByRole('link', { name: 'Importar calendario' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/calendario'))

    await userEvent.upload(screen.getByLabelText('Archivo del calendario en PDF'), pdf())
    expect(await screen.findByLabelText('Tu equipo')).toHaveValue('REXIONAL S.D.')
    expect(enviado(LEER)[0]).toMatch(/name="archivo"/)
    expect(screen.getByText(/PRIMERA INVENTADA \| GRUPO 9 · Temporada 2026-2027/)).toBeVisible()

    const filas = partidos()
    expect(filas.map((f) => f.textContent)).toEqual([
      expect.stringMatching(/^vs C\.D\. RÍO VERDEJornada 1 · .* · Casa · Ya pasó$/),
      expect.stringMatching(/^en ATLÉTICO PRADO "B"Jornada 2 · .* · Fuera · Ya está$/),
      expect.stringMatching(/^Jornada 3 · .* · Descansa$/),
      expect.stringMatching(/^en C\.D\. RÍO VERDEJornada 4 · .* · Fuera$/),
    ])
    // Solo la jornada 4 de entrada: la 1 ya pasó y la 2 ya está
    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 partidos elegidos')
    expect(within(filas[3] as HTMLElement).getByRole('checkbox')).toBeChecked()
    expect(within(filas[2] as HTMLElement).queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(within(filas[0] as HTMLElement).getByRole('checkbox'))

    await userEvent.click(screen.getByRole('button', { name: 'Crear 2 partidos' }))
    expect(await screen.findByText('Se han creado 2 partidos')).toBeInTheDocument()
    expect(enviado(IMPORTAR)).toEqual([
      {
        partidos: [
          { fecha: '2026-09-13', rival: 'C.D. RÍO VERDE', local: true },
          { fecha: '2026-11-01', rival: 'C.D. RÍO VERDE', local: false },
        ],
      },
    ])
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos'))
  })

  it('si no reconoce el equipo, se elige; y al cambiarlo cambian los partidos', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores[LEER] = () => json({ ...LEIDO, equipo: null, existentes: [] })
    abrir('/plantillas/p1/partidos/calendario')
    await userEvent.upload(await screen.findByLabelText('Archivo del calendario en PDF'), pdf())
    const equipo = await screen.findByLabelText('Tu equipo')
    expect(equipo).toHaveValue('')
    expect(screen.queryByRole('list', { name: 'Partidos del calendario' })).not.toBeInTheDocument()
    await userEvent.selectOptions(equipo, 'C.D. RÍO VERDE')
    expect(partidos().map((f) => f.textContent?.split('Jornada')[0])).toEqual([
      'en REXIONAL S.D.',
      '',
      'vs ATLÉTICO PRADO "B"',
      'vs REXIONAL S.D.',
    ])
    expect(screen.getByRole('status')).toHaveTextContent('2 de 3 partidos elegidos')
  })

  it('explica por qué no se puede leer', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores[LEER] = () =>
      json(
        {
          error: {
            codigo: 'calendario_no_legible',
            mensaje: 'No parece un calendario de la federación: no tiene jornadas',
          },
        },
        400,
      )
    abrir('/plantillas/p1/partidos/calendario')
    await userEvent.upload(await screen.findByLabelText('Archivo del calendario en PDF'), pdf())
    expect(await screen.findByRole('alert')).toHaveTextContent('no tiene jornadas')
  })

  it('un jugador no ve el botón ni la página', async () => {
    conDatos({
      plantillas: [plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false })],
    })
    manejadores['GET /api/plantillas/p1/partidos'] = () => json([])
    const router = abrir('/plantillas/p1/partidos/calendario')
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos'))
    expect(await screen.findByText('No hay partidos próximos')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Importar calendario' })).not.toBeInTheDocument()
  })
})
