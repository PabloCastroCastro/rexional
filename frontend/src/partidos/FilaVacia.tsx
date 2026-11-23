import type { ReactNode } from 'react'
import estilos from './Partidos.module.css'

// Una sección de la ficha del partido mientras no tiene nada (GH-285): una fila de una línea con su
// icono, su nombre, una frase corta y la acción a la derecha. Sigue siendo una sección con su título;
// las filas vacías seguidas de una pestaña se ven juntas en una tarjeta (por CSS)
export function FilaVacia({
  id,
  icono,
  titulo,
  frase,
  accion,
  children,
}: {
  id: string
  icono: ReactNode
  titulo: string
  frase: string
  accion?: ReactNode
  // La hoja que abre la acción: dentro, para no separar las filas seguidas
  children?: ReactNode
}) {
  return (
    <section className={estilos.filaVacia} aria-labelledby={id}>
      <span className={estilos.iconoFilaVacia} aria-hidden="true">
        {icono}
      </span>
      <span className={estilos.textoFilaVacia}>
        <h2 id={id}>{titulo}</h2>
        <span>{frase}</span>
      </span>
      {accion && <span className={estilos.accionFilaVacia}>{accion}</span>}
      {children}
    </section>
  )
}
