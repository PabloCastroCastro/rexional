import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entreno, JugadorEntreno } from '../src/entrenos/datos'
import { nombreCorto } from '../src/jugadores/datos'
import {
  abrir,
  conDatos,
  json,
  manejadores,
  peticiones,
  ruta,
  SIN_RESPUESTAS,
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
  tipo: 'propia',
  procedencia: null,
  lesion: null,
  estado: null,
  motivo: null,
  respuesta: null,
  motivoRespuesta: null,
  ...extra,
})

// Un entreno a las 20:00 por día, con id e-AAAA-MM-DD
const entreno = (fecha: string, jugadores: JugadorEntreno[]): Entreno => {
  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const j of jugadores) if (j.estado) recuentos[j.estado] += 1
  return {
    id: `e-${fecha}`,
    fecha,
    hora: '20:00',
    horaFin: null,
    deHorario: true,
    objetivo: null,
    ejerciciosPlan: 0,
    duracionPlan: 0,
    recuentos,
    jugadores,
  }
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
    return json(delDia ? [{ ...delDia, ...delDia.recuentos, ...SIN_RESPUESTAS }] : [])
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
    expect(screen.getByText('0 de 3 marcados')).toBeVisible()

    await pulsar('Íker', 'Asiste')
    await pulsar('Brais', 'Falta')
    await pulsar('Zoe', 'Asiste')
    await pulsar('Zoe', 'Asiste')
    expect(within(fila('Zoe')).getByRole('button', { name: 'Asiste' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // En el pie, el progreso; el lector de pantalla oye también el desglose (GH-259)
    expect(screen.getByText('2 de 3 marcados').closest('p')).toHaveTextContent(
      '2 de 3 marcados: 1 asiste, 0 justificadas, 1 falta',
    )

    await esperarGuardado()
    // Los toques seguidos se agrupan: la última petición lleva la lista completa
    expect(enviados().at(-1)).toEqual([
      { jugadorId: 'j1', estado: 'asiste' },
      { jugadorId: 'j2', estado: 'falta' },
    ])
    expect(enviados().length).toBeLessThan(4)
  })

  it('el motivo de una justificada se elige con un chip y se guarda con ella (GH-262)', async () => {
    conEntrenos({ [HOY]: [IKER] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(screen.queryByRole('group', { name: 'Motivo de Íker' })).not.toBeInTheDocument()
    // La justificada es una mano levantada: avisó (GH-256)
    expect(
      within(fila('Íker'))
        .getByRole('button', { name: 'Justificada' })
        .querySelector('.lucide-hand'),
    ).not.toBeNull()
    await pulsar('Íker', 'Justificada')
    const motivos = screen.getByRole('group', { name: 'Motivo de Íker' })
    expect(
      within(motivos)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Lesión', 'Trabajo', 'Estudios', 'Enfermo', 'Otro'])
    await userEvent.click(within(motivos).getByRole('button', { name: 'Trabajo' }))
    expect(within(motivos).getByRole('button', { name: 'Trabajo' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await esperarGuardado()
    expect(enviados().at(-1)).toEqual([
      { jugadorId: 'j1', estado: 'justificada', motivo: 'Trabajo' },
    ])

    // Tocarlo otra vez lo quita
    await userEvent.click(within(motivos).getByRole('button', { name: 'Trabajo' }))
    await waitFor(
      () =>
        expect(enviados().at(-1)).toEqual([
          { jugadorId: 'j1', estado: 'justificada', motivo: null },
        ]),
      { timeout: 3000 },
    )
  })

  it('«Otro» abre un campo con etiqueta y el foco, para cualquier motivo (GH-262)', async () => {
    conEntrenos({ [HOY]: [IKER] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    await pulsar('Íker', 'Justificada')
    const motivos = screen.getByRole('group', { name: 'Motivo de Íker' })
    expect(within(motivos).queryByLabelText('Otro motivo')).not.toBeInTheDocument()
    await userEvent.click(within(motivos).getByRole('button', { name: 'Otro' }))
    const campo = within(motivos).getByLabelText('Otro motivo')
    expect(campo).toHaveFocus()
    await userEvent.type(campo, 'Boda')
    await esperarGuardado()
    expect(enviados().at(-1)).toEqual([{ jugadorId: 'j1', estado: 'justificada', motivo: 'Boda' }])
  })

  it('el resto asiste, y con todos marcados la lista está completa (GH-259)', async () => {
    conEntrenos({ [HOY]: [IKER, BRAIS, ZOE] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    await pulsar('Brais', 'Falta')
    await userEvent.click(screen.getByRole('button', { name: 'El resto asiste (2)' }))
    expect(screen.queryByRole('button', { name: /El resto asiste/ })).not.toBeInTheDocument()
    expect(screen.getByText('Lista completa')).toBeInTheDocument()
    expect(screen.getByText('3 de 3 marcados')).toBeInTheDocument()
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
        { ...ZOE, estado: 'justificada', motivo: 'Boda' },
        jugador('j9', 'Hugo', 10, { activo: false, estado: 'asiste' }),
      ],
    })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(within(fila('Íker')).getByRole('button', { name: 'Justificada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const motivoIker = screen.getByRole('group', { name: 'Motivo de Íker' })
    expect(within(motivoIker).getByRole('button', { name: 'Lesión' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Un motivo que no es de la lista sale en «Otro», sin quitarle el foco a nada (GH-262)
    const motivoZoe = screen.getByRole('group', { name: 'Motivo de Zoe' })
    expect(within(motivoZoe).getByRole('button', { name: 'Otro' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(motivoZoe).getByLabelText('Otro motivo')).toHaveValue('Boda')
    expect(within(motivoZoe).getByLabelText('Otro motivo')).not.toHaveFocus()
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

describe('lesionados en pasar lista (GH-230)', () => {
  it('el lesionado sale como justificada por lesión y se guarda con el resto de la lista', async () => {
    const lesionado = jugador('j2', 'Brais', 7, {
      lesion: { desde: '2026-10-10', vueltaPrevista: '2026-10-28' },
    })
    conEntrenos({ [HOY]: [IKER, lesionado] })
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('Brais')).toBeInTheDocument()
    expect(fila('Brais')).toHaveTextContent('Lesionado · vuelve en 2 semanas')
    expect(within(fila('Brais')).getByRole('button', { name: 'Justificada' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const motivo = within(fila('Brais')).getByRole('group', { name: 'Motivo de Brais' })
    expect(within(motivo).getByRole('button', { name: 'Lesión' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Hasta que se pasa lista no se guarda nada
    expect(enviados()).toEqual([])

    await pulsar('Íker', 'Asiste')
    await esperarGuardado()
    expect(enviados().at(-1)).toEqual(
      expect.arrayContaining([
        { jugadorId: 'j1', estado: 'asiste' },
        { jugadorId: 'j2', estado: 'justificada', motivo: 'Lesión' },
      ]),
    )
  })
})

describe('indicador de guardado (GH-255)', () => {
  it('una lista sin pasar dice «Sin guardar», aunque tenga lesionados ya justificados', async () => {
    const lesionado = jugador('j2', 'Brais', 7, {
      lesion: { desde: '2026-10-10', vueltaPrevista: '2026-10-28' },
    })
    conEntrenos({ [HOY]: [IKER, lesionado] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Brais')
    expect(screen.getByText('Sin guardar')).toBeInTheDocument()
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument()
  })

  it('una lista ya pasada abre con «Guardado»', async () => {
    conEntrenos({ [HOY]: [{ ...IKER, estado: 'asiste' }, BRAIS] })
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    expect(screen.getByText('Guardado')).toBeInTheDocument()
  })

  it('solo dice «Guardado» cuando responde el servidor', async () => {
    conEntrenos({ [HOY]: [IKER] })
    const guardar = manejadores[`PUT /api/plantillas/p1/entrenos/e-${HOY}/asistencias`]
    let responder = () => {}
    const respondido = new Promise<void>((r) => {
      responder = r
    })
    manejadores[`PUT /api/plantillas/p1/entrenos/e-${HOY}/asistencias`] = async (peticion) => {
      await respondido
      return guardar?.(peticion) ?? json(null)
    }
    abrir('/plantillas/p1/entrenos')
    await screen.findByText('Íker')
    await pulsar('Íker', 'Asiste')
    await waitFor(() => expect(enviados()).toHaveLength(1), { timeout: 3000 })
    expect(screen.getByText('Guardando…')).toBeInTheDocument()
    expect(screen.queryByText('Guardado')).not.toBeInTheDocument()

    responder()
    await esperarGuardado()
  })
})

describe('nombres en pasar lista (GH-257)', () => {
  it('nombre y primer apellido, con sus partículas', () => {
    expect(nombreCorto({ nombre: 'Breogán', apellidos: 'Couto Pérez' })).toBe('Breogán Couto')
    expect(nombreCorto({ nombre: 'Uxío', apellidos: 'da Silva Mos' })).toBe('Uxío da Silva')
    expect(nombreCorto({ nombre: 'Iria', apellidos: 'de la Fuente Rey' })).toBe('Iria de la Fuente')
    expect(nombreCorto({ nombre: 'Zoe', apellidos: null })).toBe('Zoe')
  })

  it('muestra el nombre corto, salvo a los que coinciden, y la leyenda lleva el completo', async () => {
    conEntrenos({
      [HOY]: [
        jugador('j1', 'Breogán', 1, { apellidos: 'Couto Pérez' }),
        jugador('j2', 'Ignacio', 2, { apellidos: 'Saavedra Lago' }),
        jugador('j3', 'Ignacio', 3, { apellidos: 'Saavedra Mos' }),
      ],
    })
    abrir('/plantillas/p1/entrenos')
    const lista = await screen.findByRole('list', { name: 'Jugadores' })
    expect(within(lista).getByText('Breogán Couto')).toBeInTheDocument()
    expect(within(lista).queryByText('Breogán Couto Pérez')).not.toBeInTheDocument()
    expect(within(lista).getByText('Ignacio Saavedra Lago')).toBeInTheDocument()
    expect(within(lista).getByText('Ignacio Saavedra Mos')).toBeInTheDocument()
    expect(
      within(lista).getByRole('group', { name: 'Asistencia de Breogán Couto Pérez' }),
    ).toBeInTheDocument()
  })
})

describe('cabecera de pasar lista (GH-258)', () => {
  // El listado del día con lo que se indique: plan y respuestas
  const conListado = (extra: Partial<Entreno> & { respuestas?: unknown }) => {
    const base = entreno(HOY, [IKER])
    manejadores['GET /api/plantillas/p1/entrenos'] = () =>
      json([{ ...base, ...base.recuentos, ...SIN_RESPUESTAS, ...extra }])
  }

  it('sin plan, «Planificar» es un enlace en la fila de la sesión', async () => {
    conEntrenos({ [HOY]: [IKER] })
    abrir('/plantillas/p1/entrenos')
    const enlace = await screen.findByRole('link', { name: 'Planificar' })
    expect(enlace).toHaveAttribute('href', `/plantillas/p1/entrenos/plan/e-${HOY}`)
    expect(screen.queryByText('Plan del entreno')).not.toBeInTheDocument()
  })

  it('con plan, la tarjeta del plan y sin enlace', async () => {
    conEntrenos({ [HOY]: [IKER] })
    conListado({ objetivo: 'Presión', ejerciciosPlan: 4, duracionPlan: 75 })
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('Plan del entreno')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Planificar' })).not.toBeInTheDocument()
  })

  it('«¿Quién va?» es una línea plegada con lo que no es cero', async () => {
    conEntrenos({ [HOY]: [IKER] })
    conListado({ respuestas: { voy: 0, duda: 0, noVoy: 1, sinResponder: 31 } })
    abrir('/plantillas/p1/entrenos')
    const respuestas = await screen.findByRole('region', { name: 'Respuestas' })
    const resumen = within(respuestas).getByText('¿Quién va?').closest('summary') as HTMLElement
    expect(resumen).toHaveTextContent('¿Quién va? 1 no va · 31 sin responder')
    expect(resumen.closest('details')).not.toHaveAttribute('open')
    await userEvent.click(resumen)
    expect(
      within(respuestas).getByText('0 van · 0 dudan · 1 no va · 31 sin responder'),
    ).toBeVisible()
  })
})

describe('día sin entreno (GH-263)', () => {
  it('lleva al próximo entreno y deja crear uno como acción secundaria', async () => {
    conEntrenos({ [AYER]: [BRAIS] })
    const router = abrir('/plantillas/p1/entrenos?fecha=2026-10-12')
    expect(await screen.findByText('No hay entreno este día')).toBeInTheDocument()
    const proximo = await screen.findByRole('link', { name: /Próximo entreno/ })
    expect(proximo).toHaveTextContent('Ayer · martes, 13 oct · 20:00')
    expect(screen.getByRole('button', { name: 'Crear un entreno este día' })).toBeInTheDocument()

    await userEvent.click(proximo)
    expect(await screen.findByText('Brais')).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?fecha=${AYER}`)
  })

  it('sin ningún entreno por delante, el estado vacío de siempre', async () => {
    conEntrenos({ [AYER]: [BRAIS] })
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('No hay entreno este día')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Crear entreno' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Próximo entreno/ })).not.toBeInTheDocument()
  })
})
