import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type Plantilla = components['schemas']['PlantillaConClub']
export type Club = components['schemas']['Club']

export const CLAVE_PLANTILLAS = ['plantillas'] as const
export const CLAVE_CLUBES = ['clubes'] as const

export const usePlantillas = () =>
  useQuery({ queryKey: CLAVE_PLANTILLAS, queryFn: () => datos(api.GET('/api/plantillas')) })

export const useClubes = () =>
  useQuery({ queryKey: CLAVE_CLUBES, queryFn: () => datos(api.GET('/api/clubes')) })

// Temporada en curso: desde julio cuenta la siguiente (2026-07-01 → 2026-27)
export function temporadaDe(fecha: Date): string {
  const inicio = fecha.getMonth() >= 6 ? fecha.getFullYear() : fecha.getFullYear() - 1
  return `${inicio}-${String((inicio + 1) % 100).padStart(2, '0')}`
}

export const temporadaDesplazada = (temporada: string, años: number) => {
  const inicio = Number(temporada.slice(0, 4)) + años
  return `${inicio}-${String((inicio + 1) % 100).padStart(2, '0')}`
}

export const CATEGORIAS = [
  'prebenjamín',
  'benjamín',
  'alevín',
  'infantil',
  'cadete',
  'juvenil',
  'sénior',
  'veteranos',
]

// Agrupa por club y, dentro, por temporada (la API ya las devuelve ordenadas)
export function agruparPlantillas(plantillas: Plantilla[]) {
  const clubes: {
    club: Plantilla['club']
    temporadas: { temporada: string; plantillas: Plantilla[] }[]
  }[] = []
  for (const p of plantillas) {
    let grupo = clubes.find((g) => g.club.id === p.club.id)
    if (!grupo) {
      grupo = { club: p.club, temporadas: [] }
      clubes.push(grupo)
    }
    let temporada = grupo.temporadas.find((t) => t.temporada === p.temporada)
    if (!temporada) {
      temporada = { temporada: p.temporada, plantillas: [] }
      grupo.temporadas.push(temporada)
    }
    temporada.plantillas.push(p)
  }
  return clubes
}

// Última plantilla usada, por usuario, para entrar directamente la próxima vez
const claveUltima = (usuarioId: string) => `vestuario:ultima-plantilla:${usuarioId}`

export const leerUltimaPlantilla = (usuarioId: string) => {
  try {
    return localStorage.getItem(claveUltima(usuarioId))
  } catch {
    return null
  }
}

export const guardarUltimaPlantilla = (usuarioId: string, plantillaId: string) => {
  try {
    localStorage.setItem(claveUltima(usuarioId), plantillaId)
  } catch {}
}
