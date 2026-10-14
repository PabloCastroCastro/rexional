import { CalendarDays, Coins } from 'lucide-react'
import { EstadoVacio } from '../componentes/EstadoVacio'

// Secciones provisionales: cada una se construye en su ciclo (ver el documento de proyecto)

export function PaginaPartidos() {
  return (
    <EstadoVacio
      icono={<CalendarDays size={32} />}
      titulo="Partidos"
      descripcion="Partidos, convocatorias y el mensaje para enviar por WhatsApp. Llega en el ciclo 3."
    />
  )
}

export function PaginaMultas() {
  return (
    <EstadoVacio
      icono={<Coins size={32} />}
      titulo="Multas"
      descripcion="Catálogo de multas, cobros y la caja del vestuario. Llega en el ciclo 4."
    />
  )
}
