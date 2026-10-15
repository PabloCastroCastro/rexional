import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type ResumenPartido = components['schemas']['ResumenPartido']
export type Partido = components['schemas']['Partido']
export type Cuando = 'proximos' | 'pasados'

// Listas, detalle y mensaje de los partidos cuelgan de esta clave, para refrescarlos juntos
export const CLAVE_PARTIDOS = ['partidos'] as const

export const usePartidos = (plantillaId: string, cuando: Cuando) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, plantillaId, cuando],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos', {
          params: { path: { id: plantillaId }, query: { cuando } },
        }),
      ),
  })

export const usePartido = (plantillaId: string, partidoId: string) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, plantillaId, 'partido', partidoId],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos/{pid}', {
          params: { path: { id: plantillaId, pid: partidoId } },
        }),
      ),
  })

// Texto de la convocatoria para WhatsApp y su enlace wa.me
export const useMensaje = (plantillaId: string, partidoId: string) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, plantillaId, 'mensaje', partidoId],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos/{pid}/mensaje', {
          params: { path: { id: plantillaId, pid: partidoId } },
        }),
      ),
  })

// "Casa", "Fuera" o nada si no se sabe
export const textoLocal = (local: boolean | null) =>
  local === true ? 'Casa' : local === false ? 'Fuera' : null

// Competiciones ya usadas y el último campo en casa, para proponerlos en el formulario
export function sugerencias(partidos: ResumenPartido[]) {
  const competiciones = [
    ...new Set(partidos.map((p) => p.competicion).filter((c): c is string => Boolean(c))),
  ].sort((a, b) => a.localeCompare(b, 'es'))
  const enCasa = partidos
    .filter((p) => p.local === true && p.lugar)
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
  return { competiciones, campoEnCasa: enCasa[0]?.lugar ?? null }
}
