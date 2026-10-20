import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ResumenEjercicio } from '../src/ejercicios/datos'
import type { ResumenEntreno } from '../src/entrenos/datos'
import type { Plan } from '../src/planificacion/datos'
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

// Plan de las sesiones: editor, lectura, duplicar, modelos y su resumen en el historial y pasar lista

const PLAN: Plan = {
  entrenoId: 'e1',
  fecha: '2026-10-20',
  hora: '20:00',
  horaFin: '21:00',
  objetivo: 'Salida de balón',
  notas: 'Llevar petos',
  duracionPrevista: 60,
  duracionTotal: 35,
  ejercicios: [
    {
      ejercicioId: 'j1',
      nombre: 'Rondo',
      categoria: 'calentamiento',
      archivado: false,
      urlMiniatura: null,
      duracionMin: 10,
      indicaciones: null,
    },
    {
      ejercicioId: 'j2',
      nombre: 'Salida 6c4',
      categoria: 'tactica',
      archivado: false,
      urlMiniatura: null,
      duracionMin: 25,
      indicaciones: 'Centrales abiertos',
    },
  ],
}

const BIBLIOTECA: ResumenEjercicio[] = [
  {
    id: 'j3',
    nombre: 'Partido 8c8',
    categoria: 'partido',
    duracionMin: 30,
    etiquetas: [],
    archivado: false,
    medios: 0,
    urlMiniatura: null,
  },
]

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const RUTA = '/api/plantillas/p1/entrenos/e1/plan'

function conPlan(p = senior26, plan = PLAN) {
  conDatos({ plantillas: [p] })
  let actual = plan
  manejadores[`GET ${RUTA}`] = () => json(actual)
  manejadores[`PUT ${RUTA}`] = async (peticion) => {
    const cuerpo = (await peticion.json()) as {
      objetivo: string | null
      ejercicios: { ejercicioId: string; duracionMin: number | null }[]
    }
    actual = {
      ...actual,
      objetivo: cuerpo.objetivo,
      ejercicios: cuerpo.ejercicios.map((e) => ({
        ...(actual.ejercicios.find((x) => x.ejercicioId === e.ejercicioId) ?? {
          ejercicioId: e.ejercicioId,
          nombre: 'Partido 8c8',
          categoria: 'partido',
          archivado: false,
          urlMiniatura: null,
          indicaciones: null,
        }),
        duracionMin: e.duracionMin,
      })),
    }
    return json(actual)
  }
  manejadores['GET /api/clubes/c1/ejercicios'] = () => json(BIBLIOTECA)
  manejadores['GET /api/clubes/c1/modelos-sesion'] = () =>
    json([
      {
        id: 'm1',
        nombre: 'Sesión de martes',
        objetivo: 'Técnica',
        ejercicios: 1,
        duracionTotal: 30,
      },
    ])
  manejadores[`POST ${RUTA}/desde-modelo/m1`] = () => {
    actual = {
      ...actual,
      objetivo: 'Técnica',
      ejercicios: [{ ...(PLAN.ejercicios[0] as Plan['ejercicios'][number]), duracionMin: 30 }],
    }
    return json(actual)
  }
  manejadores[`POST ${RUTA}/guardar-modelo`] = async (peticion) =>
    json(
      {
        id: 'm2',
        nombre: ((await peticion.json()) as { nombre: string }).nombre,
        objetivo: null,
        ejercicios: 2,
        duracionTotal: 35,
      },
      201,
    )
  manejadores[`POST ${RUTA}/duplicar`] = () =>
    json({ ...actual, entrenoId: 'e9', fecha: '2026-10-27' }, 201)
  manejadores['GET /api/plantillas/p1/entrenos/e9/plan'] = () =>
    json({ ...actual, entrenoId: 'e9', fecha: '2026-10-27' })
}

const pasos = () =>
  within(screen.getByRole('list', { name: 'Ejercicios del plan' }))
    .getAllByRole('link')
    .map((a) => a.textContent)

describe('editor del plan', () => {
  it('añade de la biblioteca, reordena, cambia minutos y guarda; avisa si sobra tiempo', async () => {
    conPlan()
    abrir('/plantillas/p1/entrenos/plan/e1')
    expect(await screen.findByLabelText('Objetivo')).toHaveValue('Salida de balón')
    expect(screen.getByRole('status')).toHaveTextContent("35' de ejercicios · el entreno dura 60'")
    const guardar = screen.getByRole('button', { name: 'Guardar plan' })
    expect(guardar).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Añadir' }))
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /Partido 8c8/ }),
    )
    expect(pasos()).toEqual(['Rondo', 'Salida 6c4', 'Partido 8c8'])
    // 10 + 25 + 30 = 65 > 60
    expect(screen.getByRole('status')).toHaveTextContent("sobran 5'")
    await userEvent.click(screen.getByRole('button', { name: 'Subir Partido 8c8' }))
    expect(pasos()).toEqual(['Rondo', 'Partido 8c8', 'Salida 6c4'])
    const minutos = screen.getByLabelText('Minutos de Partido 8c8')
    await userEvent.clear(minutos)
    await userEvent.type(minutos, '20')
    expect(screen.getByRole('status')).not.toHaveTextContent('sobran')
    await userEvent.click(screen.getByRole('button', { name: 'Quitar Rondo' }))

    await userEvent.click(guardar)
    expect(await screen.findByText('Plan guardado')).toBeInTheDocument()
    expect(enviado(`PUT ${RUTA}`)).toEqual([
      {
        objetivo: 'Salida de balón',
        notas: 'Llevar petos',
        ejercicios: [
          { ejercicioId: 'j3', duracionMin: 20, indicaciones: null },
          { ejercicioId: 'j2', duracionMin: 25, indicaciones: 'Centrales abiertos' },
        ],
      },
    ])
    expect(screen.getByRole('button', { name: 'Guardar plan' })).toBeDisabled()
  })

  it('crea desde un modelo (sustituyendo, tras confirmar), guarda como modelo y duplica', async () => {
    conPlan()
    const router = abrir('/plantillas/p1/entrenos/plan/e1')
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar como modelo' }))
    const hoja = screen.getByRole('dialog', { name: 'Guardar como modelo' })
    await userEvent.clear(within(hoja).getByLabelText('Nombre del modelo'))
    await userEvent.type(within(hoja).getByLabelText('Nombre del modelo'), 'Salida de balón')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar modelo' }))
    expect(await screen.findByText('Modelo «Salida de balón» guardado')).toBeInTheDocument()
    expect(enviado(`POST ${RUTA}/guardar-modelo`)).toEqual([{ nombre: 'Salida de balón' }])

    await userEvent.click(screen.getByRole('button', { name: 'Desde un modelo' }))
    await userEvent.click(
      await within(screen.getByRole('dialog', { name: 'Crear desde un modelo' })).findByRole(
        'button',
        { name: /Sesión de martes/ },
      ),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Sustituir' }),
    )
    expect(await screen.findByText('Plan creado desde el modelo')).toBeInTheDocument()
    expect(screen.getByLabelText('Objetivo')).toHaveValue('Técnica')
    expect(pasos()).toEqual(['Rondo'])

    await userEvent.click(screen.getByRole('button', { name: 'Duplicar' }))
    const duplicar = screen.getByRole('dialog', { name: 'Duplicar en otra fecha' })
    await userEvent.type(within(duplicar).getByLabelText('Fecha'), '2026-10-27')
    await userEvent.click(within(duplicar).getByRole('button', { name: 'Duplicar' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/entrenos/plan/e9'))
    expect(enviado(`POST ${RUTA}/duplicar`)).toEqual([{ fecha: '2026-10-27' }])
  })
})

describe('lectura y resúmenes', () => {
  it('un jugador ve el plan sin editarlo', async () => {
    conPlan(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/entrenos/plan/e1')
    expect(await screen.findByText('Salida de balón')).toBeInTheDocument()
    expect(pasos()).toEqual(['Rondo', 'Salida 6c4'])
    expect(screen.getByText('Centrales abiertos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar plan' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Objetivo')).not.toBeInTheDocument()
  })

  it('los próximos del historial llevan su resumen y abren el plan', async () => {
    const proximo = (id: string, extra: Partial<ResumenEntreno>): ResumenEntreno => ({
      id,
      fecha: '2099-10-20',
      hora: '20:00',
      horaFin: null,
      deHorario: true,
      objetivo: null,
      ejerciciosPlan: 0,
      duracionPlan: 0,
      asiste: 0,
      justificada: 0,
      falta: 0,
      ...extra,
    })
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/plantillas/p1/entrenos'] = (peticion) =>
      json(
        new URL(peticion.url).searchParams.get('desde')
          ? [
              proximo('e1', { objetivo: 'Presión', ejerciciosPlan: 4, duracionPlan: 75 }),
              proximo('e2', { fecha: '2099-10-22' }),
            ]
          : [],
      )
    abrir('/plantillas/p1/entrenos/historial')
    const proximos = await screen.findByRole('region', { name: 'Próximos' })
    const enlaces = within(proximos).getAllByRole('link')
    expect(enlaces[0]).toHaveTextContent("Presión · 4 ejercicios · 75'")
    expect(enlaces[0]).toHaveAttribute('href', '/plantillas/p1/entrenos/plan/e1')
    expect(enlaces[1]).toHaveTextContent('Sin plan')
  })
})

describe('compartir el plan en PDF', () => {
  const PDF = `${RUTA}.pdf`
  const conPdf = () => {
    manejadores[`GET ${PDF}`] = () =>
      new Response('%PDF-1.7 de prueba', { headers: { 'content-type': 'application/pdf' } })
  }

  afterEach(() => {
    // Solo existen en los tests que los simulan
    for (const propiedad of ['share', 'canShare']) Reflect.deleteProperty(navigator, propiedad)
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  it('en el móvil lo comparte con el archivo adjunto', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
    conPlan(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    conPdf()
    abrir('/plantillas/p1/entrenos/plan/e1')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir PDF' }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    expect(share).toHaveBeenCalledWith({
      title: 'Sesión de entrenamiento',
      files: [expect.objectContaining({ name: 'entreno-2026-10-20.pdf', type: 'application/pdf' })],
    })
  })

  it('si el navegador no comparte archivos, lo descarga', async () => {
    const crearUrl = vi.fn().mockReturnValue('blob:pdf')
    Object.defineProperty(URL, 'createObjectURL', { value: crearUrl, configurable: true })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    conPlan()
    conPdf()
    abrir('/plantillas/p1/entrenos/plan/e1')
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir PDF' }))
    await waitFor(() => expect(clic).toHaveBeenCalled())
    expect(crearUrl).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'entreno-2026-10-20.pdf' }),
    )
    expect(clic.mock.contexts[0]).toHaveAttribute('download', 'entreno-2026-10-20.pdf')
  })

  it('avisa si no se puede generar y no deja compartirlo con cambios sin guardar', async () => {
    conPlan()
    manejadores[`GET ${PDF}`] = () =>
      json(
        { error: { codigo: 'no_encontrado', mensaje: 'No existe ese entreno en la plantilla' } },
        404,
      )
    abrir('/plantillas/p1/entrenos/plan/e1')
    const boton = await screen.findByRole('button', { name: 'Compartir PDF' })
    await userEvent.click(boton)
    expect(await screen.findByText('No existe ese entreno en la plantilla')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Objetivo'), ' y presión')
    expect(boton).toBeDisabled()
    expect(
      screen.getByText('Guarda el plan para compartirlo, duplicarlo o guardarlo como modelo.'),
    ).toBeInTheDocument()
  })
})
