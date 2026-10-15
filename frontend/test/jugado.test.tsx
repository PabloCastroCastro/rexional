import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Partido } from '../src/partidos/datos'
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

// Partido jugado: marcador, titulares y suplentes, registro rápido y línea de tiempo

const jugador = (jugadorId: string, nombre: string, dorsal: number, titular: boolean | null) => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: null,
  activo: true,
  convocado: true,
  titular,
  minutos: titular === null ? null : titular ? 90 : 0,
})

const PARTIDO: Partido = {
  id: 'p1',
  rival: 'CD Lalín',
  competicion: null,
  fecha: '2026-10-11',
  hora: null,
  horaCitacion: null,
  lugar: null,
  local: true,
  estado: 'jugado',
  golesFavor: 2,
  golesContra: 1,
  jugadores: [
    jugador('j1', 'Íker', 1, true),
    jugador('j2', 'Brais', 7, true),
    jugador('j3', 'Zoe', 12, false),
  ],
  eventos: [
    { id: 'e1', jugadorId: 'j2', tipo: 'gol', minuto: 19, origen: 'acta' },
    { id: 'e2', jugadorId: 'j1', tipo: 'amarilla', minuto: 30, origen: 'manual' },
  ],
  acta: null,
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

function conPartido(p = senior26, partido = PARTIDO) {
  conDatos({ plantillas: [p] })
  let actual = partido
  manejadores['GET /api/plantillas/p1/partidos/p1'] = () => json(actual)
  manejadores['GET /api/plantillas/p1/partidos/p1/mensaje'] = () =>
    json({ texto: 'Convocatoria', whatsapp: 'https://wa.me/' })
  manejadores['PUT /api/plantillas/p1/partidos/p1/resultado'] = async (peticion) => {
    actual = { ...actual, ...((await peticion.json()) as object), estado: 'jugado' }
    return json(actual)
  }
  manejadores['PATCH /api/plantillas/p1/partidos/p1'] = () => {
    actual = { ...actual, estado: 'aplazado', golesFavor: null, golesContra: null }
    return json(actual)
  }
  manejadores['POST /api/plantillas/p1/partidos/p1/eventos/lote'] = async (peticion) => {
    const { eventos } = (await peticion.json()) as { eventos: Partido['eventos'] }
    if (eventos.some((e) => e.jugadorId === 'j3' && e.tipo === 'gol')) {
      return json(
        {
          error: {
            codigo: 'estadisticas_incoherentes',
            mensaje: 'Un gol tiene que ser de alguien que está en el campo',
          },
        },
        400,
      )
    }
    actual = {
      ...actual,
      eventos: [
        ...actual.eventos,
        ...eventos.map((e, n) => ({ ...e, id: `n${n}`, origen: 'manual' as const })),
      ],
    }
    return json(actual, 201)
  }
  manejadores['DELETE /api/plantillas/p1/partidos/p1/eventos/e2'] = () => {
    actual = { ...actual, eventos: actual.eventos.filter((e) => e.id !== 'e2') }
    return json(actual)
  }
  manejadores['PUT /api/plantillas/p1/partidos/p1/participaciones'] = () => json(actual)
}

const hoja = () => screen.getByRole('dialog')

describe('partido jugado', () => {
  it('muestra el marcador, la línea de tiempo y los minutos de cada convocado', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByText('2–1')).toBeInTheDocument()
    const linea = screen.getByRole('list', { name: 'Línea de tiempo' })
    expect(
      within(linea)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(["19'Gol de Braisacta", "30'Amarilla a Íker"])
    expect(screen.getByRole('list', { name: 'Convocados' })).toHaveTextContent(
      "Zoe · Suplente · 0'",
    )
  })

  it('se cambia el resultado con los contadores y se aplaza', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar resultado' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Sumar un gol: Senior' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Quitar un gol: CD Lalín' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Guardar resultado' }))
    expect(await screen.findByText('Resultado guardado: 3–0')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/resultado')).toEqual([
      { golesFavor: 3, golesContra: 0 },
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar resultado' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Aplazar partido' }))
    expect(await screen.findByText('Partido aplazado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/partidos/p1')).toEqual([{ estado: 'aplazado' }])
    expect(screen.getByText('Aplazado')).toBeInTheDocument()
  })

  it('un gol con asistencia se registra de una vez; los errores del servidor se ven en la hoja', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    // Zoe es suplente y no ha entrado: no aparece para marcar
    expect(within(hoja()).getByLabelText('Jugador')).not.toHaveTextContent('Zoe')
    await userEvent.selectOptions(within(hoja()).getByLabelText('Jugador'), 'j1')
    await userEvent.selectOptions(within(hoja()).getByLabelText('Asistencia (opcional)'), 'j2')
    const minuto = within(hoja()).getByLabelText(/Minuto/)
    expect(minuto).toHaveValue(30)
    await userEvent.clear(minuto)
    await userEvent.type(minuto, '75')
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Gol registrado')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos/p1/eventos/lote')).toEqual([
      {
        eventos: [
          { jugadorId: 'j1', tipo: 'gol', minuto: 75 },
          { jugadorId: 'j2', tipo: 'asistencia', minuto: 75 },
        ],
      },
    ])
    expect(screen.getByRole('list', { name: 'Línea de tiempo' })).toHaveTextContent(
      'Asistencia de Brais',
    )
  })

  it('un cambio: entra un suplente y sale alguien del campo, con minuto', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Cambio' }))
    expect(within(hoja()).getByLabelText('Entra')).toHaveTextContent('Zoe')
    expect(within(hoja()).getByLabelText('Entra')).not.toHaveTextContent('Íker')
    await userEvent.selectOptions(within(hoja()).getByLabelText('Entra'), 'j3')
    await userEvent.selectOptions(within(hoja()).getByLabelText('Sale'), 'j2')
    await userEvent.clear(within(hoja()).getByLabelText(/Minuto/))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Registrar' }))
    expect(within(hoja()).getByRole('alert')).toHaveTextContent('Los cambios necesitan el minuto')
    await userEvent.type(within(hoja()).getByLabelText(/Minuto/), '60')
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Registrar' }))
    expect(await screen.findByText('Cambio registrado')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos/p1/eventos/lote')).toEqual([
      {
        eventos: [
          { jugadorId: 'j3', tipo: 'entra', minuto: 60 },
          { jugadorId: 'j2', tipo: 'sale', minuto: 60 },
        ],
      },
    ])
  })

  it('sin titulares indicados, para los cambios se pide la alineación', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: PARTIDO.jugadores.map((j) => ({ ...j, titular: null, minutos: null })),
    })
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Cambio' }))
    expect(within(hoja()).getByRole('link', { name: 'titulares y suplentes' })).toBeInTheDocument()
  })

  it('se borra un evento con confirmación', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar: Amarilla a Íker' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Borrar' }),
    )
    expect(await screen.findByText('Evento borrado')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Línea de tiempo' })).not.toHaveTextContent('Amarilla')
  })

  it('un jugador ve el partido, pero no lo cambia', async () => {
    conPartido(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByText('2–1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Añadir' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar resultado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Borrar:/ })).not.toBeInTheDocument()
  })
})

describe('titulares y suplentes', () => {
  it('se marcan los titulares (como mucho 11) y el resto queda de suplente', async () => {
    conPartido()
    const router = abrir('/plantillas/p1/partidos/p1/alineacion')
    expect(await screen.findByText(/de 11 titulares/)).toHaveTextContent(
      '2 de 11 titulares · 1 suplentes',
    )
    await userEvent.click(screen.getByText('Brais'))
    await userEvent.click(screen.getByText('Zoe'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Guardado: 2 titulares y 1 suplente')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/participaciones')).toEqual([
      { titulares: ['j1', 'j3'], suplentes: ['j2'] },
    ])
    expect(ruta(router)).toBe('/plantillas/p1/partidos/p1')
  })

  it('con más de 11 titulares no se guarda', async () => {
    const doce = Array.from({ length: 12 }, (_, k) => jugador(`t${k}`, `Jugador ${k}`, k + 1, true))
    conPartido(senior26, { ...PARTIDO, jugadores: doce })
    abrir('/plantillas/p1/partidos/p1/alineacion')
    expect(await screen.findByText('No puede haber más de 11 titulares.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  })
})
