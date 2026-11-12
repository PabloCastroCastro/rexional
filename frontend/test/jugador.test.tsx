import { screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EntrenoListado } from '../src/entrenos/datos'
import type { ResumenPartido } from '../src/partidos/datos'
import { abrir, conDatos, json, manejadores, plantilla, ruta, SIN_RESPUESTAS } from './simulacion'

// Experiencia del rol jugador (GH-52): sus datos y ningún control de edición

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const conFicha = plantilla('p1', 'Senior', '2026-27', {
  rol: 'jugador',
  esAdminClub: false,
  jugadorId: 'j1',
})
const sinFicha = plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false })

const entreno = (
  id: string,
  fecha: string,
  miEstado: EntrenoListado['miEstado'],
  asiste = 0,
): EntrenoListado => ({
  id,
  fecha,
  hora: '20:00',
  horaFin: null,
  deHorario: true,
  objetivo: null,
  ejerciciosPlan: 0,
  duracionPlan: 0,
  asiste,
  justificada: 0,
  falta: 0,
  ...SIN_RESPUESTAS,
  miEstado,
})

function conEntrenos(p = conFicha) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
    new URL(peticion.url).searchParams.has('desde')
      ? json([entreno('e9', '2026-10-15', null)])
      : json([
          entreno('e3', '2026-10-13', 'asiste', 10),
          entreno('e2', '2026-10-08', 'falta', 9),
          entreno('e1', '2026-10-06', null, 8),
          entreno('e0', '2026-10-01', null),
        ])
  manejadores['GET /api/plantillas/p1/asistencia/resumen'] = () =>
    json([
      {
        jugadorId: 'j1',
        nombre: 'Brais',
        apellidos: null,
        activo: true,
        tipo: 'propia',
        asiste: 1,
        justificada: 0,
        falta: 1,
        porcentaje: 50,
      },
    ])
}

describe('entrenos del rol jugador', () => {
  it('ve su asistencia y su estado en cada entreno, sin pasar lista', async () => {
    conEntrenos()
    abrir('/plantillas/p1/entrenos')
    const pestanas = await screen.findByRole('navigation', { name: 'Entrenos' })
    expect(
      within(pestanas)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Mi asistencia', 'Horario', 'Ejercicios'])

    const resumen = await screen.findByRole('region', { name: 'Mi asistencia' })
    expect(within(resumen).getByText(/50 %/)).toBeInTheDocument()
    expect(within(resumen).getByText('1 asistencia · 0 justificadas · 1 falta')).toBeInTheDocument()

    const octubre = screen.getByRole('region', { name: 'octubre de 2026' })
    const filas = within(octubre).getAllByRole('listitem')
    expect(filas.map((f) => f.textContent)).toEqual([
      expect.stringContaining('Asististe'),
      expect.stringContaining('Faltaste'),
      expect.stringContaining('Sin registrar'),
      expect.stringContaining('Sin pasar lista'),
    ])
    // Sin plan, los pasados no se abren; los próximos, sí (por su plan)
    expect(within(octubre).queryByRole('link')).not.toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Próximos' })).getByRole('link'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asiste|Añadir sesión/ })).not.toBeInTheDocument()
  })

  it('el historial lleva a su asistencia', async () => {
    conEntrenos()
    const router = abrir('/plantillas/p1/entrenos/historial')
    expect(await screen.findByRole('region', { name: 'Mi asistencia' })).toBeInTheDocument()
    expect(ruta(router)).toBe('/plantillas/p1/entrenos')
  })

  it('sin ficha vinculada, un aviso en vez de una lista vacía', async () => {
    conEntrenos(sinFicha)
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('Tu cuenta no está vinculada a tu ficha')).toBeInTheDocument()
  })
})

describe('partidos y multas del rol jugador', () => {
  const partido = (id: string, convocados: number, meConvocan: boolean): ResumenPartido => ({
    id,
    rival: `Rival ${id}`,
    competicion: null,
    fecha: '2026-10-18',
    hora: null,
    horaCitacion: null,
    lugar: null,
    local: true,
    estado: 'programado',
    golesFavor: null,
    golesContra: null,
    convocados,
    meConvocan,
  })

  it('cada partido dice si está convocado', async () => {
    conDatos({ plantillas: [conFicha] })
    manejadores['GET /api/plantillas/p1/partidos'] = () =>
      json([partido('a', 16, true), partido('b', 16, false), partido('c', 0, false)])
    abrir('/plantillas/p1/partidos')
    expect(await screen.findByText('Convocado')).toBeInTheDocument()
    expect(screen.getByText('No convocado')).toBeInTheDocument()
    expect(screen.getByText('Sin convocatoria')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo partido' })).not.toBeInTheDocument()
  })

  it('sin ficha vinculada, sus multas son un aviso', async () => {
    conDatos({ plantillas: [sinFicha] })
    abrir('/plantillas/p1/multas')
    expect(await screen.findByText('Tu cuenta no está vinculada a tu ficha')).toBeInTheDocument()
  })
})

describe('más', () => {
  it('el rol jugador tiene un enlace a sus estadísticas, en su ficha', async () => {
    conDatos({ plantillas: [conFicha] })
    abrir('/plantillas/p1/mas')
    expect(await screen.findByRole('link', { name: 'Mis estadísticas' })).toHaveAttribute(
      'href',
      '/plantillas/p1/jugadores/j1',
    )
    expect(screen.queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument()
  })

  it('sin ficha vinculada no hay enlace a sus estadísticas', async () => {
    conDatos({ plantillas: [sinFicha] })
    abrir('/plantillas/p1/mas')
    expect(await screen.findByRole('link', { name: /Cuenta/ })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mis estadísticas' })).not.toBeInTheDocument()
  })
})
