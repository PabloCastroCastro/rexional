import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Partido, ResumenPartido } from '../src/partidos/datos'
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

// Hoy es miércoles 14 de octubre de 2026 en Madrid (solo se simula la fecha)
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T10:00:00Z'))
})
afterEach(() => vi.useRealTimers())

const resumen = (
  id: string,
  fecha: string,
  rival: string,
  extra: Partial<ResumenPartido> = {},
): ResumenPartido => ({
  id,
  rival,
  fecha,
  competicion: null,
  hora: null,
  horaCitacion: null,
  lugar: null,
  local: null,
  estado: 'programado',
  golesFavor: null,
  golesContra: null,
  convocados: 0,
  ...extra,
})

const PROXIMOS = [
  resumen('p1', '2026-10-18', 'SD Compostela', {
    hora: '17:00',
    local: false,
    competicion: 'Preferente',
    convocados: 10,
  }),
  resumen('p2', '2026-10-25', 'CD Lalín', {
    local: true,
    lugar: 'Campo municipal de Rexional',
    competicion: 'Preferente',
  }),
]
const PASADOS = [resumen('p0', '2026-10-11', 'Arosa SC', { local: true, convocados: 11 })]

const detalle = (r: ResumenPartido, convocados: string[] = []): Partido => {
  const { convocados: _n, ...datos } = r
  return {
    ...datos,
    jugadores: [
      ['j1', 'Brais', 'Iglesias', 1],
      ['j2', 'Zoe', null, null],
    ].map(([jugadorId, nombre, apellidos, dorsal]) => ({
      jugadorId: jugadorId as string,
      nombre: nombre as string,
      apellidos: apellidos as string | null,
      dorsal: dorsal as number | null,
      posicion: null,
      activo: true,
      convocado: convocados.includes(jugadorId as string),
      titular: null,
      minutos: null,
    })),
    eventos: [],
    acta: null,
    videos: [],
  }
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

function conPartidos(p = senior26, proximos = PROXIMOS, pasados = PASADOS) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/partidos'] = (peticion) =>
    json(new URL(peticion.url).searchParams.get('cuando') === 'pasados' ? pasados : proximos)
  for (const r of [...proximos, ...pasados]) {
    manejadores[`GET /api/plantillas/p1/partidos/${r.id}`] = () =>
      json(detalle(r, r.convocados ? ['j1', 'j2'] : []))
  }
}

describe('lista de partidos', () => {
  it('muestra los próximos con su convocatoria y cambia a los pasados', async () => {
    conPartidos()
    abrir('/plantillas/p1/partidos')
    const lista = await screen.findByRole('list', { name: 'Próximos partidos' })
    expect(
      within(lista)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual([
      expect.stringMatching(
        /domingo, 18 oct · 17:00.*en SD Compostela.*Fuera.*Preferente.*10 convocados/,
      ),
      expect.stringMatching(/domingo, 25 oct.*vs CD Lalín.*Casa.*Sin convocatoria/),
    ])
    await userEvent.click(screen.getByRole('button', { name: 'Pasados' }))
    const pasados = await screen.findByRole('list', { name: 'Partidos pasados' })
    expect(within(pasados).getByRole('link')).toHaveTextContent(/vs Arosa SC.*11 convocados/)
  })

  it('sin partidos invita a crear el próximo solo a quien puede', async () => {
    conPartidos(senior26, [], [])
    abrir('/plantillas/p1/partidos')
    expect(await screen.findByText('No hay partidos próximos')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Nuevo partido' })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Pasados' }))
    expect(await screen.findByText('Todavía no hay partidos jugados')).toBeInTheDocument()
  })

  it('el rol jugador ve los partidos sin crear', async () => {
    conPartidos(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos')
    expect(await screen.findByRole('list', { name: 'Próximos partidos' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo partido' })).not.toBeInTheDocument()
  })
})

describe('crear y editar', () => {
  it('crea un partido con la fecha de hoy y propone el campo en casa', async () => {
    conPartidos()
    manejadores['POST /api/plantillas/p1/partidos'] = async (peticion) => {
      const nuevo = resumen('p9', '', '', (await peticion.json()) as Partial<ResumenPartido>)
      manejadores['GET /api/plantillas/p1/partidos/p9'] = () => json(detalle(nuevo))
      return json(detalle(nuevo), 201)
    }
    const router = abrir('/plantillas/p1/partidos')
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo partido' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo partido' })
    expect(within(hoja).getByLabelText(/Fecha/)).toHaveValue('2026-10-14')

    await userEvent.type(within(hoja).getByLabelText(/Rival/), ' Céltiga FC ')
    await userEvent.type(within(hoja).getByLabelText('Competición'), 'Copa')
    await userEvent.type(within(hoja).getByLabelText('Hora'), '18:00')
    await userEvent.type(within(hoja).getByLabelText('Citación'), '17:00')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Casa' }))
    expect(within(hoja).getByLabelText('Lugar')).toHaveValue('Campo municipal de Rexional')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear partido' }))

    expect(await screen.findByText('Partido contra Céltiga FC creado')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos')).toEqual([
      {
        rival: 'Céltiga FC',
        fecha: '2026-10-14',
        competicion: 'Copa',
        hora: '18:00',
        horaCitacion: '17:00',
        lugar: 'Campo municipal de Rexional',
        local: true,
      },
    ])
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p9'))
  })

  it('valida el rival y muestra en su campo el error de la citación', async () => {
    conPartidos()
    manejadores['POST /api/plantillas/p1/partidos'] = () => {
      const mensaje = 'La citación no puede ser después de la hora del partido'
      return json(
        {
          error: { codigo: 'validacion', mensaje, detalles: [{ campo: 'horaCitacion', mensaje }] },
        },
        400,
      )
    }
    abrir('/plantillas/p1/partidos')
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo partido' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo partido' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear partido' }))
    expect(within(hoja).getByText('El rival es obligatorio')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos')).toEqual([])

    await userEvent.type(within(hoja).getByLabelText(/Rival/), 'X')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear partido' }))
    expect(
      await within(hoja).findByText('La citación no puede ser después de la hora del partido'),
    ).toBeInTheDocument()
    expect(within(hoja).getByLabelText('Citación')).toHaveAttribute('aria-invalid', 'true')
  })

  it('edita un partido desde su ficha', async () => {
    conPartidos()
    manejadores['PATCH /api/plantillas/p1/partidos/p2'] = async (peticion) =>
      json(detalle({ ...PROXIMOS[1], ...(await peticion.json()) } as ResumenPartido))
    abrir('/plantillas/p1/partidos/p2')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const hoja = screen.getByRole('dialog', { name: 'Editar partido contra CD Lalín' })
    expect(within(hoja).getByLabelText(/Rival/)).toHaveValue('CD Lalín')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Fuera' }))
    await userEvent.clear(within(hoja).getByLabelText('Lugar'))
    await userEvent.type(within(hoja).getByLabelText('Lugar'), 'Estadio de Lalín')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Partido guardado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/partidos/p2')).toEqual([
      expect.objectContaining({
        local: false,
        lugar: 'Estadio de Lalín',
        competicion: 'Preferente',
      }),
    ])
  })
})

describe('ficha del partido', () => {
  it('muestra los datos y la convocatoria', async () => {
    conPartidos()
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByRole('heading', { name: 'en SD Compostela' })).toBeInTheDocument()
    expect(screen.getByText('Preferente')).toBeInTheDocument()
    expect(screen.getByText('Partido 17:00')).toBeInTheDocument()
    const convocatoria = screen.getByRole('region', { name: /Convocatoria/ })
    expect(
      within(convocatoria)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringMatching(/Brais Iglesias/), expect.stringMatching(/Zoe/)])
  })

  it('un partido sin convocatoria lo dice', async () => {
    conPartidos()
    abrir('/plantillas/p1/partidos/p2')
    expect(await screen.findByText('Todavía no hay convocatoria.')).toBeInTheDocument()
  })

  it('borrar pide confirmación, avisa de la convocatoria y vuelve a la lista', async () => {
    conPartidos()
    manejadores['DELETE /api/plantillas/p1/partidos/p1'] = () => new Response(null, { status: 204 })
    const router = abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar' }))
    const confirmacion = screen.getByRole('alertdialog', {
      name: '¿Borrar el partido contra SD Compostela?',
    })
    expect(confirmacion).toHaveTextContent('Ya tiene convocatoria')
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Borrar partido' }))
    expect(await screen.findByText('Partido contra SD Compostela borrado')).toBeInTheDocument()
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos'))
  })

  it('el rol jugador ve la ficha sin editar ni borrar', async () => {
    conPartidos(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByRole('heading', { name: 'en SD Compostela' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument()
  })
})

describe('vídeos del partido', () => {
  const VIDEOS = [
    { id: 'v1', url: 'https://www.youtube.com/watch?v=abc', titulo: '1ª parte' },
    { id: 'v2', url: 'https://drive.google.com/file/d/xyz', titulo: null },
  ]
  // El partido guarda sus vídeos: lo que cambian POST y DELETE se ve al volver a pedirlo
  let actuales: Partido['videos'] = []
  const conVideo = () => ({
    ...detalle(PROXIMOS[0] as ResumenPartido, ['j1', 'j2']),
    videos: actuales,
  })
  const conVideos = (p = senior26, videos = VIDEOS) => {
    conPartidos(p)
    actuales = videos
    manejadores['GET /api/plantillas/p1/partidos/p1'] = () => json(conVideo())
  }

  it('se abren fuera de la app; sin título se ve el dominio', async () => {
    conVideos(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1')
    const lista = await screen.findByRole('list', { name: 'Vídeos' })
    const enlaces = within(lista).getAllByRole('link')
    expect(enlaces.map((a) => a.textContent)).toEqual(['1ª parte', 'drive.google.com'])
    expect(enlaces[0]).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc')
    expect(enlaces[0]).toHaveAttribute('target', '_blank')
    // El jugador no los gestiona
    expect(screen.queryByRole('button', { name: 'Añadir vídeo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar:/ })).not.toBeInTheDocument()
  })

  it('sin vídeos, el jugador no ve la sección', async () => {
    conVideos(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), [])
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByRole('heading', { name: 'en SD Compostela' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Vídeos' })).not.toBeInTheDocument()
  })

  it('el cuerpo técnico añade uno y se comprueba la dirección', async () => {
    conVideos(senior26, [])
    manejadores['POST /api/plantillas/p1/partidos/p1/videos'] = async (peticion) => {
      actuales = [...actuales, { id: 'v9', ...(await peticion.json()) }]
      return json(conVideo(), 201)
    }
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir vídeo' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir vídeo' })
    await userEvent.type(within(hoja).getByLabelText(/Dirección del vídeo/), 'youtube')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(within(hoja).getByText('Pega la dirección del vídeo (https://…)')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos/p1/videos')).toEqual([])

    await userEvent.clear(within(hoja).getByLabelText(/Dirección del vídeo/))
    await userEvent.type(within(hoja).getByLabelText(/Dirección del vídeo/), 'https://youtu.be/abc')
    await userEvent.type(within(hoja).getByLabelText('Título'), '2ª parte')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText('Vídeo añadido')).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos/p1/videos')).toEqual([
      { url: 'https://youtu.be/abc', titulo: '2ª parte' },
    ])
    expect(screen.getByRole('link', { name: /2ª parte/ })).toBeInTheDocument()
  })

  it('cambiar un vídeo abre la hoja con sus datos', async () => {
    conVideos()
    manejadores['PATCH /api/plantillas/p1/partidos/p1/videos/v2'] = async (peticion) => {
      const cambios = await peticion.json()
      actuales = actuales.map((v) => (v.id === 'v2' ? { ...v, ...cambios } : v))
      return json(conVideo())
    }
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar: drive.google.com' }))
    const hoja = screen.getByRole('dialog', { name: 'Cambiar vídeo' })
    expect(within(hoja).getByLabelText(/Dirección del vídeo/)).toHaveValue(
      'https://drive.google.com/file/d/xyz',
    )
    await userEvent.type(within(hoja).getByLabelText('Título'), '2ª parte')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Vídeo cambiado')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1/partidos/p1/videos/v2')).toEqual([
      { url: 'https://drive.google.com/file/d/xyz', titulo: '2ª parte' },
    ])
    expect(screen.getByRole('link', { name: /2ª parte/ })).toBeInTheDocument()
  })

  it('quitar pide confirmación', async () => {
    conVideos()
    manejadores['DELETE /api/plantillas/p1/partidos/p1/videos/v1'] = () => {
      actuales = actuales.filter((v) => v.id !== 'v1')
      return json(conVideo())
    }
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar: 1ª parte' }))
    const confirmacion = screen.getByRole('alertdialog', { name: '¿Quitar este vídeo?' })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Quitar' }))
    expect(await screen.findByText('Vídeo quitado')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /1ª parte/ })).not.toBeInTheDocument()
  })
})
