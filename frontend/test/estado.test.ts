import { describe, expect, it } from 'vitest'
import { estadoJugador } from '../src/jugadores/estado'

// El estado que se marca sobre el dorsal (GH-251)
describe('estado del jugador', () => {
  const lesion = { desde: '2026-11-03', vueltaPrevista: '2026-11-17' }
  const sanciones = (partidos: number, apercibido = false) => ({
    jugadorId: 'j1',
    sanciones: [],
    pendientes: partidos ? [{ competicion: 'Preferente', partidos }] : [],
    apercibido: apercibido ? [{ competicion: 'Preferente', amarillas: 4 }] : [],
  })

  it('sin nada, no hay estado', () => {
    expect(estadoJugador({})).toBeNull()
    expect(estadoJugador({ lesion: null, sancion: null })).toBeNull()
  })

  it('la sanción manda sobre la lesión y el apercibimiento', () => {
    expect(estadoJugador({ lesion, sanciones: sanciones(2, true) }, '2026-11-03')).toEqual({
      tipo: 'sancion',
      texto: 'Sancionado · 2 partidos',
    })
    expect(estadoJugador({ lesion, sancion: { partidos: 1 } }, '2026-11-03')).toEqual({
      tipo: 'sancion',
      texto: 'Sancionado · 1 partido',
    })
  })

  it('la lesión manda sobre el apercibimiento, con cuándo vuelve', () => {
    expect(estadoJugador({ lesion, sanciones: sanciones(0, true) }, '2026-11-03')).toEqual({
      tipo: 'lesion',
      texto: 'Lesionado · vuelve en 2 semanas',
    })
  })

  it('apercibido, si no hay nada más', () => {
    expect(estadoJugador({ sanciones: sanciones(0, true) })).toEqual({
      tipo: 'apercibido',
      texto: 'Apercibido',
    })
  })
})
