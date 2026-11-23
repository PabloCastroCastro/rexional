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

// habilitado: false para no pedirlos (p. ej., las bajas al rol jugador, que no las ve)
export const useJugadores = (plantillaId: string, activos: boolean, habilitado = true) =>
  useQuery({
    enabled: habilitado,
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

// "Brais Iglesias", o solo el nombre si no tiene apellidos
export const nombreCompleto = (j: { nombre: string; apellidos?: string | null }) =>
  j.apellidos ? `${j.nombre} ${j.apellidos}` : j.nombre

// Partículas que van con el apellido que las sigue: «da Silva», «de la Fuente»
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'da', 'das', 'do', 'dos'])

// "Breogán Couto" para "Breogán Couto Pérez": el nombre y el primer apellido, con sus partículas
export function nombreCorto(j: { nombre: string; apellidos?: string | null }) {
  const palabras = j.apellidos?.trim().split(/\s+/) ?? []
  const fin = palabras.findIndex((p) => !PARTICULAS.has(p.toLowerCase()))
  const primero = fin === -1 ? palabras : palabras.slice(0, fin + 1)
  return primero.length ? `${j.nombre} ${primero.join(' ')}` : j.nombre
}

// Nombre corto de cada jugador de una lista (GH-257); si dos coinciden, esos dos llevan el completo
export function nombresCortos<
  J extends { jugadorId: string; nombre: string; apellidos?: string | null },
>(jugadores: J[]) {
  const veces = new Map<string, number>()
  for (const j of jugadores) {
    const corto = nombreCorto(j).toLocaleLowerCase('es')
    veces.set(corto, (veces.get(corto) ?? 0) + 1)
  }
  return new Map(
    jugadores.map((j) => {
      const corto = nombreCorto(j)
      return [
        j.jugadorId,
        (veces.get(corto.toLocaleLowerCase('es')) ?? 0) > 1 ? nombreCompleto(j) : corto,
      ]
    }),
  )
}

// Gestionar jugadores: delegado o superior (sección 3)
export const puedeGestionarJugadores = (plantilla: { rol: string; esAdminClub: boolean }) =>
  plantilla.esAdminClub || plantilla.rol !== 'jugador'

export type JugadorInvitable = components['schemas']['JugadorInvitable']

// Jugadores de las otras plantillas del club en la temporada, para invitarlos (GH-188)
export const useInvitables = (plantillaId: string, q: string, activa: boolean) =>
  useQuery({
    queryKey: [...CLAVE_JUGADORES, 'invitables', plantillaId, q],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/invitables', {
          params: { path: { id: plantillaId }, query: q ? { q } : {} },
        }),
      ),
    enabled: activa,
    placeholderData: keepPreviousData,
  })

// "Invitado · Juvenil A", o solo "Invitado" si no se sabe de dónde viene
export const textoInvitado = (j: { procedencia?: string | null }) =>
  j.procedencia ? `Invitado · ${j.procedencia}` : 'Invitado'
