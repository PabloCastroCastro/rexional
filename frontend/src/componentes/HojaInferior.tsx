import { X } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import { useDialogoModal } from './dialogo'
import estilos from './HojaInferior.module.css'

type Props = {
  abierta: boolean
  alCerrar: () => void
  titulo: string
  children: ReactNode
  // Botones fijos al pie, p. ej. Guardar
  pie?: ReactNode
}

// Panel que sube desde abajo, para formularios rápidos en el móvil (alta de un jugador, una multa…).
// Se cierra con el botón, con Escape o tocando fuera.
export function HojaInferior({ abierta, alCerrar, titulo, children, pie }: Props) {
  const ref = useDialogoModal(abierta)
  const idTitulo = useId()

  return (
    // Tocar fuera del panel (el fondo del <dialog>) lo cierra; con teclado se cierra con Escape
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape lo gestiona el propio <dialog>
    <dialog
      ref={ref}
      className={estilos.hoja}
      aria-labelledby={idTitulo}
      onCancel={(e) => {
        e.preventDefault()
        alCerrar()
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) alCerrar()
      }}
    >
      <div className={estilos.panel}>
        <header className={estilos.cabecera}>
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className={estilos.cerrar} onClick={alCerrar} aria-label="Cerrar">
            <X aria-hidden size={22} />
          </button>
        </header>
        <div className={estilos.cuerpo}>{children}</div>
        {pie && <footer className={estilos.pie}>{pie}</footer>}
      </div>
    </dialog>
  )
}
