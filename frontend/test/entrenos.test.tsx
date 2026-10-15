import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entreno, JugadorEntreno } from '../src/entrenos/datos'
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

// Hoy es miércoles 14 de octubre de 2026 en Madrid. Solo se simula la fecha: los temporizadores son
// reales, así que el guardado automático tarda lo que tarda de verdad.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const HOY = '2026-10-14'
const AYER = '2026-10-13'

const jugador = (
  jugadorId: string,
  nombre: string,
  dorsal: number | null,
  extra: Partial<JugadorEntreno> = {},
): JugadorEntreno => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: null,
  activo: true,
  estado: null,
  motivo: null,
  ...extra,
})

// Un entreno a las 20:00 por día, con id e-AAAA-MM-DD
const entreno = (fecha: string, jugadores: JugadorEntreno[]): Entreno => {
  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const j of jugadores) if (j.estado) recuentos[j.estado] += 1
  return { id: `e-${fecha}`, fecha, hora: '20:00', deHorario: true, recuentos, jugadores }
}

const IKER = jugador('j1', 'Íker', 1)
const BRAIS = jugador('j2', 'Brais', 7)
const ZOE = jugador('j3', 'Zoe', null)

const enviados = (fecha = HOY) =>
  peticiones
    .filter((p) => p.clave === `PUT /api/plantillas/p1/entrenos/e-${fecha}/asistencias`)
    .map((p) => (p.cuerpo as { asistencias: unknown[] }).asistencias)

// La API simulada: un entreno en cada día indicado; guarda lo que recibe y lo devuelve
function conEntrenos(dias: Record<string, JugadorEntreno[]>, p = senior26) {
  conDatos({ plantillas: [p] })
  const actuales: Record<string, Entreno> = {}
  manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) => {
    const desde = new URL(peticion.url).searchParams.get('desde')
    const delDia = actuales[desde ?? '']
    return json(delDia ? [{ ...delDia, ...delDia.recuentos }] : [])
  }
  for (const [fecha, jugadores] of Object.entries(dias)) {
    actuales[fecha] = entreno(fecha, jugadores)
    manejadores[`GET /api/plantillas/p1/entrenos/e-${fecha}`] = () => json(actuales[fecha])
    manejadores[`PUT /api/plantillas/p1/entrenos/e-${fecha}/asistencias`] = async (peticion) => {
      const { asistencias } = (await peticion.json()) as {
        asistencias: { jugadorId: string; estado: JugadorEntreno['estado']; motivo?: string }[]
      }
      actuales[fecha] = entreno(
        fecha,
        (actuales[fecha]?.jugadores ?? []).map((j) => {
          const a = asistencias.find((x) => x.jugadorId === j.jugadorId)
          return { ...j, estado: a?.estado ?? null, motivo: a?.motivo ?? null }
        }),
      )
      return json(actuales[fecha])
    }
  }
}

const fila = (nombre: string) =>
  within(screen.getByRole('list', { name: 'Jugadores' }))
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(nombre)) as HTMLElement

const pulsar = async (nombre: string, estado: string) =>
  userEvent.click(within(fila(nombre)).getByRole('button', { name: estado }))

const esperarGuardado = () =>
  waitFor(() => expect(screen.getByText('Guardado')).toBeInTheDocument(), { timeout: 3000 })

describe('fecha', () => {
  it('abre el día de hoy y se mueve por días, también futuros', async () => {
    conEntrenos({ [HOY]: [IKER], [AYER]: [BRAIS] })
    const router = abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText(/Hoy · miércoles, 14 oct/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Día anterior' }))
    expect(await screen.findByText(/Ayer · martes, 13 oct/)).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?fecha=${AYER}`)
    expect(await screen.findByText('Brais')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Día siguiente' }))
    expect(await screen.findByText(/Hoy/)).toBeInTheDocument()
    expect(ruta(router)).toBe('/plantillas/p1/entrenos')

    await userEvent.click(screen.getByRole('button', { name: 'Día siguiente' }))
    expect(await screen.findByText(/jueves, 15 oct/)).toBeInTheDocument()
    expect(await screen.findByText('No hay entreno este día')).toBeInTheDocument()
  })

  it('una fecha no válida en la URL abre hoy', async () => {
    conEntrenos({ [HOY]: [IKER] })
    abrir('/plantillas/p1/entrenos?fecha=2026-02-30')
    expect(await screen.findByText(/Hoy · miércoles/)).toBeInTheDocument()
  })
})

describe('pasar lista', () => {
  it('un día sin entreno no deja pasar lista', async () => {
    conEntrenos({ [AYER]: [IKER] })
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('No hay entreno este día')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Asiste' })).not.toBeInTheDocument()
  })

  it('marca, desmarca y guarda la lista completa automáticamente', async () => {
    conEntrenos({ [HOY]: [IKER, BRAIS, ZOE] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(screen.getByText(/0 asisten · 0 justificadas · 0 faltan · 3 sin marcar/)).toBeVisible()

    await pulsar('Íker', 'Asiste')
    await pulsar('Brais', 'Falta')
    await pulsar('Zoe', 'Asiste')
    await pulsar('Zoe', 'Asiste')
    expect(within(fila('Zoe')).getByRole('button', { name: 'Asiste' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByText(/1 asiste · 0 justificadas · 1 falta · 1 sin marcar/)).toBeVisible()

    await esperarGuardado()
    // Los toques seguidos se agrupan: la última petición lleva la lista completa
    expect(enviados().at(-1)).toEqual([
      { jugadorId: 'j1', estado: 'asiste' },
      { jugadorId: 'j2', estado: 'falta' },
    ])
    expect(enviados().length).toBeLessThan(4)
  })

  it('el motivo de una justificada se guarda con ella', async () => {
    conEntrenos({ [HOY]: [IKER] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(screen.queryByLabelText('Motivo de Íker')).not.toBeInTheDocument()
    await pulsar('Íker', 'Justificada')
    await userEvent.type(screen.getByLabelText('Motivo de Íker'), 'Trabajo')
    await esperarGuardado()
    expect(enviados().at(-1)).toEqual([
      { jugadorId: 'j1', estado: 'justificada', motivo: 'Trabajo' },
    ])
  })

  it('marca el resto como asiste', async () => {
    conEntrenos({ [HOY]: [IKER, BRAIS, ZOE] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    await pulsar('Brais', 'Falta')
    await userEvent.click(screen.getByRole('button', { name: 'Marcar el resto como asiste (2)' }))
    expect(screen.queryByRole('button', { name: /Marcar el resto/ })).not.toBeInTheDocument()
    await esperarGuardado()
    expect(enviados().at(-1)).toEqual([
      { jugadorId: 'j1', estado: 'asiste' },
      { jugadorId: 'j2', estado: 'falta' },
      { jugadorId: 'j3', estado: 'asiste' },
    ])
  })

  it('muestra lo ya registrado y los jugadores de baja con asistencia', async () => {
    conEntrenos({
      [HOY]: [
        { ...IKER, estado: 'justificada', motivo: 'Lesión' },
        jugador('j9', 'Hugo', 10, { activo: false, estado: 'asiste' }),
      ],
    })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(within(fila('Íker')).getByRole('button', { name: 'Justificada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByLabelText('Motivo de Íker')).toHaveValue('Lesión')
    expect(fila('Hugo')).toHaveTextContent(/baja/)
  })

  it('si falla el guardado lo indica y permite reintentar', async () => {
    conEntrenos({ [HOY]: [IKER] })
    let fallar = true
    const guardar = manejadores[`PUT /api/plantillas/p1/entrenos/e-${HOY}/asistencias`]
    manejadores[`PUT /api/plantillas/p1/entrenos/e-${HOY}/asistencias`] = (peticion) =>
      fallar
        ? json({ error: { codigo: 'error_interno', mensaje: 'Error' } }, 500)
        : (guardar?.(peticion) ?? json(null))
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    await pulsar('Íker', 'Asiste')

    const reintentar = await screen.findByRole('button', { name: 'Reintentar' }, { timeout: 3000 })
    expect(screen.getByText('No se ha guardado')).toBeInTheDocument()
    fallar = false
    await userEvent.click(reintentar)
    await esperarGuardado()
    expect(enviados()).toEqual([
      [{ jugadorId: 'j1', estado: 'asiste' }],
      [{ jugadorId: 'j1', estado: 'asiste' }],
    ])
  })
})

describe('sin permiso para pasar lista', () => {
  it('el rol jugador ve los recuentos sin controles', async () => {
    conEntrenos(
      { [HOY]: [] },
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }),
    )
    manejadores[`GET /api/plantillas/p1/entrenos/e-${HOY}`] = () =>
      json({
        ...entreno(HOY, []),
        recuentos: { asiste: 9, justificada: 1, falta: 2 },
      })
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('9 asisten · 1 justificada · 2 faltan')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Asiste' })).not.toBeInTheDocument()
    expect(screen.getByText('Pasar lista es cosa del cuerpo técnico.')).toBeInTheDocument()
  })
})
