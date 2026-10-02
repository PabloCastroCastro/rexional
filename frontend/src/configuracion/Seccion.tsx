import { type ReactNode, useId } from 'react'
import estilos from './Configuracion.module.css'

export function Seccion({
  titulo,
  descripcion,
  children,
}: {
  titulo: string
  descripcion?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className={estilos.seccion} aria-labelledby={id}>
      <div className={estilos.cabeceraSeccion}>
        <h2 id={id}>{titulo}</h2>
        {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
      </div>
      {children}
    </section>
  )
}
