import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

afterEach(() => {
  // navigator.share y navigator.clipboard solo existen en los tests que los simulan
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
})

const jugador = (
  jugadorId: string,
  nombre: string,
  dorsal: number | null,
  convocado: boolean,
  activo = true,
) => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  posicion: null,
  activo,
  tipo: 'propia' as const,
  procedencia: null,
  lesion: null,
  convocado,
  sancion: null,
  entrenosPrevios: null,
  titular: null,
  minutos: null,
})

const PARTIDO: Partido = {
  id: 'p1',
  rival: 'SD Compostela',
  competicion: 'Preferente',
  fecha: '2026-10-18',
  hora: '17:00',
  horaCitacion: '16:00',
  lugar: null,
  local: true,
  estado: 'programado',
  golesFavor: null,
  golesContra: null,
  eventos: [],
  acta: null,
  videos: [],
  jugadores: [
    jugador('j1', 'Íker', 1, true),
    jugador('j2', 'Brais', 7, true),
    jugador('j3', 'Zoe', null, false),
    jugador('j4', 'Hugo', 10, true, false),
  ],
}

const TEXTO = '⚽ *CD Rexional · Senior*\nConvocatoria contra *SD Compostela*'
const WHATSAPP = `https://wa.me/?text=${encodeURIComponent(TEXTO)}`

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

function conPartido(p = senior26, partido = PARTIDO) {
  conDatos({ plantillas: [p] })
  let actual = partido
  manejadores['GET /api/plantillas/p1/partidos/p1'] = () => json(actual)
  manejadores['GET /api/plantillas/p1/partidos/p1/mensaje'] = () =>
    json({ texto: TEXTO, whatsapp: WHATSAPP })
  manejadores['PUT /api/plantillas/p1/partidos/p1/convocados'] = async (peticion) => {
    const { jugadores } = (await peticion.json()) as { jugadores: string[] }
    actual = {
      ...actual,
      jugadores: actual.jugadores
        .map((j) => ({ ...j, convocado: jugadores.includes(j.jugadorId) }))
        .filter((j) => j.activo || j.convocado),
    }
    return json(actual)
  }
}

const casilla = (nombre: string) =>
  screen.getByRole('checkbox', { name: new RegExp(nombre) }) as HTMLInputElement

describe('elegir convocados', () => {
  it('marca y desmarca con contador, Todos y Ninguno, y guarda la lista completa', async () => {
    conPartido()
    const router = abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados')
    expect(casilla('Íker').checked).toBe(true)
    expect(casilla('Zoe').checked).toBe(false)
    // Sin «No convocado» ni la posición: el convocado se distingue por la casilla y el fondo (GH-289)
    const zoe = casilla('Zoe').closest('li') as HTMLElement
    expect(zoe).not.toHaveTextContent('No convocado')
    expect(zoe).toHaveAttribute('data-convocado', 'false')
    expect(casilla('Íker').closest('li')).toHaveAttribute('data-convocado', 'true')
    // Una sola línea: sin texto secundario si no está lesionado ni sancionado
    expect(zoe.querySelectorAll('[class*="secundario"]')).toHaveLength(0)

    await userEvent.click(screen.getByText('Zoe'))
    await userEvent.click(screen.getByText('Brais'))
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados')
    await userEvent.click(screen.getByRole('button', { name: 'Ninguno' }))
    // Sin nadie: «Marca a los que van» y Guardar desactivado (GH-291)
    expect(screen.getByRole('status')).toHaveTextContent('Marca a los que van')
    // Hugo, de baja, ya no se puede volver a convocar
    expect(screen.queryByText('Hugo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Todos los disponibles' }))
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados')
    await userEvent.click(screen.getByText('Íker'))

    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria' }))
    expect(await screen.findByText('Convocatoria guardada: 2 convocados')).toBeInTheDocument()
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([
      { jugadores: ['j2', 'j3'] },
    ])
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p1'))
  })

  it('un jugador de baja ya convocado se puede quitar', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados')
    expect(casilla('Hugo').closest('li')).toHaveTextContent('baja')
    await userEvent.click(screen.getByText('Hugo'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria' }))
    await screen.findByText('Convocatoria guardada: 2 convocados')
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([
      { jugadores: ['j1', 'j2'] },
    ])
  })

  it('salir con cambios sin guardar pide confirmación', async () => {
    conPartido()
    const router = abrir('/plantillas/p1/partidos/p1/convocatoria')
    await userEvent.click(await screen.findByText('Zoe'))
    // «Cancelar» ya no está en la barra (GH-291): se sale volviendo atrás
    await userEvent.click(screen.getByRole('link', { name: 'vs SD Compostela' }))

    const confirmacion = await screen.findByRole('alertdialog', {
      name: '¿Salir sin guardar la convocatoria?',
    })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Seguir convocando' }))
    expect(ruta(router)).toBe('/plantillas/p1/partidos/p1/convocatoria')

    await userEvent.click(screen.getByRole('link', { name: 'vs SD Compostela' }))
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Salir sin guardar',
      }),
    )
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p1'))
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([])
  })

  it('sin cambios se sale sin preguntar', async () => {
    conPartido()
    const router = abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'vs SD Compostela' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p1'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('convocatoria y mensaje en la ficha', () => {
  it('separa convocados y no convocados y enlaza a editar la convocatoria', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    const convocados = await screen.findByRole('list', { name: 'Convocados' })
    // En dos columnas, con dorsal y nombre y primer apellido (GH-284)
    expect(within(convocados).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('1 no convocado')).toBeInTheDocument()
    // El número en el título y «Editar», que abre la pantalla de la convocatoria
    expect(screen.getByRole('heading', { name: /Convocatoria/ })).toHaveTextContent('Convocatoria3')
    expect(screen.getByRole('link', { name: 'Editar la convocatoria' })).toHaveAttribute(
      'href',
      '/plantillas/p1/partidos/p1/convocatoria',
    )
  })

  it('cada convocado, con su dorsal y su nombre y primer apellido (GH-284)', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        { ...jugador('j1', 'Brais', 7, true), apellidos: 'Iglesias Pérez' },
        { ...jugador('j2', 'Íker', 1, true), apellidos: 'Castro Rey' },
      ],
    })
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    const convocados = await screen.findByRole('list', { name: 'Convocados' })
    expect(
      within(convocados)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['7Dorsal 7Brais Iglesias', '1Dorsal 1Íker Castro'])
  })

  it('sin convocatoria invita a convocar', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: PARTIDO.jugadores.filter((j) => j.activo).map((j) => ({ ...j, convocado: false })),
    })
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    expect(await screen.findByText('Todavía sin convocatoria')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Hacer la convocatoria' })).toHaveAttribute(
      'href',
      '/plantillas/p1/partidos/p1/convocatoria',
    )
    expect(screen.queryByText(/no convocado/)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Editar la convocatoria' })).not.toBeInTheDocument()
  })

  it('muestra el mensaje y lo copia al portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    conPartido()
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    expect(await screen.findByTestId('mensaje')).toHaveTextContent(
      'Convocatoria contra *SD Compostela*',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(await screen.findByText('Mensaje copiado')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(TEXTO)
  })

  it('comparte con el menú del sistema si existe', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const abrirVentana = vi.spyOn(window, 'open').mockReturnValue(null)
    conPartido()
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir' }))
    expect(share).toHaveBeenCalledWith({ text: TEXTO })
    expect(abrirVentana).not.toHaveBeenCalled()
  })

  it('sin menú del sistema, abre WhatsApp con el enlace wa.me', async () => {
    const abrirVentana = vi.spyOn(window, 'open').mockReturnValue(null)
    conPartido()
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir' }))
    expect(abrirVentana).toHaveBeenCalledWith(WHATSAPP, '_blank', 'noopener')
  })

  it('el rol jugador ve la convocatoria y el mensaje, sin editar ni compartir', async () => {
    conPartido(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1?pestana=previa')
    expect(await screen.findByTestId('mensaje')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Convocados' })).toBeInTheDocument()
    for (const nombre of ['Copiar', 'Compartir']) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Editar la convocatoria' })).not.toBeInTheDocument()
  })
})

describe('lesionados en la convocatoria (GH-230)', () => {
  it('salen con su lesión, Todos no los marca y se pueden convocar a mano', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        jugador('j1', 'Íker', 1, false),
        {
          ...jugador('j2', 'Brais', 7, false),
          lesion: { desde: '2026-10-10', vueltaPrevista: null },
        },
      ],
    })
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(casilla('Brais').closest('li')).toHaveTextContent('Lesionado · sin fecha de vuelta')

    await userEvent.click(screen.getByRole('button', { name: 'Todos los disponibles' }))
    expect(casilla('Íker').checked).toBe(true)
    expect(casilla('Brais').checked).toBe(false)

    await userEvent.click(screen.getByText('Brais'))
    expect(casilla('Brais').checked).toBe(true)
  })
})

describe('sancionados en la convocatoria (GH-231)', () => {
  it('salen con su sanción, Todos no los marca y convocarlos pide confirmación', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        jugador('j1', 'Íker', 1, false),
        { ...jugador('j2', 'Brais', 7, false), sancion: { partidos: 1 } },
      ],
    })
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(casilla('Brais').closest('li')).toHaveTextContent('Sancionado · 1 partido')
    // El nombre del sancionado, tachado (GH-248); el de quien puede jugar, no
    expect(screen.getByText('Brais').className).toMatch(/tachado/)
    expect(screen.getByText('Íker').className).not.toMatch(/tachado/)

    await userEvent.click(screen.getByRole('button', { name: 'Todos los disponibles' }))
    expect(casilla('Brais').checked).toBe(false)

    await userEvent.click(screen.getByText('Brais'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria' }))
    const aviso = screen.getByRole('alertdialog', {
      name: 'Brais está sancionado para este partido',
    })
    await userEvent.click(within(aviso).getByRole('button', { name: 'Cancelar' }))
    expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria' }))
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: 'Convocarlo igualmente',
      }),
    )
    await waitFor(() =>
      expect(enviado('PUT /api/plantillas/p1/partidos/p1/convocados')).toEqual([
        { jugadores: ['j1', 'j2'] },
      ]),
    )
  })
})

describe('cómo ha entrenado desde el partido anterior (GH-288)', () => {
  type Previo = {
    fecha: string
    estado: 'asiste' | 'justificada' | 'falta' | null
    motivo: string | null
  }
  const previo = (
    fecha: string,
    estado: Previo['estado'],
    motivo: string | null = null,
  ): Previo => ({
    fecha,
    estado,
    motivo,
  })

  it('hasta 5 entrenos, un punto por sesión; sin texto en pantalla, pero sí para el lector', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        {
          ...jugador('j1', 'Íker', 1, false),
          // Martes 13, jueves 15 y viernes 16 de octubre de 2026
          entrenosPrevios: [
            previo('2026-10-13', 'asiste'),
            previo('2026-10-15', 'justificada', 'Trabajo'),
            previo('2026-10-16', null),
          ],
        },
        { ...jugador('j2', 'Brais', 7, false), entrenosPrevios: [] },
      ],
    })
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    const fila = (await screen.findByText('Íker')).closest('li') as HTMLElement
    const puntos = within(fila).getByRole('img')
    const texto =
      'Entrenó 1 de 2 desde el partido anterior. Faltó el jueves · Trabajo. Falta pasar lista del viernes.'
    expect(puntos).toHaveAccessibleName(texto)
    expect(puntos).toHaveAttribute('title', texto)
    expect([...puntos.children].map((p) => p.getAttribute('data-estado'))).toEqual([
      'fue',
      'falto',
      'pendiente',
    ])
    expect(puntos).toHaveTextContent('')
    // Sin entrenos en ese periodo, nada
    const brais = screen.getByText('Brais').closest('li') as HTMLElement
    expect(within(brais).queryByRole('img')).not.toBeInTheDocument()
  })

  it.each([
    [5, 'alto'],
    [4, 'medio'],
    [3, 'bajo'],
  ])('con 6 o más, la fracción (%i de 6) en el color de su nivel (%s)', async (fue, nivel) => {
    const fechas = [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-12',
    ]
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        {
          ...jugador('j1', 'Íker', 1, false),
          entrenosPrevios: fechas.map((f, i) => previo(f, i < fue ? 'asiste' : 'falta')),
        },
      ],
    })
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    const fila = (await screen.findByText('Íker')).closest('li') as HTMLElement
    const fraccion = within(fila).getByRole('img')
    expect(fraccion).toHaveTextContent(`${fue}/6`)
    expect(fraccion).toHaveAttribute('data-nivel', nivel)
    expect(fraccion).toHaveAccessibleName(
      new RegExp(`^Entrenó ${fue} de 6 desde el partido anterior`),
    )
  })
})

describe('convocatoria por líneas (GH-290)', () => {
  it('agrupa por línea, por dorsal dentro, y cada grupo cuenta sus convocados', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        { ...jugador('j1', 'Íker', 1, true), posicion: 'portero' },
        { ...jugador('j2', 'Brais', 7, true), posicion: 'defensa' },
        { ...jugador('j3', 'Zoe', 4, false), posicion: 'defensa' },
        { ...jugador('j4', 'Hugo', 9, true), posicion: 'delantero' },
        jugador('j5', 'Xoel', null, false),
      ],
    })
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    // En el orden de un equipo; las líneas sin nadie no salen
    const grupos = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(grupos.slice(0, 4)).toEqual([
      'Porteros 1 de 1',
      'Defensas 1 de 2',
      'Delanteros 1 de 1',
      'Sin posición 0 de 1',
    ])
    // Dentro, por dorsal: Zoe (4) antes que Brais (7)
    const defensas = screen.getByRole('list', { name: 'Defensas' })
    expect(
      within(defensas)
        .getAllByRole('checkbox')
        .map((c) => c.closest('li')?.textContent),
    ).toEqual([expect.stringContaining('Zoe'), expect.stringContaining('Brais')])
    // El recuento cambia al marcar
    await userEvent.click(within(defensas).getByText('Zoe'))
    expect(screen.getByRole('heading', { name: /^Defensas/ })).toHaveTextContent('Defensas 2 de 2')
  })
})

describe('la barra fija de la convocatoria (GH-291)', () => {
  const conLineas = (convocados: boolean) =>
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: [
        { ...jugador('j1', 'Íker', 1, convocados), posicion: 'portero' },
        { ...jugador('j2', 'Brais', 7, convocados), posicion: 'defensa' },
        { ...jugador('j3', 'Zoe', 4, convocados), posicion: 'defensa' },
        { ...jugador('j4', 'Hugo', 9, convocados), posicion: 'delantero' },
      ],
    })

  it('cuántos van y su reparto por líneas; sin portero, el aviso en ámbar', async () => {
    conLineas(true)
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    const resumen = screen.getByRole('status')
    expect(resumen).toHaveTextContent('4 convocados')
    expect(resumen).toHaveTextContent('1 POR · 2 DEF · 1 DEL')
    // El lector de pantalla oye el reparto completo, no las abreviaturas
    expect(resumen).toHaveTextContent('1 portero, 2 defensas, 1 delantero')
    expect(resumen).not.toHaveTextContent('Sin portero')
    await userEvent.click(screen.getByText('Íker'))
    expect(resumen).toHaveTextContent('3 convocados · Sin portero')
  })

  it('sin nadie marcado, «Marca a los que van» y Guardar desactivado', async () => {
    conLineas(false)
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await screen.findByRole('button', { name: 'Ninguno' })
    expect(screen.getByRole('status')).toHaveTextContent('Marca a los que van')
    expect(screen.getByRole('button', { name: 'Guardar convocatoria' })).toBeDisabled()
    await userEvent.click(screen.getByText('Zoe'))
    expect(screen.getByRole('button', { name: 'Guardar convocatoria' })).toBeEnabled()
  })

  it('una convocatoria ya guardada se puede vaciar', async () => {
    conLineas(true)
    abrir('/plantillas/p1/partidos/p1/convocatoria')
    await userEvent.click(await screen.findByRole('button', { name: 'Ninguno' }))
    expect(screen.getByRole('status')).toHaveTextContent('Marca a los que van')
    expect(screen.getByRole('button', { name: 'Guardar convocatoria' })).toBeEnabled()
  })
})
