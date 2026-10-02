import { type InputHTMLAttributes, useId } from 'react'
import estilos from './Campo.module.css'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string
  // Mensaje de error; marca el campo como inválido y lo anuncia a los lectores de pantalla
  error?: string
  ayuda?: string
}

export function Campo({ etiqueta, error, ayuda, id, className, ...resto }: Props) {
  const generado = useId()
  const idCampo = id ?? generado
  const idAyuda = `${idCampo}-ayuda`
  const idError = `${idCampo}-error`
  const descripcion = [ayuda && idAyuda, error && idError].filter(Boolean).join(' ') || undefined

  return (
    <div className={[estilos.campo, className].filter(Boolean).join(' ')}>
      <label htmlFor={idCampo} className={estilos.etiqueta}>
        {etiqueta}
        {resto.required && <span aria-hidden="true"> *</span>}
      </label>
      <input
        id={idCampo}
        className={estilos.entrada}
        aria-invalid={error ? true : undefined}
        aria-describedby={descripcion}
        {...resto}
      />
      {ayuda && (
        <p id={idAyuda} className={estilos.ayuda}>
          {ayuda}
        </p>
      )}
      {error && (
        <p id={idError} className={estilos.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
