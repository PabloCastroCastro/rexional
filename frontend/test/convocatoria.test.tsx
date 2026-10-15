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
  convocado,
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
    expect(await screen.findByText(/convocados de 3/)).toHaveTextContent('3 convocados de 3')
    expect(casilla('Íker').checked).toBe(true)
    expect(casilla('Zoe').checked).toBe(false)
    expect(casilla('Zoe').closest('li')).toHaveTextContent('No convocado')

    await userEvent.click(screen.getByText('Zoe'))
    await userEvent.click(screen.getByText('Brais'))
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados de 3')
    await userEvent.click(screen.getByRole('button', { name: 'Ninguno' }))
    expect(screen.getByRole('status')).toHaveTextContent('0 convocados de 3')
    // Hugo, de baja, ya no se puede volver a convocar
    expect(screen.queryByText('Hugo')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Todos' }))
    expect(screen.getByRole('status')).toHaveTextContent('3 convocados de 3')
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
    expect(await screen.findByText(/convocados de 3/)).toHaveTextContent('3 convocados')
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
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    const confirmacion = await screen.findByRole('alertdialog', {
      name: '¿Salir sin guardar la convocatoria?',
    })
    await userEvent.click(within(confirmacion).getByRole('button', { name: 'Seguir convocando' }))
    expect(ruta(router)).toBe('/plantillas/p1/partidos/p1/convocatoria')

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
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
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p1'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})

describe('convocatoria y mensaje en la ficha', () => {
  it('separa convocados y no convocados y enlaza a editar la convocatoria', async () => {
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    const convocados = await screen.findByRole('list', { name: 'Convocados' })
    expect(within(convocados).getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('No convocados (1)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar convocatoria' })).toHaveAttribute(
      'href',
      '/plantillas/p1/partidos/p1/convocatoria',
    )
  })

  it('sin convocatoria invita a convocar', async () => {
    conPartido(senior26, {
      ...PARTIDO,
      jugadores: PARTIDO.jugadores.filter((j) => j.activo).map((j) => ({ ...j, convocado: false })),
    })
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByRole('link', { name: 'Convocar' })).toBeInTheDocument()
    expect(screen.queryByText(/No convocados/)).not.toBeInTheDocument()
  })

  it('muestra el mensaje y lo copia al portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
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
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir' }))
    expect(share).toHaveBeenCalledWith({ text: TEXTO })
    expect(abrirVentana).not.toHaveBeenCalled()
  })

  it('sin menú del sistema, abre WhatsApp con el enlace wa.me', async () => {
    const abrirVentana = vi.spyOn(window, 'open').mockReturnValue(null)
    conPartido()
    abrir('/plantillas/p1/partidos/p1')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir' }))
    expect(abrirVentana).toHaveBeenCalledWith(WHATSAPP, '_blank', 'noopener')
  })

  it('el rol jugador ve la convocatoria y el mensaje, sin editar ni compartir', async () => {
    conPartido(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByTestId('mensaje')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Convocados' })).toBeInTheDocument()
    for (const nombre of ['Copiar', 'Compartir']) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('link', { name: 'Editar convocatoria' })).not.toBeInTheDocument()
  })
})
