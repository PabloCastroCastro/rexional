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

export type ActaLeida = components['schemas']['ActaLeida']
export type LecturaActa = NonNullable<components['schemas']['LecturaActa']>

// Lo leído del acta guardada, para revisarlo antes de registrarlo
export const useActa = (plantillaId: string, partidoId: string) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, plantillaId, 'acta', partidoId],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos/{pid}/acta/lectura', {
          params: { path: { id: plantillaId, pid: partidoId } },
        }),
      ),
  })

// Sube la ficha del partido en PDF (sustituye a la anterior) y devuelve lo leído
export const subirActa = (plantillaId: string, partidoId: string, archivo: File) =>
  datos(
    api.POST('/api/plantillas/{id}/partidos/{pid}/acta', {
      params: { path: { id: plantillaId, pid: partidoId } },
      // El contrato lo describe como binario (string): se envía el archivo en un formulario
      body: { archivo: archivo.name },
      bodySerializer: () => {
        const formulario = new FormData()
        formulario.append('archivo', archivo)
        return formulario
      },
    }),
  )

// Dirección del PDF del acta, para abrirlo o descargarlo
export const urlActa = (plantillaId: string, partidoId: string) =>
  `/api/plantillas/${plantillaId}/partidos/${partidoId}/acta`

// "7–1" si el partido se ha jugado
export const textoResultado = (p: { golesFavor: number | null; golesContra: number | null }) =>
  p.golesFavor === null || p.golesContra === null ? null : `${p.golesFavor}–${p.golesContra}`

export type EstadisticasPlantilla = components['schemas']['EstadisticasPlantilla']
export type EstadisticasJugador = components['schemas']['EstadisticasJugador']
export type TrayectoriaEstadisticas = components['schemas']['TrayectoriaEstadisticas']

// Resultados del equipo y acumulados por jugador en los partidos jugados de la plantilla
export const useEstadisticas = (plantillaId: string) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, plantillaId, 'estadisticas'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/estadisticas', { params: { path: { id: plantillaId } } }),
      ),
  })

// Estadísticas del jugador en cada temporada en el club
export const useTrayectoriaEstadisticas = (clubId: string, jugadorId: string, activa = true) =>
  useQuery({
    queryKey: [...CLAVE_PARTIDOS, 'trayectoria', clubId, jugadorId],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/jugadores/{jid}/estadisticas', {
          params: { path: { cid: clubId, jid: jugadorId } },
        }),
      ),
    enabled: activa,
  })

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// "4 partidos (3 de titular) · 360' · 2 goles · 1 asistencia · 1 amarilla"
export function resumenEstadisticas(e: {
  partidos: number
  titularidades: number
  minutos: number
  goles: number
  asistencias: number
  amarillas: number
  rojas: number
}) {
  return [
    `${plural(e.partidos, 'partido', 'partidos')}${e.titularidades > 0 ? ` (${e.titularidades} de titular)` : ''}`,
    e.minutos > 0 && `${e.minutos}'`,
    e.goles > 0 && plural(e.goles, 'gol', 'goles'),
    e.asistencias > 0 && plural(e.asistencias, 'asistencia', 'asistencias'),
    e.amarillas > 0 && plural(e.amarillas, 'amarilla', 'amarillas'),
    e.rojas > 0 && plural(e.rojas, 'roja', 'rojas'),
  ]
    .filter(Boolean)
    .join(' · ')
}
