import type { ReactNode } from 'react'
import estilos from './EstadoVacio.module.css'

type Props = {
  icono?: ReactNode
  titulo: string
  descripcion?: ReactNode
  // Acción que invita a empezar, p. ej. "Añadir el primer jugador"
  accion?: ReactNode
}

export function EstadoVacio({ icono, titulo, descripcion, accion }: Props) {
  return (
    <section className={estilos.vacio}>
      {icono && (
        <div className={estilos.icono} aria-hidden="true">
          {icono}
        </div>
      )}
      <h2>{titulo}</h2>
      {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
      {accion && <div className={estilos.accion}>{accion}</div>}
    </section>
  )
}
