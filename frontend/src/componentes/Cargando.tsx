import { LoaderCircle } from 'lucide-react'
import estilos from './Cargando.module.css'

// Indicador de carga centrado, anunciado a los lectores de pantalla
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className={estilos.cargando} role="status">
      <LoaderCircle className={estilos.icono} aria-hidden size={32} />
      <span>{texto}</span>
    </div>
  )
}
