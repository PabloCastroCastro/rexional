import { afterAll, describe, expect, it } from 'vitest'
import { pool } from '../src/db/cliente.js'
import {
  type Ajuste,
  calcularSanciones,
  estadoDeJugadores,
  normalizarCompeticion,
  type PartidoSancion,
  type Reglas,
  sinJornada,
  type Tarjeta,
} from '../src/sanciones.js'

// El cálculo de las sanciones (GH-231), sin base de datos

afterAll(() => pool.end())

const REGLAS: Reglas = { amarillasCiclo: 5, partidosRoja: 1, partidosDobleAmarilla: 1 }

let n = 0
const partido = (fecha: string, extra: Partial<PartidoSancion> = {}): PartidoSancion => ({
  id: `p${++n}`,
  rival: `Rival ${n}`,
  fecha,
  hora: null,
  competicion: 'Preferente',
  estado: 'jugado',
  createdAt: new Date(`${fecha}T10:00:00Z`),
  ...extra,
})

const amarilla = (p: PartidoSancion, jugadorId = 'j1'): Tarjeta => ({
  partidoId: p.id,
  jugadorId,
  tipo: 'amarilla',
})
const roja = (p: PartidoSancion, jugadorId = 'j1'): Tarjeta => ({
  partidoId: p.id,
  jugadorId,
  tipo: 'roja',
})

// Una jornada por semana desde el 6 de septiembre
const jornadas = (cuantas: number, extra: Partial<PartidoSancion> = {}) =>
  Array.from({ length: cuantas }, (_, i) => {
    const dia = new Date(Date.UTC(2026, 8, 6 + 7 * i)).toISOString().slice(0, 10)
    return partido(dia, extra)
  })

const debeAntes = (calculo: ReturnType<typeof calcularSanciones>, p: PartidoSancion) =>
  calculo.antesDe.get(p.id)?.get('j1') ?? 0

describe('cálculo de sanciones', () => {
  it('una roja directa: un partido, que se cumple en el siguiente de la competición', () => {
    const [j1, j2, j3] = jornadas(3) as [PartidoSancion, PartidoSancion, PartidoSancion]
    const c = calcularSanciones([j1, j2, j3], [roja(j1)], REGLAS, [])
    expect(c.sanciones).toEqual([
      expect.objectContaining({ tipo: 'roja', partidos: 1, cumplidos: 1, partidoId: j1.id }),
    ])
    expect(debeAntes(c, j2)).toBe(1)
    expect(debeAntes(c, j3)).toBe(0)
    expect(c.debe.get('j1')).toBeUndefined()
  })

  it('amarilla y roja, o dos amarillas, son doble amarilla y no cuentan para el ciclo', () => {
    const [j1, j2, j3] = jornadas(3) as [PartidoSancion, PartidoSancion, PartidoSancion]
    const c = calcularSanciones(
      [j1, j2, j3],
      [amarilla(j1), roja(j1), amarilla(j2, 'j2'), amarilla(j2, 'j2')],
      REGLAS,
      [],
    )
    expect(c.sanciones.map((s) => [s.jugadorId, s.tipo])).toEqual([
      ['j1', 'doble_amarilla'],
      ['j2', 'doble_amarilla'],
    ])
    expect(c.ciclo.get('j1')).toBeUndefined()
  })

  it('la quinta amarilla de la competición sanciona; con cuatro está apercibido', () => {
    const lista = jornadas(7)
    const tarjetas = lista.slice(0, 4).map((p) => amarilla(p))
    const cuatro = calcularSanciones(lista, tarjetas, REGLAS, [])
    expect(cuatro.sanciones).toEqual([])
    expect(estadoDeJugadores(cuatro, REGLAS)).toEqual([
      expect.objectContaining({ apercibido: [{ competicion: 'Preferente', amarillas: 4 }] }),
    ])

    const cinco = calcularSanciones(
      lista,
      [...tarjetas, amarilla(lista[4] as PartidoSancion)],
      REGLAS,
      [],
    )
    expect(cinco.sanciones).toEqual([
      expect.objectContaining({ tipo: 'ciclo', partidoId: lista[4]?.id, cumplidos: 1 }),
    ])
    expect(debeAntes(cinco, lista[5] as PartidoSancion)).toBe(1)
    // El ciclo vuelve a empezar
    expect(estadoDeJugadores(cinco, REGLAS)[0]?.apercibido).toEqual([])
  })

  it('la jornada que añade el acta no separa la competición', () => {
    expect(sinJornada('TERCEIRA PROBA (GRUPO 1) · Jornada 5')).toBe('TERCEIRA PROBA (GRUPO 1)')
    expect(normalizarCompeticion('Preferente · Jornada 12')).toBe(
      normalizarCompeticion('Preferente'),
    )
    const j5 = partido('2026-09-06', { competicion: 'Preferente · Jornada 5' })
    const j6 = partido('2026-09-13', { competicion: 'Preferente · Jornada 6' })
    const c = calcularSanciones([j5, j6], [roja(j5)], REGLAS, [])
    expect(debeAntes(c, j6)).toBe(1)
    expect(c.sanciones[0]?.competicion).toBe('Preferente')
  })

  it('cada competición va aparte, y la copa no cumple la sanción de la liga', () => {
    const liga1 = partido('2026-09-06')
    const copa = partido('2026-09-09', { competicion: 'Copa da Deputación' })
    const liga2 = partido('2026-09-13')
    const c = calcularSanciones([liga1, copa, liga2], [roja(liga1)], REGLAS, [])
    expect(debeAntes(c, copa)).toBe(0)
    expect(debeAntes(c, liga2)).toBe(1)
  })

  it('competiciones escritas distinto son la misma; sin competición es amistoso', () => {
    expect(normalizarCompeticion('  Preferente ·  Grupo 2 ')).toBe(
      normalizarCompeticion('preferente · grupo 2'),
    )
    expect(normalizarCompeticion('Promoción')).toBe(normalizarCompeticion('promocion'))
    const amistoso = partido('2026-09-06', { competicion: null })
    const liga = partido('2026-09-13')
    const c = calcularSanciones([amistoso, liga], [roja(amistoso)], REGLAS, [])
    expect(c.sanciones).toEqual([])
  })

  it('los aplazados y los programados no cumplen; el próximo programado sale sancionado', () => {
    const j1 = partido('2026-09-06')
    const aplazado = partido('2026-09-13', { estado: 'aplazado' })
    const proximo = partido('2026-09-20', { estado: 'programado' })
    const c = calcularSanciones([j1, aplazado, proximo], [roja(j1)], REGLAS, [])
    expect(debeAntes(c, proximo)).toBe(1)
    expect(c.debe.get('j1')?.get('preferente')).toBe(1)
  })

  it('las sanciones se acumulan y se cumplen una detrás de otra', () => {
    const lista = jornadas(5)
    const [j1, j2, j3, j4, j5] = lista as [
      PartidoSancion,
      PartidoSancion,
      PartidoSancion,
      PartidoSancion,
      PartidoSancion,
    ]
    // Roja de 2 partidos en la 1.ª (ajuste del comité) y otra roja en la 2.ª (jugó sancionado)
    const ajustes: Ajuste[] = [
      { partidoId: j1.id, jugadorId: 'j1', tipo: 'roja', partidos: 2, nota: 'Comité' },
    ]
    const c = calcularSanciones(lista, [roja(j1), roja(j2)], REGLAS, ajustes)
    expect(debeAntes(c, j2)).toBe(2)
    expect(debeAntes(c, j3)).toBe(2)
    expect(debeAntes(c, j4)).toBe(1)
    expect(debeAntes(c, j5)).toBe(0)
    expect(c.sanciones[0]).toMatchObject({
      calculados: 1,
      partidos: 2,
      ajustada: true,
      nota: 'Comité',
    })
  })

  it('un ajuste a 0 anula la sanción', () => {
    const [j1, j2] = jornadas(2) as [PartidoSancion, PartidoSancion]
    const c = calcularSanciones([j1, j2], [roja(j1)], REGLAS, [
      { partidoId: j1.id, jugadorId: 'j1', tipo: 'roja', partidos: 0, nota: null },
    ])
    expect(debeAntes(c, j2)).toBe(0)
    expect(c.sanciones[0]).toMatchObject({ partidos: 0, ajustada: true })
  })

  it('las reglas de la plantilla mandan: sin ciclo y dos partidos por roja', () => {
    const lista = jornadas(4)
    const reglas = { amarillasCiclo: 0, partidosRoja: 2, partidosDobleAmarilla: 1 }
    const c = calcularSanciones(
      lista,
      [...lista.slice(0, 3).map((p) => amarilla(p, 'j2')), roja(lista[0] as PartidoSancion)],
      reglas,
      [],
    )
    expect(c.sanciones.map((s) => [s.jugadorId, s.tipo, s.partidos])).toEqual([['j1', 'roja', 2]])
    expect(estadoDeJugadores(c, reglas).find((e) => e.jugadorId === 'j2')).toBeUndefined()
  })
})
