import type { EstadoJugador } from '../componentes/IconoEstado'
import { hoy } from '../entrenos/datos'
import { type LesionActual, textoLesion } from './Lesiones'
import { type SancionesJugador, textoSancion } from './Sanciones'

export type Estado = { tipo: EstadoJugador; texto: string }

// El estado que se marca sobre el dorsal, uno solo: primero la sanción, luego la lesión y por último
// el apercibimiento (GH-251). La sanción llega como los partidos que le quedan para este partido
// (convocatoria) o como las sanciones del jugador (plantilla)
export function estadoJugador(
  {
    lesion,
    sancion,
    sanciones,
  }: {
    lesion?: LesionActual
    sancion?: { partidos: number } | null
    sanciones?: SancionesJugador
  },
  hoyEs = hoy(),
): Estado | null {
  const pendientes =
    sancion?.partidos ?? sanciones?.pendientes.reduce((total, p) => total + p.partidos, 0) ?? 0
  if (pendientes > 0) return { tipo: 'sancion', texto: textoSancion(pendientes) }
  if (lesion) return { tipo: 'lesion', texto: textoLesion(lesion, hoyEs) }
  if (sanciones?.apercibido.length) return { tipo: 'apercibido', texto: 'Apercibido' }
  return null
}
