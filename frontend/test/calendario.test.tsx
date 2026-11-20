import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entreno, EntrenoListado, Horario } from '../src/entrenos/datos'
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

// Hoy es miércoles 14 de octubre de 2026 en Madrid (solo se simula la fecha)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const HOY = '2026-10-14'
const MANANA = '2026-10-15'

// Las opciones del entreno elegido, desde el «⋯» de su pastilla (GH-261)
async function opcion(nombre: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Opciones del entreno' }))
  const hoja = screen.getByRole('dialog', { name: 'Opciones del entreno' })
  await userEvent.click(within(hoja).getByRole('button', { name: nombre }))
}

const resumen = (
  id: string,
  fecha: string,
  hora: string | null,
  extra: Partial<EntrenoListado> = {},
): EntrenoListado => ({
  id,
  fecha,
  hora,
  horaFin: null,
  deHorario: false,
  objetivo: null,
  ejerciciosPlan: 0,
  duracionPlan: 0,
  asiste: 0,
  justificada: 0,
  falta: 0,
  ...SIN_RESPUESTAS,
  ...extra,
})

const detalle = (r: EntrenoListado): Entreno => ({
  id: r.id,
  fecha: r.fecha,
  hora: r.hora,
  horaFin: r.horaFin,
  deHorario: r.deHorario,
  objetivo: r.objetivo,
  ejerciciosPlan: r.ejerciciosPlan,
  duracionPlan: r.duracionPlan,
  recuentos: { asiste: r.asiste, justificada: r.justificada, falta: r.falta },
  jugadores: [
    {
      jugadorId: 'j1',
      nombre: 'Íker',
      apellidos: null,
      dorsal: 1,
      posicion: null,
      activo: true,
      tipo: 'propia',
      procedencia: null,
      lesion: null,
      estado: null,
      motivo: null,
      respuesta: null,
      motivoRespuesta: null,
    },
  ],
})

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

// La API simulada del calendario: crea, cancela y consulta por día
function conCalendario(inicial: EntrenoListado[], p = senior26) {
  conDatos({ plantillas: [p] })
  let entrenos = [...inicial]
  let siguiente = 1
  manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) => {
    const consulta = new URL(peticion.url).searchParams
    const desde = consulta.get('desde') ?? '0000'
    const hasta = consulta.get('hasta') ?? '9999'
    return json(entrenos.filter((e) => e.fecha >= desde && e.fecha <= hasta))
  }
  manejadores['POST /api/plantillas/p1/entrenos'] = async (peticion) => {
    const { fecha, hora, horaFin } = (await peticion.json()) as {
      fecha: string
      hora: string | null
      horaFin: string | null
    }
    if (entrenos.some((e) => e.fecha === fecha && e.hora === hora)) {
      const mensaje = `Ya hay un entreno el ${fecha} a las ${hora}`
      return json({ error: { codigo: 'entreno_duplicado', mensaje } }, 409)
    }
    const nuevo = resumen(`n${siguiente++}`, fecha, hora, { horaFin })
    entrenos = [...entrenos, nuevo].sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''))
    manejadores[`GET /api/plantillas/p1/entrenos/${nuevo.id}`] = () => json(detalle(nuevo))
    return json(nuevo, 201)
  }
  for (const e of inicial) {
    manejadores[`GET /api/plantillas/p1/entrenos/${e.id}`] = () => json(detalle(e))
    manejadores[`DELETE /api/plantillas/p1/entrenos/${e.id}`] = () => {
      entrenos = entrenos.filter((x) => x.id !== e.id)
      return new Response(null, { status: 204 })
    }
    manejadores[`PATCH /api/plantillas/p1/entrenos/${e.id}`] = async (peticion) => {
      const horas = (await peticion.json()) as { hora: string | null; horaFin: string | null }
      const cambiado = { ...e, ...horas, deHorario: false }
      entrenos = entrenos.map((x) => (x.id === e.id ? cambiado : x))
      return json(cambiado)
    }
  }
}

describe('entrenos del día', () => {
  it('en un día sin entreno se crea uno y se pasa lista de él', async () => {
    conCalendario([])
    const router = abrir('/plantillas/p1/entrenos')
    await userEvent.click(await screen.findByRole('button', { name: 'Crear entreno' }))
    const hoja = screen.getByRole('dialog', { name: 'Crear entreno' })
    await userEvent.type(within(hoja).getByLabelText('Hora'), '19:30')
    await userEvent.type(within(hoja).getByLabelText('Hora de fin'), '21:00')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear entreno' }))

    expect(await screen.findByText(/Entreno creado: .* · 19:30–21:00/)).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/entrenos')).toEqual([
      { fecha: HOY, hora: '19:30', horaFin: '21:00' },
    ])
    expect(await screen.findByRole('button', { name: 'Asiste' })).toBeInTheDocument()
    expect(router.state.location.search).toBe('?entreno=n1')
  })

  it('con doble sesión se elige la sesión y + añade otra', async () => {
    conCalendario([resumen('e1', HOY, '10:00'), resumen('e2', HOY, '18:00', { asiste: 1 })])
    const router = abrir('/plantillas/p1/entrenos')
    const sesiones = await screen.findByRole('group', { name: 'Sesiones del día' })
    expect(within(sesiones).getByRole('button', { name: /10:00/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(sesiones).getByRole('button', { name: /18:00/ }))
    expect(router.state.location.search).toBe('?entreno=e2')
    expect(within(sesiones).getByRole('button', { name: /18:00/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    // Una sesión a una hora ya ocupada da error en el campo
    await userEvent.click(within(sesiones).getByRole('button', { name: 'Añadir sesión' }))
    const hoja = screen.getByRole('dialog', { name: 'Crear entreno' })
    await userEvent.type(within(hoja).getByLabelText('Hora'), '18:00')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear entreno' }))
    expect(await within(hoja).findByText(/Ya hay un entreno/)).toBeInTheDocument()
  })

  it('se cambia la hora de un entreno; el fin ha de ser posterior al inicio', async () => {
    conCalendario([resumen('e1', HOY, '20:00', { horaFin: '21:30', deHorario: true })])
    abrir('/plantillas/p1/entrenos')
    await opcion('Cambiar la hora')
    const hoja = screen.getByRole('dialog', { name: 'Cambiar la hora' })
    expect(within(hoja).getByLabelText('Hora')).toHaveValue('20:00')
    expect(within(hoja).getByLabelText('Hora de fin')).toHaveValue('21:30')

    await userEvent.clear(within(hoja).getByLabelText('Hora de fin'))
    await userEvent.type(within(hoja).getByLabelText('Hora de fin'), '19:00')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))
    expect(
      within(hoja).getByText('La hora de fin debe ser posterior a la de inicio'),
    ).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/entrenos/e1')).toEqual([])

    await userEvent.clear(within(hoja).getByLabelText('Hora'))
    await userEvent.type(within(hoja).getByLabelText('Hora'), '18:30')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText(/Hora cambiada: .* · 18:30–19:00/)).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/entrenos/e1')).toEqual([
      { hora: '18:30', horaFin: '19:00' },
    ])
  })

  it('cancelar un entreno con asistencia pide confirmación y avisa', async () => {
    conCalendario([resumen('e1', HOY, '20:00', { asiste: 3 })])
    abrir('/plantillas/p1/entrenos')
    await opcion('Cancelar entreno')
    const confirmacion = await screen.findByRole('alertdialog')
    expect(confirmacion).toHaveTextContent('se borrará también su asistencia')
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Cancelar entreno' }))
    expect(await screen.findByText(/Entreno cancelado/)).toBeInTheDocument()
    expect(await screen.findByText('No hay entreno este día')).toBeInTheDocument()
  })

  it('un entreno futuro no deja pasar lista, pero sí cancelarlo', async () => {
    conCalendario([resumen('e1', MANANA, '20:00', { deHorario: true })])
    abrir(`/plantillas/p1/entrenos?fecha=${MANANA}`)
    expect(await screen.findByText(/aún no ha llegado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Asiste' })).not.toBeInTheDocument()
    await opcion('Cancelar entreno')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  })

  it('el «⋯» de la sesión abre sus opciones, y al final de la lista ya no hay botones (GH-261)', async () => {
    conCalendario([resumen('e1', HOY, '20:00', { horaFin: '21:30' })])
    abrir('/plantillas/p1/entrenos')
    await userEvent.click(await screen.findByRole('button', { name: 'Opciones del entreno' }))
    const hoja = screen.getByRole('dialog', { name: 'Opciones del entreno' })
    expect(hoja).toHaveTextContent(/Hoy · miércoles, 14 oct · 20:00–21:30/)
    const opciones = within(hoja)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
    expect(opciones).toEqual([
      'Cambiar la hora',
      'Planificar el entreno',
      'Resumen para WhatsApp',
      'Cancelar entreno',
    ])
    expect(within(hoja).getByRole('link', { name: 'Planificar el entreno' })).toHaveAttribute(
      'href',
      '/plantillas/p1/entrenos/plan/e1',
    )

    // El resumen para WhatsApp cierra las opciones y abre su hoja
    await userEvent.click(within(hoja).getByRole('button', { name: 'Resumen para WhatsApp' }))
    expect(await screen.findByRole('dialog', { name: 'Resumen para WhatsApp' })).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: 'Cambiar hora' })).not.toBeInTheDocument()
  })
})

describe('horario', () => {
  function conHorario(guardado: Horario | null, p = senior26) {
    conDatos({ plantillas: [p] })
    let actual = guardado
    manejadores['GET /api/plantillas/p1/horario'] = () => json(actual)
    manejadores['PUT /api/plantillas/p1/horario'] = async (peticion) => {
      actual = (await peticion.json()) as Horario
      return json({ horario: actual, creados: 66, borrados: guardado ? 60 : 0 })
    }
    manejadores['DELETE /api/plantillas/p1/horario'] = () => {
      actual = null
      return json({ borrados: 60 })
    }
  }

  it('marca días y hora, avisa de cuántos entrenos crea y guarda', async () => {
    conHorario(null)
    abrir('/plantillas/p1/entrenos/horario')
    expect(await screen.findByLabelText('Hasta')).toHaveValue('2027-06-30')
    expect(screen.getByLabelText('Desde')).toHaveValue(HOY)

    await userEvent.click(screen.getByRole('button', { name: 'martes' }))
    await userEvent.click(screen.getByRole('button', { name: 'jueves' }))
    expect(screen.getByLabelText('Inicio del martes')).toHaveValue('20:00')
    // Fin antes que el inicio: no se guarda
    await userEvent.type(screen.getByLabelText('Fin del martes (opcional)'), '19:00')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }))
    expect(screen.getByText('La hora de fin debe ser posterior a la de inicio')).toBeInTheDocument()
    // El error, debajo de su fila y ligado al campo (GH-270)
    expect(screen.getByLabelText('Fin del martes (opcional)')).toHaveAccessibleDescription(
      'La hora de fin debe ser posterior a la de inicio',
    )
    expect(enviado('PUT /api/plantillas/p1/horario')).toEqual([])
    await userEvent.clear(screen.getByLabelText('Fin del martes (opcional)'))
    await userEvent.type(screen.getByLabelText('Fin del martes (opcional)'), '21:30')
    await userEvent.type(screen.getByLabelText('Fin del jueves (opcional)'), '21:30')

    // «Hasta» elegido: del miércoles 14 al jueves 29 de octubre hay dos martes y tres jueves
    const hasta = screen.getByLabelText('Hasta')
    await userEvent.clear(hasta)
    await userEvent.type(hasta, '2026-10-29')
    expect(
      screen.getByText(
        /Se crean 5 entrenos: los martes y jueves de 20:00 a 21:30, del 14 de octubre al 29 de octubre/,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }))
    expect(await screen.findByText('Horario guardado: 66 entrenos creados')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/horario')).toEqual([
      {
        desde: HOY,
        hasta: '2026-10-29',
        sesiones: [
          { dia: 2, hora: '20:00', horaFin: '21:30' },
          { dia: 4, hora: '20:00', horaFin: '21:30' },
        ],
      },
    ])
  })

  it('sin días marcados no se guarda', async () => {
    conHorario(null)
    abrir('/plantillas/p1/entrenos/horario')
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar horario' }))
    expect(screen.getByText('Marca al menos un día de entreno')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/horario')).toEqual([])
  })

  it('un horario guardado se puede quitar, con confirmación', async () => {
    conHorario({ desde: '2026-09-01', hasta: '2027-06-15', sesiones: [{ dia: 2, hora: '20:00' }] })
    abrir('/plantillas/p1/entrenos/horario')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar horario' }))
    expect(await screen.findByRole('button', { name: 'martes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    // Sin tocar nada, nada que guardar (GH-269)
    expect(screen.getByText('Sin cambios respecto al horario guardado.')).toBeInTheDocument()
    const guardar = screen.getByRole('button', { name: 'Guardar horario' })
    expect(guardar).toBeDisabled()
    // Junto a Guardar solo queda Cancelar; Quitar va aparte, con lo que hace (GH-271)
    const junto = within(guardar.parentElement as HTMLElement).getAllByRole('button')
    expect(junto.map((b) => b.textContent)).toEqual(['Guardar horario', 'Cancelar'])
    const quitarBoton = screen.getByRole('button', { name: 'Quitar horario' })
    expect(quitarBoton).toHaveAccessibleDescription(
      'Borra los entrenos futuros del horario que no tienen lista pasada',
    )
    expect(
      guardar.compareDocumentPosition(quitarBoton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await userEvent.click(quitarBoton)
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Quitar horario' }),
    )
    expect(
      await screen.findByText('Horario quitado: 60 entrenos futuros borrados'),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Quitar horario' })).not.toBeInTheDocument(),
    )
  })

  it('sin permiso solo se ve el horario', async () => {
    conHorario(
      {
        desde: '2026-09-01',
        hasta: '2027-06-15',
        sesiones: [
          { dia: 2, hora: '20:00', horaFin: '21:30' },
          { dia: 4, hora: '18:00' },
        ],
      },
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }),
    )
    abrir('/plantillas/p1/entrenos/horario')
    // El mismo resumen que el cuerpo técnico, sin las cifras ni el botón (GH-268)
    const resumen = await screen.findByRole('region', { name: 'Horario de entrenos' })
    expect(
      within(resumen)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Martes · 20:00–21:30', 'Jueves · 18:00'])
    expect(resumen).toHaveTextContent('Del 1 sept al 15 jun')
    expect(within(resumen).queryByText(/Entrenos hechos/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar horario' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument()
  })

  it('guardado, se ve como resumen; «Editar horario» abre el formulario y «Cancelar» vuelve (GH-268)', async () => {
    conHorario({
      desde: '2026-09-01',
      hasta: '2027-06-15',
      sesiones: [
        { dia: 2, hora: '20:00', horaFin: '21:30' },
        { dia: 4, hora: '20:00', horaFin: '21:30' },
      ],
    })
    const entreno = (id: string, fecha: string, deHorario = true) => ({
      ...resumen(id, fecha, '20:00', { deHorario }),
    })
    manejadores['GET /api/plantillas/p1/entrenos'] = () =>
      json([
        entreno('a', '2026-10-15'),
        entreno('b', '2026-10-13'),
        entreno('c', '2026-10-08'),
        entreno('s', '2026-10-10', false),
      ])
    abrir('/plantillas/p1/entrenos/horario')
    const resumenHorario = await screen.findByRole('region', { name: 'Horario de entrenos' })
    expect(within(resumenHorario).getByText('Martes y jueves')).toBeInTheDocument()
    expect(resumenHorario).toHaveTextContent('Martes y jueves · 20:00–21:30')
    expect(resumenHorario).toHaveTextContent('Del 1 sept al 15 jun')
    // Del horario (sin el suelto): dos ya hechos y uno por venir
    expect(await within(resumenHorario).findByText('Entrenos hechos')).toBeInTheDocument()
    expect(resumenHorario).toHaveTextContent(/Entrenos hechos2Por venir1/)
    expect(screen.queryByRole('button', { name: 'martes' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Editar horario' }))
    expect(screen.getByRole('button', { name: 'martes' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('region', { name: 'Horario de entrenos' })).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/horario')).toEqual([])

    // Al guardar también vuelve al resumen
    await userEvent.click(screen.getByRole('button', { name: 'Editar horario' }))
    await userEvent.click(screen.getByRole('button', { name: 'miércoles' }))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }))
    expect(await screen.findByRole('region', { name: 'Horario de entrenos' })).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/horario')).toHaveLength(1)
  })
})

describe('historial', () => {
  it('muestra los próximos y marca los pasados sin lista', async () => {
    conCalendario([
      resumen('f2', '2026-10-20', '20:00'),
      resumen('f1', MANANA, '20:00'),
      resumen('p2', '2026-10-13', '20:00'),
      resumen('p1', '2026-10-08', '20:00', { asiste: 9, falta: 1, horaFin: '21:30' }),
    ])
    abrir('/plantillas/p1/entrenos/historial')
    // El próximo en una línea y el resto plegado: siguen en el DOM, dentro de «1 próximo más» (GH-264)
    const proximos = await screen.findByRole('region', { name: 'Próximos' })
    expect(
      within(proximos)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      expect.stringMatching(/jueves, 15 oct · 20:00Sin respuestas/),
      expect.stringMatching(/martes, 20 oct · 20:00Sin respuestas/),
    ])
    // Cada pasado se lee entero: el día, la hora, el porcentaje y los recuentos (GH-265)
    const octubre = screen.getByRole('region', { name: 'octubre de 2026' })
    const enlaces = within(octubre).getAllByRole('link')
    expect(enlaces.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Ayer · martes, 13 oct, 20:00: sin pasar lista',
      'Jueves, 8 oct, 20:00–21:30: 90 % de asistencia, 9 asisten, 0 justificadas, 1 falta',
    ])
    expect(enlaces[0]).toHaveTextContent('Sin pasar lista')
    expect(enlaces[1]).toHaveTextContent('90 %')
  })

  it('el porcentaje de cada entreno con el color de su nivel, y los ceros en gris (GH-265)', async () => {
    conCalendario([
      resumen('a', '2026-10-08', '20:00', { asiste: 9, falta: 1 }),
      resumen('b', '2026-10-06', '20:00', { asiste: 6, justificada: 2, falta: 2 }),
      resumen('c', '2026-10-01', '20:00', { asiste: 1, falta: 2 }),
    ])
    abrir('/plantillas/p1/entrenos/historial')
    const octubre = await screen.findByRole('region', { name: 'octubre de 2026' })
    const [alto, medio, bajo] = within(octubre).getAllByRole('link') as HTMLElement[]
    expect(within(alto as HTMLElement).getByText('90 %')).toHaveAttribute('data-nivel', 'alto')
    expect(within(medio as HTMLElement).getByText('60 %')).toHaveAttribute('data-nivel', 'medio')
    expect(within(bajo as HTMLElement).getByText('33 %')).toHaveAttribute('data-nivel', 'bajo')
    // La justificada de «a» es 0: sin el color de su estado, y con la mano (GH-256)
    const justificada = (alto as HTMLElement).querySelector('.lucide-hand')?.parentElement
    expect(justificada).toHaveTextContent('0')
    expect(justificada?.className).not.toMatch(/justificada/)
  })
})

describe('meses del historial (GH-266)', () => {
  it('cada mes con su resumen; el en curso y el anterior abiertos, los antiguos plegados', async () => {
    conCalendario([
      resumen('o1', '2026-10-08', '20:00', { asiste: 9, falta: 1 }),
      resumen('o2', '2026-10-06', '20:00', { asiste: 5, justificada: 1, falta: 4 }),
      resumen('o3', '2026-10-01', '20:00'),
      resumen('s1', '2026-09-29', '20:00'),
      resumen('a1', '2026-08-25', '20:00', { asiste: 8, falta: 2 }),
    ])
    abrir('/plantillas/p1/entrenos/historial')
    const octubre = await screen.findByRole('region', { name: 'octubre de 2026' })
    // 14 asisten de 20 marcados: 70 %
    const cabecera = within(octubre).getByRole('button', { expanded: true })
    expect(cabecera).toHaveTextContent(
      'Octubre de 2026 · 3 entrenos · 70 % asistencia · 1 sin lista',
    )
    expect(within(octubre).getAllByRole('link')).toHaveLength(3)

    const septiembre = screen.getByRole('region', { name: 'septiembre de 2026' })
    expect(within(septiembre).getByRole('button', { expanded: true })).toHaveTextContent(
      '1 entreno · ninguna lista pasada',
    )

    const agosto = screen.getByRole('region', { name: 'agosto de 2026' })
    const plegado = within(agosto).getByRole('button', { expanded: false })
    expect(plegado).toHaveTextContent('Agosto de 2026 · 1 entreno · 80 % asistencia')
    expect(within(agosto).queryByRole('link')).not.toBeInTheDocument()

    await userEvent.click(plegado)
    expect(plegado).toHaveAttribute('aria-expanded', 'true')
    expect(within(agosto).getAllByRole('link')).toHaveLength(1)
  })
})

describe('dobles sesiones en el historial (GH-267)', () => {
  it('las sesiones del mismo día van bajo una fila con el día, y cada una abre la suya', async () => {
    conCalendario([
      resumen('t', '2026-10-13', '10:00', { asiste: 8, falta: 2 }),
      resumen('n', '2026-10-13', '20:00'),
      resumen('u', '2026-10-08', '20:00', { asiste: 9, falta: 1 }),
    ])
    abrir('/plantillas/p1/entrenos/historial')
    const octubre = await screen.findByRole('region', { name: 'octubre de 2026' })
    const dias = within(octubre)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement?.id)
    expect(dias).toHaveLength(2)
    const doble = dias[0] as HTMLElement
    expect(doble).toHaveTextContent(/^Ayer · martes, 13 oct2 sesiones/)
    const sesiones = within(doble).getAllByRole('link')
    expect(sesiones.map((a) => a.getAttribute('aria-label'))).toEqual([
      'Ayer · martes, 13 oct, 10:00: 80 % de asistencia, 8 asisten, 0 justificadas, 2 faltan',
      'Ayer · martes, 13 oct, 20:00: sin pasar lista',
    ])
    expect(sesiones[0]).toHaveTextContent(/^10:00/)
    expect(sesiones[1]).toHaveTextContent(/^20:00Sin pasar lista/)
    expect(sesiones[1]).toHaveAttribute(
      'href',
      '/plantillas/p1/entrenos?fecha=2026-10-13&entreno=n',
    )
    // Un día de una sola sesión, como siempre
    expect(within(dias[1] as HTMLElement).getByRole('link')).toHaveTextContent(/^Jueves, 8 oct/)
  })
})

describe('aviso del horario (GH-269)', () => {
  it('con horario guardado, dice solo lo que cambia, según el servidor', async () => {
    conDatos({ plantillas: [senior26] })
    const guardado = {
      desde: '2026-09-01',
      hasta: '2027-06-15',
      sesiones: [
        { dia: 2, hora: '20:00', horaFin: '21:30' },
        { dia: 4, hora: '20:00', horaFin: '21:30' },
      ],
    }
    manejadores['GET /api/plantillas/p1/horario'] = () => json(guardado)
    manejadores['GET /api/plantillas/p1/entrenos'] = () => json([])
    manejadores['POST /api/plantillas/p1/horario/simulacion'] = () =>
      json({
        guardado: true,
        igualAlGuardado: false,
        creados: 60,
        anadidos: [{ dia: 3, franja: '20:00–21:30', cuantos: 30 }],
        quitados: [{ dia: 4, franja: '20:00–21:30', cuantos: 30 }],
        cambios: [{ dia: 2, de: '20:00–21:30', a: '19:30–21:00', cuantos: 1 }],
      })
    abrir('/plantillas/p1/entrenos/horario')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar horario' }))
    expect(screen.getByText('Sin cambios respecto al horario guardado.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'miércoles' }))
    const aviso = await screen.findByRole('list', {}, { timeout: 2000 })
    expect(
      within(aviso)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      '+ Se añaden 30 entrenos los miércoles',
      '− Se quitan 30 entrenos de los jueves',
      '↻ Cambia la hora de 1 entreno del martes: de 20:00–21:30 a 19:30–21:00',
    ])
    expect(
      screen.getByText(/Los entrenos sueltos y los que ya tienen la lista pasada/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar horario' })).toBeEnabled()
    // Se pide con el horario del formulario
    expect(enviado('POST /api/plantillas/p1/horario/simulacion').at(-1)).toMatchObject({
      sesiones: [
        { dia: 2, hora: '20:00' },
        { dia: 3, hora: '20:00' },
        { dia: 4, hora: '20:00' },
      ],
    })
  })
})

describe('formulario del horario (GH-270)', () => {
  it('una fila por día con inicio y fin, y las fechas como temporada', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/horario'] = () => json(null)
    abrir('/plantillas/p1/entrenos/horario')
    await userEvent.click(await screen.findByRole('button', { name: 'martes' }))
    await userEvent.click(screen.getByRole('button', { name: 'jueves' }))

    const horas = screen.getByRole('group', { name: 'Horas de entreno' })
    const inicio = within(horas).getByLabelText('Inicio del martes')
    const fila = inicio.parentElement as HTMLElement
    expect(fila).toHaveTextContent(/^Martes–$/)
    expect(within(fila).getByLabelText('Fin del martes (opcional)')).toBeInTheDocument()
    expect(within(horas).getByLabelText('Inicio del jueves')).toBeInTheDocument()

    const temporada = screen.getByRole('group', { name: 'Temporada de entrenos' })
    expect(temporada).toHaveTextContent('al')
    expect(within(temporada).getByLabelText('Desde')).toHaveValue('2026-10-14')
    expect(within(temporada).getByLabelText('Hasta')).toHaveValue('2027-06-30')
    expect(screen.queryByText(/El último día con entrenos/)).not.toBeInTheDocument()
  })
})
