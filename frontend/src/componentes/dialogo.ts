import { useEffect, useRef } from 'react'

// Abre y cierra un <dialog> nativo como modal según el estado. El navegador se encarga de atrapar el
// foco, devolverlo al cerrar, hacer inerte el resto de la página y cerrar con Escape.
export function useDialogoModal(abierto: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialogo = ref.current
    if (!dialogo) return
    if (abierto && !dialogo.open) dialogo.showModal()
    if (!abierto && dialogo.open) dialogo.close()
  }, [abierto])
  return ref
}
