import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Partido } from '../src/partidos/datos'
import { filasDelPartido } from '../src/partidos/Jugado'

type Evento = Partido['eventos'][number]

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
  tipo: 'propia' as const,
  procedencia: null,
  lesion: null,
  convocado: true,
  sancion: null,
  entrenosPrevios: null,
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
  videos: [],
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

// «Editar» abre la edición del partido (GH-286) y, en ella, se elige qué hacer
async function editarYElegir(boton: string) {
  await userEvent.click(await screen.findByRole('button', { name: 'Editar el partido' }))
  await userEvent.click(
    within(screen.getByRole('dialog', { name: 'Editar el partido' })).getByRole('button', {
      name: boton,
    }),
  )
}

describe('partido jugado', () => {
  it('muestra el marcador, la línea de tiempo y los minutos de cada convocado', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1?pestana=partido')
    expect(await screen.findByText('2–1')).toBeInTheDocument()
    // En la tarjeta (GH-229), con su pastilla de victoria, y una sola vez en la página
    expect(screen.getAllByText('2–1')).toHaveLength(1)
    expect(screen.getByText('Victoria')).toHaveAttribute('data-resultado', 'victoria')
    const linea = screen.getByRole('list', { name: 'Línea de tiempo' })
    expect(
      within(linea)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(["19'Gol de Braisacta", "30'Amarilla a Íker"])
    // La alineación aparte, en dos columnas con los minutos (GH-286)
    expect(screen.getByRole('list', { name: 'Titulares' })).toHaveTextContent('Brais')
    expect(screen.getByRole('list', { name: 'Suplentes' })).toHaveTextContent("Zoe0'")
    expect(screen.getByRole('link', { name: 'Editar la alineación' })).toHaveAttribute(
      'href',
      '/plantillas/p1/partidos/p1/alineacion',
    )
    // En la vista, sin papeleras
    expect(screen.queryByRole('button', { name: /Borrar:/ })).not.toBeInTheDocument()
    // 2–1 con un solo gol registrado: se avisa de cómo añadir el otro
    expect(screen.getByRole('note')).toHaveTextContent('Falta 1 gol por asignar')
  })

  it('ya jugado y sin resultado: «Subir el acta» y, si no, ponerlo a mano (GH-287)', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      estado: 'programado',
      golesFavor: null,
      golesContra: null,
      eventos: [],
    })
    abrir('/plantillas/p1/partidos/p1?pestana=partido')
    const seccion = await screen.findByRole('region', { name: 'El partido' })
    expect(seccion).toHaveTextContent('Falta el resultado')
    expect(seccion).toHaveTextContent('se leen el resultado, los titulares, los cambios')
    // La principal, subir el acta; la secundaria, a mano
    expect(within(seccion).getByRole('button', { name: 'Subir el acta' })).toHaveClass('primario')
    expect(within(seccion).queryByText(/Todavía no hay goles/)).not.toBeInTheDocument()
    await userEvent.click(
      within(seccion).getByRole('button', { name: 'Poner el resultado a mano' }),
    )
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Sumar un gol: Senior' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Guardar resultado' }))
    expect(await screen.findByText(/Resultado guardado/)).toBeInTheDocument()
    // Con resultado, la pestaña muestra la línea del partido y su «Editar»
    expect(within(seccion).queryByText('Falta el resultado')).not.toBeInTheDocument()
    expect(within(seccion).getByRole('button', { name: 'Editar el partido' })).toBeInTheDocument()
  })

  it('se cambia el resultado con los contadores y se aplaza', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await editarYElegir('Cambiar resultado')
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Sumar un gol: Senior' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Quitar un gol: CD Lalín' }))
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Guardar resultado' }))
    expect(await screen.findByText('Resultado guardado: 3–0')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/resultado')).toEqual([
      { golesFavor: 3, golesContra: 0 },
    ])

    await editarYElegir('Cambiar resultado')
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Aplazar partido' }))
    expect(await screen.findByText('Partido aplazado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/partidos/p1')).toEqual([{ estado: 'aplazado' }])
    expect(screen.getByText('Aplazado')).toBeInTheDocument()
  })

  it('un gol con asistencia se registra de una vez; los errores del servidor se ven en la hoja', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Añadir gol, tarjeta o cambio' }),
    )
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
    await userEvent.click(
      await screen.findByRole('button', { name: 'Añadir gol, tarjeta o cambio' }),
    )
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
    await userEvent.click(
      await screen.findByRole('button', { name: 'Añadir gol, tarjeta o cambio' }),
    )
    await userEvent.click(within(hoja()).getByRole('button', { name: 'Cambio' }))
    expect(within(hoja()).getByRole('link', { name: 'titulares y suplentes' })).toBeInTheDocument()
  })

  it('se borra un evento con confirmación', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await editarYElegir('Borrar: Amarilla a Íker')
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
    expect(
      screen.queryByRole('button', { name: 'Añadir gol, tarjeta o cambio' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar el partido' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Editar la alineación' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Borrar:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })
})

describe('la línea del partido (GH-286)', () => {
  const ev = (
    id: string,
    tipo: Evento['tipo'],
    minuto: number | null,
    jugadorId: string | null = null,
  ): Evento => ({
    id,
    jugadorId,
    tipo,
    minuto,
    origen: 'manual',
  })

  it('el gol con su asistencia, el cambio junto, el descanso y los goles del rival sin minuto', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      eventos: [
        ev('a', 'asistencia', 19, 'j2'),
        ev('g', 'gol', 19, 'j1'),
        ev('r1', 'gol_rival', 33),
        ev('s', 'sale', 60, 'j2'),
        ev('e', 'entra', 60, 'j3'),
        ev('r2', 'gol_rival', null),
        ev('r3', 'gol_rival', null),
      ],
    })
    abrir('/plantillas/p1/partidos/p1?pestana=partido')
    const linea = await screen.findByRole('list', { name: 'Línea de tiempo' })
    expect(
      within(linea)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([
      "19'Gol de ÍkerAsistencia de Brais",
      "33'Gol de CD Lalín",
      'Descanso',
      "60'Entra ZoeSale Brais",
    ])
    // Los del rival sin minuto, resumidos al final
    expect(screen.getByText('CD Lalín marcó 2 goles sin minuto')).toBeInTheDocument()
  })

  it('ordena por minuto y, sin sucesos con minuto en la 2.ª parte, no hay descanso', () => {
    const filas = filasDelPartido([
      ev('b', 'amarilla', 30, 'j1'),
      ev('a', 'gol', 10, 'j2'),
      ev('n', 'roja', null, 'j3'),
    ])
    expect(filas.map((f) => (f.clase === 'suceso' ? f.principal.id : 'descanso'))).toEqual([
      'a',
      'b',
      'n',
    ])
  })

  it('una asistencia sin gol en su minuto va sola', () => {
    const filas = filasDelPartido([ev('a', 'asistencia', 20, 'j2'), ev('g', 'gol', 21, 'j1')])
    expect(filas).toHaveLength(2)
  })
})

describe('titulares y suplentes', () => {
  it('se marcan los titulares (como mucho 11) y el resto queda de suplente', async () => {
    conPartido()
    const router = abrir('/plantillas/p1/partidos/p1/alineacion')
    // Dos grupos con su recuento; la barra fija, el total (GH-293)
    await screen.findByRole('button', { name: 'Guardar' })
    expect(screen.getByRole('heading', { level: 2, name: /^Titulares/ })).toHaveTextContent(
      'Titulares 2 de 11',
    )
    expect(screen.getByRole('heading', { level: 2, name: /^Suplentes/ })).toHaveTextContent(
      'Suplentes 1',
    )
    expect(screen.getByRole('status')).toHaveTextContent('2 titulares · 1 suplente')
    // Sin casillas: cada uno pasa al otro grupo con su botón, que dice a quién y adónde
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a Brais a suplentes' }))
    await userEvent.click(screen.getByRole('button', { name: 'Pasar a Zoe a titulares' }))
    expect(
      within(screen.getByRole('list', { name: 'Suplentes' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringMatching(/Brais.*Titular$/)])
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
