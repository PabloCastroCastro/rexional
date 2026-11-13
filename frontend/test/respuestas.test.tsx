import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entreno, EntrenoListado, JugadorEntreno } from '../src/entrenos/datos'
import {
  abrir,
  conDatos,
  json,
  manejadores,
  peticiones,
  plantilla,
  SIN_RESPUESTAS,
  senior26,
} from './simulacion'

// Respuestas a si van a los próximos entrenos (GH-204)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const MANANA = '2026-10-15'
const jugadorBrais = plantilla('p1', 'Senior', '2026-27', {
  rol: 'jugador',
  esAdminClub: false,
  jugadorId: 'j1',
})

const proximo = (extra: Partial<EntrenoListado> = {}): EntrenoListado => ({
  id: 'e1',
  fecha: MANANA,
  hora: '20:00',
  horaFin: null,
  deHorario: true,
  objetivo: null,
  ejerciciosPlan: 0,
  duracionPlan: 0,
  asiste: 0,
  justificada: 0,
  falta: 0,
  ...SIN_RESPUESTAS,
  cierreRespuestas: '2026-10-15T18:00:00Z',
  ...extra,
})

const jugador = (
  jugadorId: string,
  nombre: string,
  dorsal: number,
  extra: Partial<JugadorEntreno> = {},
): JugadorEntreno => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: null,
  activo: true,
  tipo: 'propia',
  procedencia: null,
  lesion: null,
  estado: null,
  motivo: null,
  respuesta: null,
  motivoRespuesta: null,
  ...extra,
})

const detalle = (e: EntrenoListado, jugadores: JugadorEntreno[]): Entreno => ({
  id: e.id,
  fecha: e.fecha,
  hora: e.hora,
  horaFin: e.horaFin,
  deHorario: e.deHorario,
  objetivo: e.objetivo,
  ejerciciosPlan: 0,
  duracionPlan: 0,
  recuentos: { asiste: 0, justificada: 0, falta: 0 },
  jugadores,
})

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

// Los próximos (desde mañana) y el resto del historial, vacío
function conProximos(p = jugadorBrais, entreno = proximo()) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
    json(new URL(peticion.url).searchParams.get('desde') ? [entreno] : [])
  manejadores['GET /api/plantillas/p1/asistencia/resumen'] = () => json([])
}

describe('el jugador', () => {
  it('responde si va a un próximo entreno y puede quitar la respuesta', async () => {
    conProximos()
    manejadores['PUT /api/plantillas/p1/entrenos/e1/respuesta'] = async (peticion) =>
      json({ jugadorId: 'j1', motivo: null, ...((await peticion.json()) as object) })
    manejadores['DELETE /api/plantillas/p1/entrenos/e1/respuesta'] = () =>
      new Response(null, { status: 204 })
    abrir('/plantillas/p1/entrenos')

    const control = await screen.findByRole('group', { name: '¿Vas a este entreno?' })
    expect(screen.getByText(/Puedes cambiarla hasta el jueves a las 20:00/)).toBeInTheDocument()
    await userEvent.click(within(control).getByRole('button', { name: 'Duda' }))
    expect(enviado('PUT /api/plantillas/p1/entrenos/e1/respuesta')).toEqual([
      { respuesta: 'duda', motivo: null },
    ])
  })

  it('tocar la respuesta elegida la quita', async () => {
    conProximos(jugadorBrais, proximo({ miRespuesta: 'voy' }))
    manejadores['DELETE /api/plantillas/p1/entrenos/e1/respuesta'] = () =>
      new Response(null, { status: 204 })
    abrir('/plantillas/p1/entrenos')
    const voy = await screen.findByRole('button', { name: 'Voy' })
    expect(voy).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(voy)
    expect(peticiones.map((p) => p.clave)).toContain(
      'DELETE /api/plantillas/p1/entrenos/e1/respuesta',
    )
  })

  it('pasada la hora límite, ve su respuesta con su motivo y que están cerradas', async () => {
    conProximos(
      jugadorBrais,
      proximo({ miRespuesta: 'no_voy', miMotivo: 'Trabajo', respuestasAbiertas: false }),
    )
    abrir('/plantillas/p1/entrenos')
    expect(
      await screen.findByText('Respondiste «No voy»: Trabajo. Respuestas cerradas'),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText('Motivo (opcional)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Voy' })).not.toBeInTheDocument()
  })

  it('con «Duda» o «No voy» indica el motivo, que se conserva al cambiar entre las dos (GH-211)', async () => {
    conProximos(jugadorBrais, proximo({ miRespuesta: 'no_voy', miMotivo: null }))
    manejadores['PUT /api/plantillas/p1/entrenos/e1/respuesta'] = async (peticion) =>
      json({ jugadorId: 'j1', ...((await peticion.json()) as object) })
    abrir('/plantillas/p1/entrenos')
    const motivo = await screen.findByLabelText('Motivo (opcional)')
    await userEvent.type(motivo, ' Trabajo {Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Duda' }))
    await userEvent.click(screen.getByRole('button', { name: 'Voy' }))
    expect(enviado('PUT /api/plantillas/p1/entrenos/e1/respuesta')).toEqual([
      { respuesta: 'no_voy', motivo: 'Trabajo' },
      { respuesta: 'duda', motivo: 'Trabajo' },
      { respuesta: 'voy', motivo: null },
    ])
  })

  it('con «Voy» no hay campo de motivo', async () => {
    conProximos(jugadorBrais, proximo({ miRespuesta: 'voy' }))
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByRole('button', { name: 'Voy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByLabelText('Motivo (opcional)')).not.toBeInTheDocument()
  })

  it('ve el recuento sin nombres', async () => {
    conProximos(
      jugadorBrais,
      proximo({ respuestas: { voy: 3, duda: 1, noVoy: 0, sinResponder: 5 } }),
    )
    abrir('/plantillas/p1/entrenos')
    expect(
      await screen.findByText('3 van · 1 duda · 0 no van · 5 sin responder'),
    ).toBeInTheDocument()
  })

  it('el entreno de hoy sin lista pasada está en los próximos; con lista, en el historial (GH-209)', async () => {
    const deHoy = proximo({ id: 'hoy', fecha: '2026-10-14' })
    conProximos()
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
      json(new URL(peticion.url).searchParams.get('desde') ? [] : [deHoy])
    abrir('/plantillas/p1/entrenos')
    const proximos = await screen.findByRole('region', { name: 'Próximos' })
    expect(within(proximos).getByText(/^Hoy/)).toBeInTheDocument()
    expect(
      within(proximos).getByRole('group', { name: '¿Vas a este entreno?' }),
    ).toBeInTheDocument()
  })

  it('con la lista ya pasada, el entreno de hoy baja al historial con su estado', async () => {
    const deHoy = proximo({ id: 'hoy', fecha: '2026-10-14', asiste: 12, miEstado: 'asiste' })
    conProximos()
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
      json(new URL(peticion.url).searchParams.get('desde') ? [] : [deHoy])
    abrir('/plantillas/p1/entrenos')
    const octubre = await screen.findByRole('region', { name: 'octubre de 2026' })
    expect(within(octubre).getByText('Asististe')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Próximos' })).not.toBeInTheDocument()
  })
})

describe('el cuerpo técnico', () => {
  function conEntrenoFuturo() {
    const entreno = proximo({ respuestas: { voy: 1, duda: 0, noVoy: 1, sinResponder: 1 } })
    conProximos(senior26, entreno)
    manejadores['GET /api/plantillas/p1/entrenos'] = () => json([entreno])
    manejadores['GET /api/plantillas/p1/entrenos/e1'] = () =>
      json(
        detalle(entreno, [
          jugador('j1', 'Brais', 7, { respuesta: 'voy' }),
          jugador('j2', 'Zoe', 9, { respuesta: 'no_voy', motivoRespuesta: 'Trabajo' }),
          jugador('j3', 'Íker', 1),
        ]),
      )
    manejadores['GET /api/plantillas/p1/entrenos/e1/respuestas/mensaje'] = () =>
      json({ texto: '✅ *Van (1)*\n7 · Brais', whatsapp: 'https://wa.me/?text=x' })
    manejadores['PUT /api/plantillas/p1/entrenos/e1/respuestas/j3'] = async (peticion) =>
      json({ jugadorId: 'j3', motivo: null, ...((await peticion.json()) as object) })
  }

  it('en el día de un próximo entreno ve quién va, apunta respuestas y comparte el resumen', async () => {
    conEntrenoFuturo()
    abrir(`/plantillas/p1/entrenos?fecha=${MANANA}`)
    const seccion = await screen.findByRole('region', { name: 'Respuestas' })
    expect(
      within(seccion).getByText('1 va · 0 dudan · 1 no va · 1 sin responder'),
    ).toBeInTheDocument()
    const lista = await within(seccion).findByRole('list', { name: 'Respuestas de los jugadores' })
    expect(within(lista).getByText('Trabajo')).toBeInTheDocument()
    const zoe = within(lista).getByRole('group', { name: 'Respuesta de Zoe' })
    expect(within(zoe).getByRole('button', { name: 'No voy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    const iker = within(lista).getByRole('group', { name: 'Respuesta de Íker' })
    await userEvent.click(within(iker).getByRole('button', { name: 'Voy' }))
    expect(enviado('PUT /api/plantillas/p1/entrenos/e1/respuestas/j3')).toEqual([
      { respuesta: 'voy' },
    ])
    expect(await within(seccion).findByText(/7 · Brais/)).toBeInTheDocument()
  })

  it('el historial muestra el recuento de los próximos', async () => {
    conEntrenoFuturo()
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
      json(
        new URL(peticion.url).searchParams.get('desde')
          ? [proximo({ respuestas: { voy: 2, duda: 0, noVoy: 0, sinResponder: 4 } })]
          : [],
      )
    abrir('/plantillas/p1/entrenos/historial')
    expect(
      await screen.findByText('2 van · 0 dudan · 0 no van · 4 sin responder'),
    ).toBeInTheDocument()
  })

  it('al pasar lista, lo que dijo cada jugador es solo una pista', async () => {
    vi.setSystemTime(new Date('2026-10-15T19:00:00Z'))
    conEntrenoFuturo()
    abrir(`/plantillas/p1/entrenos?fecha=${MANANA}`)
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).getByText('Dijo que iba')).toBeInTheDocument()
    expect(within(lista).getByText('Dijo que no iba: Trabajo')).toBeInTheDocument()
    // No rellena el estado
    expect(within(lista).queryAllByRole('button', { pressed: true })).toHaveLength(0)

    // Antes de pasar lista, encima, quién va y el resumen para WhatsApp (GH-215)
    const respuestas = screen.getByRole('region', { name: 'Respuestas' })
    expect(
      within(respuestas).getByText('1 va · 0 dudan · 1 no va · 1 sin responder'),
    ).toBeInTheDocument()
    expect(await within(respuestas).findByText('Resumen para WhatsApp')).toBeInTheDocument()
  })

  it('en el historial, el entreno de hoy sin lista va en los próximos con su recuento (GH-215)', async () => {
    const deHoy = proximo({
      id: 'hoy',
      fecha: '2026-10-14',
      respuestas: { voy: 0, duda: 0, noVoy: 1, sinResponder: 2 },
    })
    conProximos(senior26, deHoy)
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
      json(new URL(peticion.url).searchParams.get('desde') ? [] : [deHoy])
    abrir('/plantillas/p1/entrenos/historial')
    const proximos = await screen.findByRole('region', { name: 'Próximos' })
    expect(within(proximos).getByText(/^Hoy/)).toBeInTheDocument()
    expect(
      within(proximos).getByText('0 van · 0 dudan · 1 no va · 2 sin responder'),
    ).toBeInTheDocument()
  })
})

describe('configuración', () => {
  it('el entrenador fija la hora límite, de 0 a 72 horas', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['PATCH /api/plantillas/p1'] = async (peticion) =>
      json({ ...senior26, ...((await peticion.json()) as object) })
    abrir('/plantillas/p1/mas/configuracion')
    const campo = await screen.findByLabelText('Hora límite para responder a los entrenos')
    const formulario = within(campo.closest('form') as HTMLElement)
    await userEvent.clear(campo)
    await userEvent.type(campo, '80')
    await userEvent.click(formulario.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('La hora límite va de 0 a 72 horas')).toBeInTheDocument()

    await userEvent.clear(campo)
    await userEvent.type(campo, '3')
    await userEvent.click(formulario.getByRole('button', { name: 'Guardar' }))
    expect(enviado('PATCH /api/plantillas/p1')).toEqual([
      expect.objectContaining({ horasLimiteRespuesta: 3 }),
    ])
  })
})
