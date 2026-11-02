import { MensajeCompartible } from '../componentes/MensajeCompartible'
import { useMensaje } from './datos'
import estilos from './Partidos.module.css'

// Mensaje de convocatoria para WhatsApp: vista previa, copiar y compartir
export function Mensaje({
  plantillaId,
  partidoId,
  conAcciones,
}: {
  plantillaId: string
  partidoId: string
  conAcciones: boolean
}) {
  const mensaje = useMensaje(plantillaId, partidoId)

  if (mensaje.isPending) return <p className={estilos.secundario}>Preparando el mensaje…</p>
  if (mensaje.isError) {
    return (
      <p className={estilos.error} role="alert">
        {mensaje.error.message}
      </p>
    )
  }
  return <MensajeCompartible {...mensaje.data} conAcciones={conAcciones} />
}
