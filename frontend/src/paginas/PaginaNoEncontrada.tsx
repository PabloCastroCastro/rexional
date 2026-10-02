import { MapPinOff } from 'lucide-react'
import { Link } from 'react-router'
import { EstadoVacio } from '../componentes/EstadoVacio'

export function PaginaNoEncontrada() {
  return (
    <EstadoVacio
      icono={<MapPinOff size={32} />}
      titulo="Esta página no existe"
      descripcion="Puede que el enlace esté mal o que la página se haya movido."
      accion={<Link to="/plantilla">Ir a la plantilla</Link>}
    />
  )
}
