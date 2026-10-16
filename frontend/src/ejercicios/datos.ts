import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, datos, ErrorApi } from '../api/cliente'
import type { components } from '../api/esquema'

export type ResumenEjercicio = components['schemas']['ResumenEjercicio']
export type Ejercicio = components['schemas']['Ejercicio']
export type Medio = components['schemas']['Medio']
export type Categoria = NonNullable<Ejercicio['categoria']>

export const CATEGORIAS: Record<Categoria, string> = {
  calentamiento: 'Calentamiento',
  tecnica: 'Técnica',
  tactica: 'Táctica',
  fisico: 'Físico',
  finalizacion: 'Finalización',
  porteros: 'Porteros',
  partido: 'Partido',
  vuelta_calma: 'Vuelta a la calma',
}

// La biblioteca es del club: sus consultas cuelgan de esta clave
export const CLAVE_EJERCICIOS = ['ejercicios'] as const

export type Filtros = {
  q?: string
  categoria?: Categoria
  etiqueta?: string
  archivados?: 'no' | 'si' | 'todos'
}

export const useEjercicios = (clubId: string, filtros: Filtros) =>
  useQuery({
    queryKey: [...CLAVE_EJERCICIOS, clubId, 'lista', filtros],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/ejercicios', {
          params: { path: { cid: clubId }, query: filtros },
        }),
      ),
    // Al escribir en el buscador, la lista anterior se queda hasta que llega la nueva
    placeholderData: keepPreviousData,
  })

export const useEtiquetas = (clubId: string) =>
  useQuery({
    queryKey: [...CLAVE_EJERCICIOS, clubId, 'etiquetas'],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/ejercicios/etiquetas', { params: { path: { cid: clubId } } }),
      ),
  })

export const useEjercicio = (clubId: string, ejercicioId: string) =>
  useQuery({
    queryKey: [...CLAVE_EJERCICIOS, clubId, 'ejercicio', ejercicioId],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/ejercicios/{eid}', {
          params: { path: { cid: clubId, eid: ejercicioId } },
        }),
      ),
    // Mientras un vídeo se procesa, se vuelve a mirar cada pocos segundos
    refetchInterval: (consulta) =>
      consulta.state.data?.medios.some((m) => m.estado === 'procesando') ? 4000 : false,
  })

export const useLimites = () =>
  useQuery({
    queryKey: ['medios', 'limites'],
    queryFn: () => datos(api.GET('/api/medios/limites')),
    staleTime: Number.POSITIVE_INFINITY,
  })

// "Táctica · 20'"
export const textoDetalles = (e: { categoria: Categoria | null; duracionMin: number | null }) =>
  [e.categoria ? CATEGORIAS[e.categoria] : null, e.duracionMin ? `${e.duracionMin}'` : null]
    .filter(Boolean)
    .join(' · ')

export const textoMb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`

// Sube una foto o un vídeo con progreso y se puede cancelar (fetch no informa del progreso de la
// subida). Resuelve con el medio creado o rechaza con un ErrorApi.
export function subirMedio(
  clubId: string,
  ejercicioId: string,
  archivo: File,
  alProgresar: (fraccion: number) => void,
) {
  const peticion = new XMLHttpRequest()
  const promesa = new Promise<Medio>((resolver, rechazar) => {
    peticion.open('POST', `/api/clubes/${clubId}/ejercicios/${ejercicioId}/medios`)
    peticion.responseType = 'json'
    peticion.upload.onprogress = (e) => {
      if (e.lengthComputable) alProgresar(e.loaded / e.total)
    }
    peticion.onload = () => {
      if (peticion.status === 201) return resolver(peticion.response as Medio)
      const cuerpo = peticion.response as { error?: { codigo?: string; mensaje?: string } } | null
      rechazar(
        new ErrorApi(
          peticion.status,
          cuerpo?.error?.codigo ?? 'error',
          cuerpo?.error?.mensaje ?? 'No se ha podido subir el archivo',
        ),
      )
    }
    peticion.onerror = () =>
      rechazar(new ErrorApi(0, 'red', 'Se ha cortado la conexión: inténtalo de nuevo'))
    peticion.onabort = () => rechazar(new ErrorApi(0, 'cancelada', 'Subida cancelada'))
    const formulario = new FormData()
    formulario.append('archivo', archivo)
    peticion.send(formulario)
  })
  return { promesa, cancelar: () => peticion.abort() }
}

// Dominio de un enlace, para mostrarlo: «youtube.com»
export function dominio(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
