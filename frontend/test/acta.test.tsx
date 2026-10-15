import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ActaLeida, LecturaActa, Partido } from '../src/partidos/datos'
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

// Acta del partido: subir el PDF, revisar lo leído y registrarlo

const PARTIDO: Partido = {
  id: 'p1',
  rival: 'CD Proba Rival',
  competicion: null,
  fecha: '2026-10-11',
  hora: null,
  horaCitacion: null,
  lugar: null,
  local: false,
  estado: 'programado',
  golesFavor: null,
  golesContra: null,
  jugadores: [],
  eventos: [],
  acta: null,
}

const persona = (dorsal: number, nombre: string, jugadorId: string | null) => ({
  dorsal,
  nombre,
  jugadorId,
})

const LECTURA: LecturaActa = {
  equipo: 'visitante',
  nombreEquipo: 'CD REXIONAL',
  rival: 'CD PROBA RIVAL',
  competicion: 'TERCEIRA PROBA (GRUPO 1)',
  jornada: 5,
  fecha: '2026-10-11',
  hora: '20:00',
  estadio: 'Campo de Proba',
  ciudad: 'Rexional',
  golesFavor: 2,
  golesContra: 1,
  titulares: [persona(8, 'GÓMEZ GARCÍA, DANIEL', 'j1'), persona(4, 'NDONG, ISSA', null)],
  suplentes: [persona(14, 'RIVAS MOSQUERA, ROI', 'j3')],
  cambios: [
    {
      entra: persona(14, 'RIVAS MOSQUERA, ROI', 'j3'),
      sale: persona(4, 'NDONG, ISSA', null),
      minuto: 59,
    },
  ],
  goles: [
    { nombre: 'GÓMEZ GARCÍA, DANIEL', jugadorId: 'j1', minuto: 40, enPropia: false },
    { nombre: 'GÓMEZ GARCÍA, DANIEL', jugadorId: 'j1', minuto: 40, enPropia: false },
  ],
  golesEnContra: [{ nombre: 'SEOANE VILAS, ADRIÁN', jugadorId: null, minuto: 62, enPropia: false }],
  tarjetas: [
    { dorsal: null, nombre: 'GÓMEZ GARCÍA, DANIEL', jugadorId: 'j1', minuto: 48, tipo: null },
  ],
  avisos: ['Hay un jugador del acta sin emparejar: elige quién es o no contará'],
}

const ACTA = { nombreArchivo: 'FichaPartido.pdf', tamano: 10_417, subidaEn: '2026-10-15T10:00:00Z' }
const LEIDA: ActaLeida = { acta: ACTA, lectura: LECTURA, error: null }

const JUGADORES = [
  {
    jugadorId: 'j1',
    nombre: 'Daniel',
    apellidos: 'Gómez García',
    dorsal: 8,
    posicion: null,
    activo: true,
  },
  { jugadorId: 'j2', nombre: 'Issa', apellidos: null, dorsal: 34, posicion: null, activo: true },
  {
    jugadorId: 'j3',
    nombre: 'Roi',
    apellidos: 'Rivas Mosquera',
    dorsal: 14,
    posicion: null,
    activo: true,
  },
]

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

function conActa(p = senior26, partido = PARTIDO, leida: ActaLeida = LEIDA) {
  conDatos({ plantillas: [p] })
  let actual = partido
  manejadores['GET /api/plantillas/p1/partidos/p1'] = () => json(actual)
  manejadores['GET /api/plantillas/p1/partidos/p1/mensaje'] = () =>
    json({ texto: 'Convocatoria', whatsapp: 'https://wa.me/' })
  manejadores['GET /api/plantillas/p1/jugadores'] = (peticion) =>
    json(new URL(peticion.url).searchParams.get('activos') === 'false' ? [] : JUGADORES)
  manejadores['GET /api/plantillas/p1/partidos/p1/acta/lectura'] = () => json(leida)
  manejadores['POST /api/plantillas/p1/partidos/p1/acta'] = () => {
    actual = { ...actual, acta: ACTA }
    return json(leida)
  }
  manejadores['POST /api/plantillas/p1/partidos/p1/acta/confirmar'] = () => {
    actual = { ...actual, estado: 'jugado', golesFavor: 2, golesContra: 1 }
    return json(actual)
  }
}

describe('acta del partido', () => {
  it('se sube el PDF, se revisa lo leído y se registra', async () => {
    conActa()
    const router = abrir('/plantillas/p1/partidos/p1')
    const seccion = (await screen.findByRole('heading', { name: 'Acta del partido' })).closest(
      'section',
    )
    if (!seccion) throw new Error('Sin sección del acta')
    const pdf = new File(['%PDF-1.4'], 'FichaPartido.pdf', { type: 'application/pdf' })
    await userEvent.upload(within(seccion).getByLabelText('Archivo del acta en PDF'), pdf)

    // Revisión: resultado desde nuestro lado, avisos y un jugador por elegir
    expect(await screen.findByRole('heading', { name: 'Revisar el acta' })).toBeInTheDocument()
    expect(ruta(router)).toBe('/plantillas/p1/partidos/p1/acta')
    // Se envía como formulario, en el campo «archivo»
    expect(enviado('POST /api/plantillas/p1/partidos/p1/acta')[0]).toMatch(/name="archivo"/)
    expect(screen.getByText('2–1')).toBeInTheDocument()
    expect(screen.getByText(/un jugador del acta sin emparejar/)).toBeInTheDocument()
    expect(screen.getByLabelText('GÓMEZ GARCÍA, DANIEL')).toHaveValue('j1')
    expect(screen.getByLabelText('NDONG, ISSA')).toHaveValue('')
    expect(screen.getByText('Gol del rival (SEOANE VILAS, ADRIÁN)')).toBeInTheDocument()

    // La tarjeta sin tipo no deja registrar
    const registrar = screen.getByRole('button', { name: 'Registrar el acta' })
    expect(registrar).toBeDisabled()
    await userEvent.selectOptions(screen.getByLabelText('Daniel Gómez García'), 'amarilla')
    await userEvent.selectOptions(screen.getByLabelText('NDONG, ISSA'), 'j2')
    // Elegido, los cambios ya muestran su nombre
    expect(screen.getByRole('heading', { name: 'Cambios' }).closest('section')).toHaveTextContent(
      'Issa',
    )
    await userEvent.click(registrar)

    expect(
      await screen.findByText('Acta registrada: 2–1 contra CD Proba Rival'),
    ).toBeInTheDocument()
    expect(enviado('POST /api/plantillas/p1/partidos/p1/acta/confirmar')).toEqual([
      {
        jugadores: [
          { nombre: 'GÓMEZ GARCÍA, DANIEL', jugadorId: 'j1' },
          { nombre: 'NDONG, ISSA', jugadorId: 'j2' },
          { nombre: 'RIVAS MOSQUERA, ROI', jugadorId: 'j3' },
        ],
        tarjetas: [{ indice: 0, tipo: 'amarilla' }],
      },
    ])
    // Ya en la ficha: el marcador de la revisión ha desaparecido y el del partido muestra el resultado
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/partidos/p1'))
    const partido = await screen.findByRole('region', { name: 'Partido' })
    expect(await within(partido).findByText('2–1')).toBeInTheDocument()
  })

  it('un jugador elegido para dos nombres no deja registrar', async () => {
    conActa()
    abrir('/plantillas/p1/partidos/p1/acta')
    await userEvent.selectOptions(await screen.findByLabelText('NDONG, ISSA'), 'j1')
    expect(
      screen.getByText('Hay un jugador elegido para dos nombres del acta.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar el acta' })).toBeDisabled()
  })

  it('si el PDF no es una ficha, se explica y se puede subir otro', async () => {
    conActa(
      senior26,
      { ...PARTIDO, acta: ACTA },
      {
        acta: ACTA,
        lectura: null,
        error: 'No parece una ficha del partido de la Federación Gallega',
      },
    )
    abrir('/plantillas/p1/partidos/p1/acta')
    expect(await screen.findByText('No se ha podido leer el acta')).toBeInTheDocument()
    expect(screen.getByText(/No parece una ficha/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Subir otra' })).toBeInTheDocument()
  })

  it('un jugador ve el acta subida, pero no la sube ni la registra', async () => {
    conActa(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), {
      ...PARTIDO,
      acta: ACTA,
    })
    abrir('/plantillas/p1/partidos/p1')
    const enlace = await screen.findByRole('link', { name: 'FichaPartido.pdf' })
    expect(enlace).toHaveAttribute('href', '/api/plantillas/p1/partidos/p1/acta')
    expect(screen.queryByRole('button', { name: 'Subir otra' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Revisar/ })).not.toBeInTheDocument()
  })

  it('sin acta, el jugador no ve la sección', async () => {
    conActa(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/partidos/p1')
    expect(await screen.findByRole('heading', { name: /Convocatoria/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Acta del partido' })).not.toBeInTheDocument()
  })
})
