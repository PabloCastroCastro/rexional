import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
} from 'react'
import { Boton } from './Boton'
import estilos from './Confirmacion.module.css'
import { useDialogoModal } from './dialogo'

export type OpcionesConfirmacion = {
  titulo: string
  mensaje?: ReactNode
  textoConfirmar?: string
  textoCancelar?: string
  // Acción destructiva (borrar, dar de baja): el botón de confirmar se muestra en rojo
  peligrosa?: boolean
}

type Confirmar = (opciones: OpcionesConfirmacion) => Promise<boolean>

const ContextoConfirmacion = createContext<Confirmar | null>(null)

// Pide confirmación antes de una acción:
//   const confirmar = useConfirmacion()
//   if (await confirmar({ titulo: '¿Dar de baja a Brais?', peligrosa: true })) { ... }
export function useConfirmacion() {
  const confirmar = useContext(ContextoConfirmacion)
  if (!confirmar) throw new Error('useConfirmacion necesita ProveedorConfirmacion')
  return confirmar
}

export function ProveedorConfirmacion({ children }: { children: ReactNode }) {
  const [opciones, setOpciones] = useState<OpcionesConfirmacion | null>(null)
  const resolver = useRef<(valor: boolean) => void>(undefined)

  const confirmar = useCallback<Confirmar>((nuevas) => {
    resolver.current?.(false)
    setOpciones(nuevas)
    return new Promise((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const responder = (valor: boolean) => {
    resolver.current?.(valor)
    resolver.current = undefined
    setOpciones(null)
  }

  return (
    <ContextoConfirmacion.Provider value={confirmar}>
      {children}
      <DialogoConfirmacion opciones={opciones} alResponder={responder} />
    </ContextoConfirmacion.Provider>
  )
}

function DialogoConfirmacion({
  opciones,
  alResponder,
}: {
  opciones: OpcionesConfirmacion | null
  alResponder: (valor: boolean) => void
}) {
  const ref = useDialogoModal(opciones !== null)
  const idTitulo = useId()
  const idMensaje = useId()

  return (
    <dialog
      ref={ref}
      // Un diálogo modal que pide una decisión es un alertdialog
      role="alertdialog"
      className={estilos.confirmacion}
      aria-labelledby={idTitulo}
      aria-describedby={opciones?.mensaje ? idMensaje : undefined}
      onCancel={(e) => {
        e.preventDefault()
        alResponder(false)
      }}
    >
      {opciones && (
        <div className={estilos.panel}>
          <h2 id={idTitulo}>{opciones.titulo}</h2>
          {opciones.mensaje && (
            <div id={idMensaje} className={estilos.mensaje}>
              {opciones.mensaje}
            </div>
          )}
          <div className={estilos.acciones}>
            {/* El foco empieza en Cancelar: confirmar una acción peligrosa exige un gesto explícito */}
            <Boton variante="secundario" onClick={() => alResponder(false)} autoFocus>
              {opciones.textoCancelar ?? 'Cancelar'}
            </Boton>
            <Boton
              variante={opciones.peligrosa ? 'peligro' : 'primario'}
              onClick={() => alResponder(true)}
            >
              {opciones.textoConfirmar ?? 'Confirmar'}
            </Boton>
          </div>
        </div>
      )}
    </dialog>
  )
}
