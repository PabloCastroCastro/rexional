import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JugadorPlantilla } from '../src/jugadores/datos'
import { type Lesion, textoVuelta } from '../src/jugadores/Lesiones'
import { abrir, conDatos, json, manejadores, peticiones, plantilla, senior26 } from './simulacion'

// Lesiones de los jugadores (GH-230). Hoy es viernes 13 de noviembre de 2026 en Madrid; los
// temporizadores son reales
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-13T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const HOY = '2026-11-13'

const BRAIS: JugadorPlantilla = {
  jugadorId: 'j1',
  nombre: 'Brais',
  apellidos: null,
  dorsal: 7,
  posicion: 'delantero',
  activo: true,
  tipo: 'propia',
  enDinamica: true,
  procedencia: null,
  lesion: null,
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

const RUTA = 'plantillas/p1/jugadores/j1/lesiones'

// La API simulada de la ficha de Brais, con sus lesiones en memoria
function conFicha(lesiones: { actual: Lesion | null; historial: Lesion[] }, p = senior26) {
  conDatos({ plantillas: [p] })
  const estado = { ...lesiones }
  manejadores['GET /api/plantillas/p1/jugadores'] = () =>
    json([
      {
        ...BRAIS,
        lesion: estado.actual && {
          desde: estado.actual.desde,
          vueltaPrevista: estado.actual.vueltaPrevista,
        },
      },
    ])
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
          posicion: 'delantero',
          activo: true,
          tipo: 'propia',
          enDinamica: true,
          procedencia: null,
        },
      ],
    })
  manejadores[`GET /api/${RUTA}`] = () => json(estado)
  manejadores[`POST /api/${RUTA}`] = async (peticion) => {
    const cuerpo = (await peticion.json()) as Partial<Lesion>
    estado.actual = {
      id: 'l-nueva',
      desde: cuerpo.desde ?? HOY,
      vueltaPrevista: cuerpo.vueltaPrevista ?? null,
      alta: null,
      nota: cuerpo.nota ?? null,
    }
    return json(estado, 201)
  }
  manejadores[`PATCH /api/${RUTA}/l1`] = async (peticion) => {
    const cuerpo = (await peticion.json()) as Partial<Lesion>
    const cambiada = { ...(estado.actual as Lesion), ...cuerpo }
    if (cambiada.alta) {
      estado.actual = null
      estado.historial = [cambiada, ...estado.historial]
    } else estado.actual = cambiada
    return json(estado)
  }
  manejadores[`DELETE /api/${RUTA}/l1`] = () => {
    estado.actual = null
    return json(estado)
  }
}

const LESION: Lesion = {
  id: 'l1',
  desde: '2026-11-03',
  vueltaPrevista: '2026-11-27',
  alta: null,
  nota: 'Reposo',
}

describe('textos de la vuelta', () => {
  it('cuenta desde hoy, en días o semanas, y avisa si ya pasó', () => {
    expect(textoVuelta(null, HOY)).toBe('sin fecha de vuelta')
    expect(textoVuelta('2026-11-13', HOY)).toBe('vuelve hoy')
    expect(textoVuelta('2026-11-14', HOY)).toBe('vuelve mañana')
    expect(textoVuelta('2026-11-18', HOY)).toBe('vuelve en 5 días')
    expect(textoVuelta('2026-11-27', HOY)).toBe('vuelve en 2 semanas')
    expect(textoVuelta('2026-11-10', HOY)).toBe('debía volver el 10 nov')
  })
})

describe('lesiones en la ficha del jugador', () => {
  it('el cuerpo técnico marca una lesión y aparece la franja', async () => {
    conFicha({ actual: null, historial: [] })
    abrir('/plantillas/p1/jugadores/j1')
    await userEvent.click(await screen.findByRole('button', { name: 'Marcar lesión' }))
    const hoja = screen.getByRole('dialog', { name: 'Marcar lesión de Brais' })
    expect(within(hoja).getByLabelText(/Desde/)).toHaveValue(HOY)
    await userEvent.type(within(hoja).getByLabelText('Vuelta prevista (opcional)'), '2026-11-27')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Marcar lesión' }))

    expect(await screen.findByText('Lesión registrada')).toBeInTheDocument()
    expect(enviado(`POST /api/${RUTA}`)).toEqual([
      { desde: HOY, vueltaPrevista: '2026-11-27', nota: null },
    ])
    const franja = await screen.findByRole('region', { name: 'Lesión' })
    expect(franja).toHaveTextContent('Lesionado desde el 13 nov')
    expect(franja).toHaveTextContent('Vuelve en 2 semanas')
    // Ya lesionado, no se puede marcar otra
    expect(screen.queryByRole('button', { name: 'Marcar lesión' })).not.toBeInTheDocument()
  })

  it('el alta la pasa al historial', async () => {
    conFicha({ actual: LESION, historial: [] })
    abrir('/plantillas/p1/jugadores/j1')
    const franja = await screen.findByRole('region', { name: 'Lesión' })
    expect(franja).toHaveTextContent('Lesionado desde el 3 nov')
    expect(franja).toHaveTextContent('Reposo')

    await userEvent.click(within(franja).getByRole('button', { name: 'Dar el alta' }))
    const hoja = screen.getByRole('dialog', { name: 'Dar el alta a Brais' })
    expect(within(hoja).getByLabelText(/Recuperado el/)).toHaveValue(HOY)
    await userEvent.click(within(hoja).getByRole('button', { name: 'Dar el alta' }))

    expect(await screen.findByText('Alta registrada')).toBeInTheDocument()
    expect(enviado(`PATCH /api/${RUTA}/l1`)).toEqual([{ alta: HOY }])
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Lesión' })).not.toBeInTheDocument(),
    )
    const historial = screen.getByRole('region', { name: 'Lesiones' })
    expect(historial).toHaveTextContent('3 nov – 13 nov')
    expect(historial).toHaveTextContent('10 días · Reposo')
  })

  it('con la vuelta prevista pasada, lo avisa', async () => {
    conFicha({ actual: { ...LESION, vueltaPrevista: '2026-11-10' }, historial: [] })
    abrir('/plantillas/p1/jugadores/j1')
    expect(await screen.findByRole('region', { name: 'Lesión' })).toHaveTextContent(
      'Debía volver el 10 nov',
    )
  })

  it('una registrada por error se borra tras confirmar', async () => {
    conFicha({ actual: LESION, historial: [] })
    abrir('/plantillas/p1/jugadores/j1')
    await userEvent.click(await screen.findByRole('button', { name: 'Corregir la lesión' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Borrar' }),
    )
    const confirmacion = screen.getByRole('alertdialog', { name: '¿Borrar esta lesión?' })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Borrar lesión' }))
    expect(await screen.findByText('Lesión borrada')).toBeInTheDocument()
    expect(peticiones.map((p) => p.clave)).toContain(`DELETE /api/${RUTA}/l1`)
  })

  it('el jugador ve la suya, sin nota ni botones', async () => {
    conFicha(
      { actual: { ...LESION, nota: null }, historial: [] },
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false, jugadorId: 'j1' }),
    )
    abrir('/plantillas/p1/jugadores/j1')
    const franja = await screen.findByRole('region', { name: 'Lesión' })
    expect(within(franja).queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Marcar lesión' })).not.toBeInTheDocument()
  })

  it('de otro jugador, el rol jugador ni las pide', async () => {
    conFicha(
      { actual: LESION, historial: [] },
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false, jugadorId: 'j9' }),
    )
    abrir('/plantillas/p1/jugadores/j1')
    expect(await screen.findByRole('heading', { name: 'Brais' })).toBeInTheDocument()
    expect(peticiones.map((p) => p.clave)).not.toContain(`GET /api/${RUTA}`)
    expect(screen.queryByRole('region', { name: 'Lesión' })).not.toBeInTheDocument()
  })
})

describe('lesionados en la plantilla', () => {
  it('llevan su marca junto a la posición', async () => {
    conFicha({ actual: LESION, historial: [] })
    abrir('/plantillas/p1/jugadores')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).getByRole('listitem')).toHaveTextContent('Delantero · Lesionado')
  })
})
