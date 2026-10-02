import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { useAvisos } from '../componentes/Avisos'

// Cuando hay una versión nueva de la aplicación no se recarga sola (podría pasar en mitad de pasar
// lista): se avisa y el usuario decide cuándo actualizar.
export function ActualizacionPwa() {
  const { avisar } = useAvisos()
  const {
    needRefresh: [hayVersionNueva],
    updateServiceWorker,
  } = useRegisterSW()

  useEffect(() => {
    if (!hayVersionNueva) return
    avisar({
      tipo: 'info',
      mensaje: 'Hay una versión nueva de Vestuario',
      accion: { texto: 'Actualizar', alPulsar: () => updateServiceWorker(true) },
      duracion: null,
    })
  }, [hayVersionNueva, avisar, updateServiceWorker])

  return null
}
