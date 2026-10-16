import { ClipboardList } from 'lucide-react'
import { Link } from 'react-router'
import type { ResumenEntreno } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { resumenPlan, rutaPlan } from './datos'
import estilos from './Planificacion.module.css'

// El plan del entreno elegido en pasar lista: su resumen y el acceso a verlo o planificarlo
export function TarjetaPlan({ entreno }: { entreno: ResumenEntreno }) {
  const plantilla = usePlantillaActiva()
  const resumen = resumenPlan(entreno)
  if (!resumen && !puedeGestionarJugadores(plantilla)) return null
  return (
    <Link to={rutaPlan(plantilla.id, entreno.id)} className={estilos.tarjetaPlan}>
      <ClipboardList aria-hidden size={22} />
      <span>
        <strong>{resumen ? 'Plan del entreno' : 'Planificar el entreno'}</strong>
        <span className={estilos.secundario}>
          {resumen ?? 'Añade los ejercicios de la biblioteca y el objetivo de la sesión'}
        </span>
      </span>
    </Link>
  )
}
