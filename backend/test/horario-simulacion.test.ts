import { describe, expect, it } from 'vitest'
import { compararHorario } from '../src/rutas/entrenos.js'

// GH-269: qué cambia al guardar un horario, comparando los entrenos que se borrarían con los que se
// crearían. 2026-11-17 es martes; 2026-11-19, jueves; 2026-11-18, miércoles
const s = (fecha: string, hora: string, horaFin: string | null = null) => ({ fecha, hora, horaFin })

describe('compararHorario', () => {
  it('los idénticos no cambian', () => {
    const iguales = [s('2026-11-17', '20:00', '21:30'), s('2026-11-19', '20:00', '21:30')]
    expect(compararHorario(iguales, iguales)).toEqual({ anadidos: [], quitados: [], cambios: [] })
  })

  it('agrupa por día de la semana y franja lo que se añade y se quita', () => {
    expect(
      compararHorario(
        [s('2026-11-19', '20:00'), s('2026-11-26', '20:00')],
        [s('2026-11-18', '20:00'), s('2026-11-25', '20:00')],
      ),
    ).toEqual({
      anadidos: [{ dia: 3, franja: '20:00', cuantos: 2 }],
      quitados: [{ dia: 4, franja: '20:00', cuantos: 2 }],
      cambios: [],
    })
  })

  it('en un mismo día, un entreno con otra hora o fin es un cambio de hora', () => {
    expect(
      compararHorario(
        [s('2026-11-19', '20:00', '21:30'), s('2026-11-26', '20:00', '21:30')],
        [s('2026-11-19', '19:30', '21:00'), s('2026-11-26', '19:30', '21:00')],
      ).cambios,
    ).toEqual([{ dia: 4, de: '20:00–21:30', a: '19:30–21:00', cuantos: 2 }])
  })

  it('con dos sesiones, solo cambia la que no coincide; si sobra una, se añade', () => {
    expect(
      compararHorario(
        [s('2026-11-17', '10:00'), s('2026-11-17', '20:00')],
        [s('2026-11-17', '10:00'), s('2026-11-17', '18:00'), s('2026-11-17', '21:00')],
      ),
    ).toEqual({
      anadidos: [{ dia: 2, franja: '21:00', cuantos: 1 }],
      quitados: [],
      cambios: [{ dia: 2, de: '20:00', a: '18:00', cuantos: 1 }],
    })
  })
})
