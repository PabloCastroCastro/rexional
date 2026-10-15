import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Entreno, Horario, ResumenEntreno } from '../src/entrenos/datos'
import { abrir, conDatos, json, manejadores, peticiones, plantilla, senior26 } from './simulacion'

// Hoy es miércoles 14 de octubre de 2026 en Madrid (solo se simula la fecha)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const HOY = '2026-10-14'
const MANANA = '2026-10-15'

const resumen = (
  id: string,
  fecha: string,
  hora: string | null,
  extra: Partial<ResumenEntreno> = {},
): ResumenEntreno => ({
  id,
  fecha,
  hora,
  deHorario: false,
  asiste: 0,
  justificada: 0,
  falta: 0,
  ...extra,
})

const detalle = (r: ResumenEntreno): Entreno => ({
  id: r.id,
  fecha: r.fecha,
  hora: r.hora,
  deHorario: r.deHorario,
  recuentos: { asiste: r.asiste, justificada: r.justificada, falta: r.falta },
  jugadores: [
    {
      jugadorId: 'j1',
      nombre: 'Íker',
      apellidos: null,
      dorsal: 1,
      posicion: null,
      activo: true,
      estado: null,
      motivo: null,
    },
  ],
})

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

// La API simulada del calendario: crea, cancela y consulta por día
function conCalendario(inicial: ResumenEntreno[], p = senior26) {
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
    const { fecha, hora } = (await peticion.json()) as { fecha: string; hora: string | null }
    if (entrenos.some((e) => e.fecha === fecha && e.hora === hora)) {
      const mensaje = `Ya hay un entreno el ${fecha} a las ${hora}`
      return json({ error: { codigo: 'entreno_duplicado', mensaje } }, 409)
    }
    const nuevo = resumen(`n${siguiente++}`, fecha, hora)
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
  }
}

describe('entrenos del día', () => {
  it('en un día sin entreno se crea uno y se pasa lista de él', async () => {
    conCalendario([])
    const router = abrir('/plantillas/p1/entrenos')
    await userEvent.click(await screen.findByRole('button', { name: 'Crear entreno' }))
    const hoja = screen.getByRole('dialog', { name: 'Crear entreno' })
    await userEvent.type(within(hoja).getByLabelText('Hora'), '19:30')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear entreno' }))

    // Crear, refrescar el día y cargar el entreno son varias peticiones seguidas: más margen
    expect(await screen.findByText(/Entreno creado/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/entrenos')).toEqual([{ fecha: HOY, hora: '19:30' }])
    expect(
      await screen.findByRole('button', { name: 'Asiste' }, { timeout: 3000 }),
    ).toBeInTheDocument()
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

  it('cancelar un entreno con asistencia pide confirmación y avisa', async () => {
    conCalendario([resumen('e1', HOY, '20:00', { asiste: 3 })])
    abrir('/plantillas/p1/entrenos')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar entreno' }))
    const confirmacion = screen.getByRole('alertdialog')
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
    expect(screen.getByRole('button', { name: 'Cancelar entreno' })).toBeInTheDocument()
  })

  it('sin permiso no se crean ni cancelan entrenos', async () => {
    conCalendario(
      [resumen('e1', HOY, '20:00')],
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }),
    )
    abrir('/plantillas/p1/entrenos')
    expect(await screen.findByText('Pasar lista es cosa del cuerpo técnico.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir sesión' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar entreno' })).not.toBeInTheDocument()
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
    expect(screen.getByLabelText('Hora del martes')).toHaveValue('20:00')

    // «Hasta» elegido: del miércoles 14 al jueves 29 de octubre hay dos martes y tres jueves
    const hasta = screen.getByLabelText('Hasta')
    await userEvent.clear(hasta)
    await userEvent.type(hasta, '2026-10-29')
    expect(
      screen.getByText(
        /Se crearán 5 entrenos: los martes y jueves a las 20:00, del 14 de octubre al 29 de octubre/,
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Guardar horario' }))
    expect(await screen.findByText('Horario guardado: 66 entrenos creados')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/horario')).toEqual([
      {
        desde: HOY,
        hasta: '2026-10-29',
        sesiones: [
          { dia: 2, hora: '20:00' },
          { dia: 4, hora: '20:00' },
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
    expect(await screen.findByRole('button', { name: 'martes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/se rehacen/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Quitar horario' }))
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
          { dia: 2, hora: '20:00' },
          { dia: 4, hora: '20:00' },
        ],
      },
      plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }),
    )
    abrir('/plantillas/p1/entrenos/horario')
    expect(
      await screen.findByText(
        /Entrenos los martes y jueves a las 20:00, del 1 de septiembre al 15 de junio/,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar horario' })).not.toBeInTheDocument()
  })
})

describe('historial', () => {
  it('muestra los próximos y marca los pasados sin lista', async () => {
    conCalendario([
      resumen('f2', '2026-10-20', '20:00'),
      resumen('f1', MANANA, '20:00'),
      resumen('p2', '2026-10-13', '20:00'),
      resumen('p1', '2026-10-08', '20:00', { asiste: 9, falta: 1 }),
    ])
    abrir('/plantillas/p1/entrenos/historial')
    const proximos = await screen.findByRole('region', { name: 'Próximos' })
    expect(
      within(proximos)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      expect.stringMatching(/jueves, 15 oct · 20:00/),
      expect.stringMatching(/martes, 20 oct · 20:00/),
    ])
    const octubre = screen.getByRole('region', { name: 'octubre de 2026' })
    expect(
      within(octubre)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      expect.stringMatching(/Ayer.*Sin pasar lista/),
      expect.stringMatching(/jueves, 8 oct · 20:00.*9 asisten/),
    ])
  })
})
