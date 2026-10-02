import { CalendarDays, ClipboardCheck, Coins, Users } from 'lucide-react'
import { EstadoVacio } from '../componentes/EstadoVacio'

// Secciones provisionales: cada una se construye en su ciclo (ver el documento de proyecto)

export function PaginaPlantilla() {
  return (
    <EstadoVacio
      icono={<Users size={32} />}
      titulo="Plantilla"
      descripcion="Aquí verás los jugadores de la plantilla, con su dorsal, posición, asistencia y multas pendientes."
    />
  )
}

export function PaginaEntrenos() {
  return (
    <EstadoVacio
      icono={<ClipboardCheck size={32} />}
      titulo="Entrenos"
      descripcion="Pasar lista en cada entreno y consultar el historial de asistencia. Llega en el ciclo 2."
    />
  )
}

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
