import { Coins } from 'lucide-react'
import { EstadoVacio } from '../componentes/EstadoVacio'

// Secciones provisionales: cada una se construye en su ciclo (ver el documento de proyecto)

export function PaginaMultas() {
  return (
    <EstadoVacio
      icono={<Coins size={32} />}
      titulo="Multas"
      descripcion="Catálogo de multas, cobros y la caja del vestuario. Llega en el ciclo 4."
    />
  )
}
