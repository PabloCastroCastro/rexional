import { Cross, RectangleVertical } from 'lucide-react'
import estilos from './IconoEstado.module.css'

// Estado de un jugador que se marca sobre su dorsal y en las listas (GH-251)
export type EstadoJugador = 'lesion' | 'sancion' | 'apercibido'

// Cruz para la lesión, tarjeta roja para la sanción y amarilla para el apercibimiento. Siempre
// decorativo: el texto lo pone quien lo usa
export function IconoEstado({
  estado,
  size = 14,
  className,
}: {
  estado: EstadoJugador
  size?: number
  className?: string
}) {
  const Icono = estado === 'lesion' ? Cross : RectangleVertical
  return (
    <Icono
      aria-hidden
      size={size}
      data-estado={estado}
      className={className ? `${estilos.icono} ${className}` : estilos.icono}
    />
  )
}
