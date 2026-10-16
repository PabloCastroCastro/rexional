import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ejercicio } from '../src/ejercicios/datos'
import type { Plan } from '../src/planificacion/datos'
import { abrir, conDatos, json, manejadores, ruta, senior26 } from './simulacion'

// Modo campo: la sesión ejercicio a ejercicio durante el entreno

afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'vibrate')
  Reflect.deleteProperty(navigator, 'wakeLock')
})

const paso = (
  id: string,
  nombre: string,
  duracionMin: number | null,
  indicaciones: string | null = null,
) => ({
  ejercicioId: id,
  nombre,
  categoria: null,
  archivado: false,
  urlMiniatura: null,
  duracionMin,
  indicaciones,
})

const PLAN: Plan = {
  entrenoId: 'e1',
  fecha: '2026-10-20',
  hora: '20:00',
  horaFin: '21:30',
  objetivo: 'Salida de balón',
  notas: null,
  duracionPrevista: 90,
  duracionTotal: 11,
  ejercicios: [paso('j1', 'Rondo', 1, 'A dos toques'), paso('j2', 'Partido', 10)],
}

const ejercicio = (id: string, nombre: string): Ejercicio => ({
  id,
  nombre,
  categoria: 'tecnica',
  duracionMin: null,
  etiquetas: [],
  archivado: false,
  descripcion: `Cómo se juega el ${nombre.toLowerCase()}`,
  jugadores: null,
  material: null,
  usos: 1,
  medios: [],
})

function conCampo(plan = PLAN) {
  conDatos({ plantillas: [senior26] })
  manejadores['GET /api/plantillas/p1/entrenos/e1/plan'] = () => json(plan)
  manejadores['GET /api/clubes/c1/ejercicios/j1'] = () => json(ejercicio('j1', 'Rondo'))
  manejadores['GET /api/clubes/c1/ejercicios/j2'] = () => json(ejercicio('j2', 'Partido'))
}

describe('modo campo', () => {
  it('va ejercicio a ejercicio, con sus indicaciones y su descripción', async () => {
    conCampo()
    const router = abrir('/plantillas/p1/campo/e1')
    expect(await screen.findByRole('heading', { name: 'Rondo' })).toBeInTheDocument()
    expect(screen.getByText('1 de 2')).toBeInTheDocument()
    expect(screen.getByText('A dos toques')).toBeInTheDocument()
    expect(await screen.findByText('Cómo se juega el rondo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Pasar lista' })).toHaveAttribute(
      'href',
      '/plantillas/p1/entrenos?fecha=2026-10-20&entreno=e1',
    )

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(await screen.findByRole('heading', { name: 'Partido' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?paso=2')
    // En el último, terminar vuelve al plan
    await userEvent.click(screen.getByRole('link', { name: 'Terminar' }))
    expect(ruta(router)).toBe('/plantillas/p1/entrenos/plan/e1')
  })

  it('la cuenta atrás llega a cero, vibra y propone el siguiente', async () => {
    const vibrar = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrar, configurable: true })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    conCampo()
    abrir('/plantillas/p1/campo/e1')
    const reloj = await screen.findByRole('region', { name: 'Cuenta atrás' })
    expect(reloj).toHaveTextContent('1:00')
    await usuario.click(screen.getByRole('button', { name: 'Iniciar' }))
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(reloj).toHaveTextContent('0:30')
    await usuario.click(screen.getByRole('button', { name: 'Pausa' }))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(reloj).toHaveTextContent('0:30')
    await usuario.click(screen.getByRole('button', { name: 'Seguir' }))
    await act(() => vi.advanceTimersByTimeAsync(31_000))
    expect(reloj).toHaveTextContent('¡Tiempo!')
    expect(vibrar).toHaveBeenCalled()
    await usuario.click(screen.getByRole('button', { name: 'Siguiente ejercicio' }))
    expect(await screen.findByRole('heading', { name: 'Partido' })).toBeInTheDocument()
    // El siguiente empieza con su propia cuenta atrás
    expect(screen.getByRole('region', { name: 'Cuenta atrás' })).toHaveTextContent('10:00')
  })

  it('avisa si la pantalla puede apagarse y la mantiene encendida si se puede', async () => {
    conCampo()
    abrir('/plantillas/p1/campo/e1')
    expect(
      await screen.findByText('Este navegador no puede mantener la pantalla encendida.'),
    ).toBeInTheDocument()

    const soltar = vi.fn(() => Promise.resolve())
    const pedir = vi.fn(() => Promise.resolve({ release: soltar }))
    Object.defineProperty(navigator, 'wakeLock', { value: { request: pedir }, configurable: true })
    conCampo()
    abrir('/plantillas/p1/campo/e1?paso=2')
    await screen.findAllByRole('heading', { name: 'Partido' })
    expect(pedir).toHaveBeenCalledWith('screen')
  })

  it('sin ejercicios, lo explica', async () => {
    conCampo({ ...PLAN, ejercicios: [] })
    abrir('/plantillas/p1/campo/e1')
    expect(
      await screen.findByText('Este entreno no tiene ejercicios en el plan.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver al plan' })).toBeInTheDocument()
  })

  it('el plan tiene el acceso al modo campo', async () => {
    conCampo()
    abrir('/plantillas/p1/entrenos/plan/e1')
    expect(await screen.findByRole('link', { name: 'Modo campo' })).toHaveAttribute(
      'href',
      '/plantillas/p1/campo/e1',
    )
  })
})
