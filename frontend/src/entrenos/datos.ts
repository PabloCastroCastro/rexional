import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type Entreno = components['schemas']['Entreno']
export type JugadorEntreno = Entreno['jugadores'][number]
export type Estado = NonNullable<JugadorEntreno['estado']>

// Entrenos, asistencias y resúmenes cuelgan de esta clave, para refrescarlos juntos tras guardar
export const CLAVE_ENTRENOS = ['entrenos'] as const

export const claveEntreno = (plantillaId: string, fecha: string) =>
  [...CLAVE_ENTRENOS, plantillaId, 'dia', fecha] as const

export const useEntreno = (plantillaId: string, fecha: string) =>
  useQuery({
    queryKey: claveEntreno(plantillaId, fecha),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos/{fecha}', {
          params: { path: { id: plantillaId, fecha } },
        }),
      ),
  })

// --- Fechas: siempre AAAA-MM-DD en Europe/Madrid, la zona horaria de la aplicación ---

export const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

export const sumarDias = (fecha: string, dias: number) =>
  new Date(new Date(`${fecha}T12:00:00Z`).getTime() + dias * 86_400_000).toISOString().slice(0, 10)

export const esFechaValida = (fecha: string | null): fecha is string =>
  fecha !== null &&
  /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
  !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`)) &&
  new Date(`${fecha}T12:00:00Z`).toISOString().startsWith(fecha)

const formatoDia = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// "Hoy · martes, 13 oct", "Ayer · lunes, 12 oct", "jueves, 8 oct"
export function textoFecha(fecha: string) {
  const dia = formatoDia.format(new Date(`${fecha}T12:00:00Z`))
  const actual = hoy()
  if (fecha === actual) return `Hoy · ${dia}`
  if (fecha === sumarDias(actual, -1)) return `Ayer · ${dia}`
  return dia
}

export type ResumenEntreno = components['schemas']['ResumenEntreno']
export type AsistenciaJugador = components['schemas']['AsistenciaJugador']

export const useHistorial = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'historial'],
    queryFn: () =>
      datos(api.GET('/api/plantillas/{id}/entrenos', { params: { path: { id: plantillaId } } })),
  })

// Asistencia por jugador (el rol jugador solo recibe la suya)
export const useResumenAsistencia = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, 'resumen'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/asistencia/resumen', {
          params: { path: { id: plantillaId } },
        }),
      ),
  })

const formatoMes = new Intl.DateTimeFormat('es-ES', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

// "octubre de 2026"
export const textoMes = (fecha: string) => formatoMes.format(new Date(`${fecha}T12:00:00Z`))
