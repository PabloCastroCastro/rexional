import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type JugadorPlantilla = components['schemas']['JugadorPlantilla']
export type JugadorClub = components['schemas']['JugadorClub']
export type Trayectoria = components['schemas']['TrayectoriaJugador']
export type Posicion = NonNullable<JugadorPlantilla['posicion']>

export const POSICIONES: Record<Posicion, string> = {
  portero: 'Portero',
  defensa: 'Defensa',
  centrocampista: 'Centrocampista',
  delantero: 'Delantero',
}

// Todas las consultas de jugadores cuelgan de esta clave, para refrescarlas juntas tras un cambio
export const CLAVE_JUGADORES = ['jugadores'] as const

export const useJugadores = (plantillaId: string, activos: boolean) =>
  useQuery({
    queryKey: [...CLAVE_JUGADORES, 'plantilla', plantillaId, activos],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/jugadores', {
          params: { path: { id: plantillaId }, query: { activos: activos ? 'true' : 'false' } },
        }),
      ),
  })

export const useTrayectoria = (clubId: string, jugadorId: string) =>
  useQuery({
    queryKey: [...CLAVE_JUGADORES, 'club', clubId, jugadorId],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/jugadores/{jid}', {
          params: { path: { cid: clubId, jid: jugadorId } },
        }),
      ),
  })

export const useBuscarJugadores = (clubId: string, q: string, activa: boolean) =>
  useQuery({
    queryKey: [...CLAVE_JUGADORES, 'buscar', clubId, q],
    queryFn: () =>
      datos(
        api.GET('/api/clubes/{cid}/jugadores', {
          params: { path: { cid: clubId }, query: q ? { q } : {} },
        }),
      ),
    enabled: activa,
    // Mientras se escribe, se mantienen los resultados anteriores en vez de parpadear
    placeholderData: keepPreviousData,
  })

// Gestionar jugadores: delegado o superior (sección 3)
export const puedeGestionarJugadores = (plantilla: { rol: string; esAdminClub: boolean }) =>
  plantilla.esAdminClub || plantilla.rol !== 'jugador'
