import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import estilos from './Boton.module.css'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: 'primario' | 'secundario' | 'peligro' | 'texto'
  // Muestra un indicador y desactiva el botón mientras dura una acción
  cargando?: boolean
  icono?: ReactNode
  anchoCompleto?: boolean
}

export function Boton({
  variante = 'primario',
  cargando = false,
  icono,
  anchoCompleto = false,
  disabled,
  className,
  children,
  type = 'button',
  ...resto
}: Props) {
  const clases = [
    estilos.boton,
    estilos[variante],
    anchoCompleto && estilos.anchoCompleto,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type={type}
      className={clases}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando ? <LoaderCircle className={estilos.girando} aria-hidden size={18} /> : icono}
      {children}
    </button>
  )
}
