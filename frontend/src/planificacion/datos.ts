import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'

export type Plan = components['schemas']['Plan']
export type EjercicioPlan = Plan['ejercicios'][number]
export type ModeloSesion = components['schemas']['ModeloSesion']

// El plan de un entreno cuelga de la clave de los entrenos: al guardarlo se refrescan también el
// historial y pasar lista, que muestran su resumen
export const clavePlan = (plantillaId: string, entrenoId: string) =>
  ['entrenos', plantillaId, 'plan', entrenoId] as const

export const usePlan = (plantillaId: string, entrenoId: string) =>
  useQuery({
    queryKey: clavePlan(plantillaId, entrenoId),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos/{eid}/plan', {
          params: { path: { id: plantillaId, eid: entrenoId } },
        }),
      ),
  })

export const CLAVE_MODELOS = ['modelos-sesion'] as const

export const useModelos = (clubId: string, activa = true) =>
  useQuery({
    queryKey: [...CLAVE_MODELOS, clubId],
    queryFn: () =>
      datos(api.GET('/api/clubes/{cid}/modelos-sesion', { params: { path: { cid: clubId } } })),
    enabled: activa,
  })

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// "Salida de balón · 5 ejercicios · 78'" o null si el entreno no tiene plan
export function resumenPlan(e: {
  objetivo: string | null
  ejerciciosPlan: number
  duracionPlan: number
}) {
  if (!e.objetivo && e.ejerciciosPlan === 0) return null
  return [
    e.objetivo,
    e.ejerciciosPlan > 0 && plural(e.ejerciciosPlan, 'ejercicio', 'ejercicios'),
    e.duracionPlan > 0 && `${e.duracionPlan}'`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export const rutaPlan = (plantillaId: string, entrenoId: string) =>
  `/plantillas/${plantillaId}/entrenos/plan/${entrenoId}`

export const rutaCampo = (plantillaId: string, entrenoId: string) =>
  `/plantillas/${plantillaId}/campo/${entrenoId}`
