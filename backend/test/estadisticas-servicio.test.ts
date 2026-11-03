import { describe, expect, it } from 'vitest'
import {
  calcularAFavor,
  calcularEncajados,
  calcularMinutos,
  comprobar,
  type DatosEstadisticas,
  type Evento,
  minutosDeGoles,
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

describe('goles encajados en el campo', () => {
  const lista = [titular('a'), titular('b'), suplente('c'), suplente('d')]

  it('cada gol en contra cuenta para quien está en el campo; en el minuto del cambio, para quien sale', () => {
    const encajados = calcularEncajados(
      lista,
      [
        ev('gol_rival', null, 20),
        ev('sale', 'b', 65),
        ev('entra', 'c', 65),
        ev('gol_rival', null, 65),
        ev('gol_propia', 'a', 80),
        // El descuento cuenta: sigue en el campo
        ev('gol_rival', null, 92),
      ],
      4,
    )
    expect(Object.fromEntries(encajados ?? [])).toEqual({ a: 4, b: 2, c: 2, d: 0 })
  })

  it('una roja termina el tramo, como un cambio', () => {
    const encajados = calcularEncajados(
      [titular('a'), titular('b')],
      [ev('roja', 'b', 30), ev('gol_rival', null, 30), ev('gol_rival', null, 31)],
      2,
    )
    expect(Object.fromEntries(encajados ?? [])).toEqual({ a: 2, b: 1 })
  })

  it('sin goles en contra, todos a cero', () => {
    expect(Object.fromEntries(calcularEncajados(lista, [], 0) ?? [])).toEqual({
      a: 0,
      b: 0,
      c: 0,
      d: 0,
    })
  })

  it.each<[string, Evento[], number]>([
    ['faltan goles en contra por registrar', [ev('gol_rival', null, 20)], 2],
    ['un gol en contra sin minuto', [ev('gol_rival', null)], 1],
    // Un gol en propia del rival es a favor: no suple a uno en contra
    ['un gol en propia del rival', [ev('gol_propia', null, 10)], 1],
  ])('no se sabe si %s', (_, eventos, golesContra) => {
    expect(calcularEncajados(lista, eventos, golesContra)).toBeNull()
  })
})

describe('goles a favor en el campo', () => {
  const lista = [titular('a'), titular('b'), suplente('c')]

  it('los nuestros y los del rival en propia, para quien está en el campo; en el cambio, para quien sale', () => {
    const aFavor = calcularAFavor(
      lista,
      [
        ev('gol', 'a', 5),
        ev('sale', 'b', 60),
        ev('entra', 'c', 60),
        ev('gol', 'c', 60),
        ev('gol_propia', null, 75),
        // Los del rival no cuentan
        ev('gol_rival', null, 80),
        ev('gol_propia', 'a', 85),
      ],
      3,
    )
    expect(Object.fromEntries(aFavor ?? [])).toEqual({ a: 3, b: 2, c: 1 })
  })

  it.each<[string, Evento[], number]>([
    ['faltan goles a favor por registrar', [ev('gol', 'a', 20)], 2],
    ['un gol a favor sin minuto', [ev('gol', 'a')], 1],
    ['un gol en propia nuestro', [ev('gol_propia', 'a', 10)], 1],
  ])('no se sabe si %s', (_, eventos, golesFavor) => {
    expect(calcularAFavor(lista, eventos, golesFavor)).toBeNull()
  })
})

describe('goles por minuto del equipo', () => {
  it('separa a favor y en contra, de menor a mayor, y cuenta los del resultado sin minuto', () => {
    const eventos = [
      ev('gol', 'a', 80),
      ev('gol_propia', null, 12),
      ev('asistencia', 'b', 80),
      ev('gol_rival', null, 45),
      ev('gol_propia', 'b', null),
      ev('gol_rival', null, 3),
      ev('amarilla', 'a', 30),
    ]
    expect(minutosDeGoles(eventos, 3, 4)).toEqual({
      aFavor: [12, 80],
      enContra: [3, 45],
      aFavorSinMinuto: 1,
      enContraSinMinuto: 2,
    })
  })

  it('sin eventos, todos los goles del resultado van sin minuto', () => {
    expect(minutosDeGoles([], 2, 1)).toEqual({
      aFavor: [],
      enContra: [],
      aFavorSinMinuto: 2,
      enContraSinMinuto: 1,
    })
  })
})

describe('coherencia del partido', () => {
  it('un partido completo y coherente pasa', () => {
    const problema = comprobar(
      datos({
        resultado: { golesFavor: 2, golesContra: 2 },
        eventos: [
          ev('gol', 'a', 10),
          ev('asistencia', 'b', 10),
          ev('gol_rival', null, 30),
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
    ['un gol del rival con jugador', { eventos: [ev('gol_rival', 'a', 30)] }, /no lleva jugador/],
    [
      'más goles del rival y en propia que goles en contra',
      {
        resultado: { golesFavor: 0, golesContra: 2 },
        eventos: [ev('gol_rival', null, 10), ev('gol_rival', null, 50), ev('gol_propia', 'a', 70)],
      },
      /3 goles en contra/,
    ],
  ])('rechaza %s', (_, cambios, mensaje) => {
    expect(comprobar(datos(cambios), CONVOCADOS)).toMatch(mensaje)
  })
})
