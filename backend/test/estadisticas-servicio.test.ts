import { describe, expect, it } from 'vitest'
import {
  calcularMinutos,
  comprobar,
  type DatosEstadisticas,
  type Evento,
  type Participacion,
} from '../src/estadisticas.js'

// Reglas del servicio de estadísticas, sin base de datos: minutos jugados y coherencia del partido

const titular = (jugadorId: string): Participacion => ({ jugadorId, titular: true })
const suplente = (jugadorId: string): Participacion => ({ jugadorId, titular: false })
const ev = (
  tipo: Evento['tipo'],
  jugadorId: string | null,
  minuto: number | null = null,
): Evento => ({
  jugadorId,
  tipo,
  minuto,
})

const CONVOCADOS = new Set([
  'a',
  'b',
  'c',
  'd',
  'e',
  ...Array.from({ length: 12 }, (_, k) => `t${k}`),
])
const datos = (cambios: Partial<DatosEstadisticas>): DatosEstadisticas => ({
  resultado: null,
  participaciones: [titular('a'), titular('b'), suplente('c'), suplente('d')],
  eventos: [],
  ...cambios,
})

describe('minutos jugados', () => {
  it('titulares 90, quien entra desde su minuto y quien no entra 0', () => {
    const minutos = calcularMinutos(
      [titular('a'), titular('b'), suplente('c'), suplente('d')],
      [ev('sale', 'b', 59), ev('entra', 'c', 59)],
    )
    expect(Object.fromEntries(minutos)).toEqual({ a: 90, b: 59, c: 31, d: 0 })
  })

  it('una roja termina los minutos; el descuento no suma', () => {
    const minutos = calcularMinutos(
      [titular('a'), suplente('c')],
      [ev('roja', 'a', 81), ev('entra', 'c', 93)],
    )
    expect(Object.fromEntries(minutos)).toEqual({ a: 81, c: 0 })
  })

  it('quien entra y sale juega el tramo entre los dos', () => {
    const minutos = calcularMinutos([suplente('c')], [ev('entra', 'c', 46), ev('sale', 'c', 80)])
    expect(minutos.get('c')).toBe(34)
  })
})

describe('coherencia del partido', () => {
  it('un partido completo y coherente pasa', () => {
    const problema = comprobar(
      datos({
        resultado: { golesFavor: 2, golesContra: 1 },
        eventos: [
          ev('gol', 'a', 10),
          ev('asistencia', 'b', 10),
          ev('sale', 'b', 60),
          ev('entra', 'c', 60),
          ev('gol', 'c', 75),
          ev('amarilla', 'd', 80),
          ev('gol_propia', 'a', 85),
        ],
      }),
      CONVOCADOS,
    )
    expect(problema).toBeNull()
  })

  it('se pueden registrar goles sin titulares ni suplentes', () => {
    expect(
      comprobar(datos({ participaciones: [], eventos: [ev('gol', 'a')] }), CONVOCADOS),
    ).toBeNull()
  })

  it.each<[string, Partial<DatosEstadisticas>, RegExp]>([
    ['un jugador no convocado', { participaciones: [titular('z')] }, /convocados/],
    ['un jugador dos veces', { participaciones: [titular('a'), suplente('a')] }, /dos veces/],
    [
      'más de 11 titulares',
      { participaciones: Array.from({ length: 12 }, (_, k) => titular(`t${k}`)) },
      /11 titulares/,
    ],
    ['un evento sin jugador que no es gol en propia', { eventos: [ev('gol', null)] }, /jugador/],
    ['un cambio sin minuto', { eventos: [ev('entra', 'c')] }, /minuto/],
    [
      'cambios sin titulares ni suplentes',
      { participaciones: [], eventos: [ev('entra', 'c', 60)] },
      /titulares y los suplentes/,
    ],
    ['que entre un titular', { eventos: [ev('entra', 'a', 60)] }, /titular no puede entrar/],
    ['que entre dos veces', { eventos: [ev('entra', 'c', 50), ev('entra', 'c', 70)] }, /dos veces/],
    ['que salga quien no ha entrado', { eventos: [ev('sale', 'c', 70)] }, /está en el campo/],
    [
      'que salga antes de entrar',
      { eventos: [ev('entra', 'c', 70), ev('sale', 'c', 60)] },
      /está en el campo/,
    ],
    [
      'que un expulsado salga después',
      { eventos: [ev('roja', 'a', 30), ev('sale', 'a', 60)] },
      /expulsado/,
    ],
    ['un gol de un suplente que no entra', { eventos: [ev('gol', 'd', 50)] }, /en el campo/],
    [
      'un gol de quien ya ha salido',
      { eventos: [ev('sale', 'b', 60), ev('gol', 'b', 70)] },
      /en el campo/,
    ],
    ['más asistencias que goles', { eventos: [ev('asistencia', 'a', 10)] }, /asistencias/],
    [
      'más goles que el resultado',
      {
        resultado: { golesFavor: 1, golesContra: 0 },
        eventos: [ev('gol', 'a'), ev('gol_propia', null)],
      },
      /2 goles a favor/,
    ],
    [
      'más goles en propia que goles en contra',
      { resultado: { golesFavor: 0, golesContra: 0 }, eventos: [ev('gol_propia', 'a')] },
      /propia puerta/,
    ],
  ])('rechaza %s', (_, cambios, mensaje) => {
    expect(comprobar(datos(cambios), CONVOCADOS)).toMatch(mensaje)
  })
})
