import { UserX } from 'lucide-react'
import { EstadoVacio } from '../componentes/EstadoVacio'

// Rol jugador sin ficha vinculada en la plantilla (GH-52): sin ella no hay datos propios que enseñar
export function SinFicha({ que }: { que: string }) {
  return (
    <EstadoVacio
      icono={<UserX size={32} />}
      titulo="Tu cuenta no está vinculada a tu ficha"
      descripcion={`Para ver ${que}, pide al admin de la plantilla que vincule tu cuenta con tu ficha de jugador.`}
    />
  )
}
