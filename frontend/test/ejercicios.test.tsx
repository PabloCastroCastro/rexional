import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ejercicio, Medio, ResumenEjercicio } from '../src/ejercicios/datos'
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

// Biblioteca de ejercicios del club, en la pestaña Entrenos

afterEach(() => vi.unstubAllGlobals())

const resumen = (
  id: string,
  nombre: string,
  extra: Partial<ResumenEjercicio> = {},
): ResumenEjercicio => ({
  id,
  nombre,
  categoria: null,
  duracionMin: null,
  etiquetas: [],
  archivado: false,
  medios: 0,
  urlMiniatura: null,
  ...extra,
})

const medio = (id: string, extra: Partial<Medio>): Medio => ({
  id,
  tipo: 'foto',
  estado: 'listo',
  mime: 'image/webp',
  tamanoBytes: 1000,
  duracionSeg: null,
  pie: null,
  orden: 0,
  url: null,
  urlArchivo: `/api/medios/${id}`,
  urlMiniatura: `/api/medios/${id}/miniatura`,
  ...extra,
})

const RONDO: Ejercicio = {
  id: 'e1',
  nombre: 'Rondo 4 contra 1',
  categoria: 'calentamiento',
  duracionMin: 10,
  etiquetas: ['posesión'],
  archivado: false,
  descripcion: 'Cuadrado de 6×6 m',
  jugadores: '5',
  material: 'Conos',
  usos: 0,
  medios: [
    medio('m1', { pie: 'Colocación' }),
    medio('m2', { tipo: 'video', mime: 'video/mp4', orden: 1, duracionSeg: 30 }),
    medio('m3', {
      tipo: 'enlace',
      url: 'https://www.youtube.com/watch?v=abc',
      urlArchivo: null,
      urlMiniatura: null,
      orden: 2,
    }),
    medio('m4', {
      tipo: 'video',
      estado: 'procesando',
      urlArchivo: null,
      urlMiniatura: null,
      orden: 3,
    }),
  ],
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const BASE = '/api/clubes/c1/ejercicios'

function conBiblioteca(
  p = senior26,
  lista: ResumenEjercicio[] = [
    resumen('e1', 'Rondo 4 contra 1', {
      categoria: 'calentamiento',
      duracionMin: 10,
      etiquetas: ['posesión'],
      medios: 4,
      urlMiniatura: '/api/medios/m1/miniatura',
    }),
  ],
  ejercicio = RONDO,
) {
  conDatos({ plantillas: [p] })
  let actual = ejercicio
  manejadores[`GET ${BASE}`] = () => json(lista)
  manejadores[`GET ${BASE}/etiquetas`] = () => json(['posesión', 'presión'])
  manejadores[`GET ${BASE}/e1`] = () => json(actual)
  manejadores['GET /api/medios/limites'] = () =>
    json({ maxFotoBytes: 15 * 1024 * 1024, maxVideoBytes: 150 * 1024 * 1024 })
  manejadores[`POST ${BASE}`] = async (peticion) =>
    json({ ...RONDO, ...((await peticion.json()) as object), id: 'e2', medios: [] }, 201)
  manejadores[`PATCH ${BASE}/e1`] = async (peticion) => {
    actual = { ...actual, ...((await peticion.json()) as object) }
    return json(actual)
  }
  manejadores[`PUT ${BASE}/e1/medios/orden`] = async (peticion) => {
    const { medios } = (await peticion.json()) as { medios: string[] }
    actual = {
      ...actual,
      medios: medios.map((id) => actual.medios.find((m) => m.id === id) as Medio),
    }
    return json(actual)
  }
}

describe('lista de ejercicios', () => {
  it('se busca y se filtra; los filtros van en la dirección', async () => {
    conBiblioteca()
    const router = abrir('/plantillas/p1/entrenos/ejercicios')
    const lista = await screen.findByRole('list', { name: 'Ejercicios' })
    expect(within(lista).getByRole('link')).toHaveTextContent(
      "Rondo 4 contra 1Calentamiento · 10'posesión",
    )
    // La miniatura es decorativa (alt vacío): no tiene rol de imagen
    expect(lista.querySelector('img')).toHaveAttribute('src', '/api/medios/m1/miniatura')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Categoría' }), 'tactica')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Etiqueta' }), 'presión')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Archivados' }))
    // La búsqueda se aplica al dejar de escribir
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar ejercicio' }), 'rondo')
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).toString()).toBe(
        'categoria=tactica&etiqueta=presi%C3%B3n&archivados=si&q=rondo',
      ),
    )
  })

  it('el cuerpo técnico crea un ejercicio y va a su ficha', async () => {
    conBiblioteca()
    const router = abrir('/plantillas/p1/entrenos/ejercicios')
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo ejercicio' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo ejercicio' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear ejercicio' }))
    expect(within(hoja).getByText('Escribe el nombre del ejercicio')).toBeInTheDocument()
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Presión tras pérdida')
    await userEvent.selectOptions(within(hoja).getByLabelText('Categoría'), 'tactica')
    await userEvent.type(within(hoja).getByLabelText('Duración (min)'), '15')
    await userEvent.type(within(hoja).getByLabelText('Etiquetas'), 'presión, transición')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear ejercicio' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/entrenos/ejercicios/e2'))
    expect(enviado(`POST ${BASE}`)).toEqual([
      {
        nombre: 'Presión tras pérdida',
        categoria: 'tactica',
        duracionMin: 15,
        jugadores: null,
        material: null,
        descripcion: null,
        etiquetas: ['presión', 'transición'],
      },
    ])
  })

  it('un jugador consulta, pero no crea', async () => {
    conBiblioteca(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), [])
    abrir('/plantillas/p1/entrenos/ejercicios')
    expect(await screen.findByText('La biblioteca está vacía')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo ejercicio' })).not.toBeInTheDocument()
  })
})

describe('ficha del ejercicio', () => {
  it('muestra fotos, vídeos, enlaces y lo que se está procesando', async () => {
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const galeria = await screen.findByRole('list', { name: 'Fotos, vídeos y enlaces' })
    expect(within(galeria).getByRole('img', { name: 'Colocación' })).toHaveAttribute(
      'src',
      '/api/medios/m1',
    )
    expect(galeria.querySelector('video source')).toHaveAttribute('src', '/api/medios/m2')
    expect(within(galeria).getByRole('link', { name: /youtube\.com/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abc',
    )
    expect(within(galeria).getByRole('status')).toHaveTextContent('Procesando el vídeo')
    expect(screen.getByText('Cuadrado de 6×6 m')).toBeInTheDocument()
  })

  it('reordena y archiva', async () => {
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    await userEvent.click(await screen.findByRole('button', { name: 'Bajar la foto' }))
    await waitFor(() =>
      expect(enviado(`PUT ${BASE}/e1/medios/orden`)).toEqual([
        { medios: ['m2', 'm1', 'm3', 'm4'] },
      ]),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Archivar' }))
    expect(await screen.findByText('Ejercicio archivado')).toBeInTheDocument()
    expect(enviado(`PATCH ${BASE}/e1`)).toEqual([{ archivado: true }])
    expect(await screen.findByRole('button', { name: 'Recuperar' })).toBeInTheDocument()
  })

  it('avisa antes de subir de las HEIC y de lo que pasa del límite, y sube lo demás', async () => {
    const envios: FormData[] = []
    // XMLHttpRequest simulado: la subida va al momento con progreso
    class SubidaFalsa {
      upload: {
        onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void
      } = {}
      onload?: () => void
      status = 201
      response = medio('m9', {})
      responseType = ''
      open() {}
      abort() {}
      send(cuerpo: FormData) {
        envios.push(cuerpo)
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 })
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('XMLHttpRequest', SubidaFalsa)
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const entrada = await screen.findByLabelText('Fotos o vídeos del ejercicio')
    const heic = new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' })
    const enorme = new File(['x'], 'largo.mp4', { type: 'video/mp4' })
    Object.defineProperty(enorme, 'size', { value: 200 * 1024 * 1024 })
    const buena = new File(['x'], 'campo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(entrada, [heic, enorme, buena], { applyAccept: false })
    const subidas = await screen.findByRole('list', { name: 'Subidas' })
    expect(await within(subidas).findByText(/HEIC no se admiten/)).toBeInTheDocument()
    expect(
      within(subidas).getByText('Pesa 200 MB y el máximo para vídeos es 150 MB'),
    ).toBeInTheDocument()
    await waitFor(() => expect(envios).toHaveLength(1))
    expect(((envios[0] as FormData).get('archivo') as File).name).toBe('campo.jpg')
    // Los avisos se cierran
    await userEvent.click(
      within(subidas).getByRole('button', { name: 'Cerrar aviso de IMG_1.HEIC' }),
    )
    expect(within(subidas).queryByText(/HEIC/)).not.toBeInTheDocument()
  })

  it('sin permiso no hay herramientas; con usos no se puede borrar', async () => {
    conBiblioteca(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    await screen.findByRole('list', { name: 'Fotos, vídeos y enlaces' })
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
  })

  it('un ejercicio usado no se puede borrar, solo archivar', async () => {
    conBiblioteca(senior26, undefined, { ...RONDO, usos: 2 })
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    expect(await screen.findByRole('button', { name: 'Archivar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument()
  })
})
