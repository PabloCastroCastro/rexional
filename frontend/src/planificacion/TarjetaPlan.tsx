import { ClipboardList } from 'lucide-react'
import { Link } from 'react-router'
import type { ResumenEntreno } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { resumenPlan, rutaPlan } from './datos'
import estilos from './Planificacion.module.css'

// El plan del entreno elegido en pasar lista: su resumen y el acceso a verlo. Sin plan no ocupa sitio:
// se planifica desde el enlace de la fila de la sesión (GH-258)
export function TarjetaPlan({ entreno }: { entreno: ResumenEntreno }) {
  const plantilla = usePlantillaActiva()
  const resumen = resumenPlan(entreno)
  if (!resumen) return null
  return (
    <Link to={rutaPlan(plantilla.id, entreno.id)} className={estilos.tarjetaPlan}>
      <ClipboardList aria-hidden size={22} />
      <span>
        <strong>Plan del entreno</strong>
        <span className={estilos.secundario}>{resumen}</span>
      </span>
    </Link>
  )
}

// Entreno sin plan, para quien puede planificarlo: un enlace en la fila de la sesión (GH-258)
export function EnlacePlanificar({ entreno }: { entreno: ResumenEntreno }) {
  const plantilla = usePlantillaActiva()
  if (resumenPlan(entreno) || !puedeGestionarJugadores(plantilla)) return null
  return (
    <Link to={rutaPlan(plantilla.id, entreno.id)} className={estilos.enlacePlanificar}>
      <ClipboardList aria-hidden size={18} />
      Planificar
    </Link>
  )
}
