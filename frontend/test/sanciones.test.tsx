import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import type { SancionesJugador } from '../src/jugadores/Sanciones'
import { abrir, conDatos, json, manejadores, peticiones, plantilla, senior26 } from './simulacion'

// Sanciones de los jugadores en la ficha y en la plantilla (GH-231)

const jugador = (jugadorId: string, nombre: string, dorsal: number): JugadorPlantilla => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: 'defensa',
  activo: true,
  tipo: 'propia',
  enDinamica: true,
  procedencia: null,
  lesion: null,
})

const SANCIONADO: SancionesJugador = {
  jugadorId: 'j1',
  pendientes: [{ competicion: 'Preferente', partidos: 1 }],
  apercibido: [],
  sanciones: [
    {
      partidoId: 'p9',
      rival: 'CD Barco',
      fecha: '2026-10-04',
      competicion: 'Preferente',
      tipo: 'roja',
      calculados: 1,
      partidos: 1,
      cumplidos: 0,
      ajustada: false,
      nota: null,
    },
  ],
}

const APERCIBIDO: SancionesJugador = {
  jugadorId: 'j2',
  pendientes: [],
  apercibido: [{ competicion: 'Preferente', amarillas: 4 }],
  sanciones: [],
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

function conSanciones(p = senior26) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/jugadores'] = () =>
    json([jugador('j1', 'Brais', 7), jugador('j2', 'Zoe', 9), jugador('j3', 'Íker', 1)])
  manejadores['GET /api/clubes/c1/jugadores/j1'] = () =>
    json({
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
          posicion: 'defensa',
          activo: true,
          tipo: 'propia',
          enDinamica: true,
          procedencia: null,
        },
      ],
    })
  let actuales = [SANCIONADO, APERCIBIDO]
  manejadores['GET /api/plantillas/p1/sanciones'] = () => json({ jugadores: actuales })
  manejadores['PUT /api/plantillas/p1/sanciones/ajuste'] = async (peticion) => {
    const { partidos, nota } = (await peticion.json()) as { partidos: number; nota: string | null }
    const sancion = { ...(SANCIONADO.sanciones[0] as SancionesJugador['sanciones'][number]) }
    actuales = [
      {
        ...SANCIONADO,
        pendientes: [{ competicion: 'Preferente', partidos }],
        sanciones: [{ ...sancion, partidos, ajustada: true, nota }],
      },
      APERCIBIDO,
    ]
    return json({ jugadores: actuales })
  }
}

describe('sanciones', () => {
  it('en la plantilla, la marca de sancionado o apercibido junto a la posición', async () => {
    conSanciones()
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    await waitFor(() =>
      expect(
        within(lista)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual([
        expect.stringContaining('Defensa · Sancionado'),
        expect.stringContaining('Defensa · Apercibido'),
        expect.not.stringMatching(/Sancionado|Apercibido/),
      ]),
    )
  })

  it('en la ficha, lo que le queda y por qué; el cuerpo técnico lo corrige', async () => {
    conSanciones()
    abrir('/plantillas/p1/jugadores/j1')
    const franja = await screen.findByRole('region', { name: 'Sanción' })
    expect(franja).toHaveTextContent('Sancionado · 1 partido en Preferente')
    expect(franja).toHaveTextContent('Por roja directa vs CD Barco (4 oct)')

    await userEvent.click(
      within(franja).getByRole('button', {
        name: 'Corregir la sanción por roja directa vs CD Barco',
      }),
    )
    const hoja = screen.getByRole('dialog', { name: 'Corregir la sanción' })
    const partidos = within(hoja).getByLabelText('Partidos de sanción')
    await userEvent.clear(partidos)
    await userEvent.type(partidos, '3')
    await userEvent.type(within(hoja).getByLabelText('Nota (opcional)'), 'Comité')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Sanción corregida')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/sanciones/ajuste')).toEqual([
      { partidoId: 'p9', jugadorId: 'j1', tipo: 'roja', partidos: 3, nota: 'Comité' },
    ])
    expect(await screen.findByRole('region', { name: 'Sanción' })).toHaveTextContent(
      'Sancionado · 3 partidos en Preferente',
    )
  })

  it('el rol jugador la ve, pero no la corrige', async () => {
    conSanciones(
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false, jugadorId: 'j1' }),
    )
    abrir('/plantillas/p1/jugadores/j1')
    const franja = await screen.findByRole('region', { name: 'Sanción' })
    expect(franja).toHaveTextContent('Sancionado · 1 partido en Preferente')
    expect(within(franja).queryByRole('button')).not.toBeInTheDocument()
  })
})
