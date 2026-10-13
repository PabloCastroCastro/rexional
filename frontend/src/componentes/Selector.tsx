import { type ReactNode, type SelectHTMLAttributes, useId } from 'react'
import estilos from './Campo.module.css'

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  etiqueta: string
  error?: string
  children: ReactNode
}

// Desplegable con el mismo aspecto que Campo
export function Selector({ etiqueta, error, id, className, children, ...resto }: Props) {
  const generado = useId()
  const idCampo = id ?? generado
  const idError = `${idCampo}-error`

  return (
    <div className={[estilos.campo, className].filter(Boolean).join(' ')}>
      <label htmlFor={idCampo} className={estilos.etiqueta}>
        {etiqueta}
      </label>
      <select
        id={idCampo}
        className={estilos.entrada}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? idError : undefined}
        {...resto}
      >
        {children}
      </select>
      {error && (
        <p id={idError} className={estilos.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
