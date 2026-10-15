import { Copy, MessageCircle, Share2 } from 'lucide-react'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { useMensaje } from './datos'
import estilos from './Partidos.module.css'

// Mensaje de convocatoria para WhatsApp: vista previa, copiar y compartir (con el menú del sistema
// si el navegador lo tiene; si no, con el enlace wa.me)
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
  const { avisar } = useAvisos()

  if (mensaje.isPending) return <p className={estilos.secundario}>Preparando el mensaje…</p>
  if (mensaje.isError) {
    return (
      <p className={estilos.error} role="alert">
        {mensaje.error.message}
      </p>
    )
  }
  const { texto, whatsapp } = mensaje.data

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      avisar({ tipo: 'exito', mensaje: 'Mensaje copiado' })
    } catch {
      avisar({ tipo: 'error', mensaje: 'No se ha podido copiar: selecciona el texto y cópialo' })
    }
  }

  async function compartir() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: texto })
        return
      } catch (error) {
        // Cerrar el menú de compartir no es un error
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    window.open(whatsapp, '_blank', 'noopener')
  }

  return (
    <>
      <pre className={estilos.mensaje} data-testid="mensaje">
        {texto}
      </pre>
      {conAcciones && (
        <div className={estilos.acciones}>
          <Boton variante="secundario" icono={<Copy aria-hidden size={18} />} onClick={copiar}>
            Copiar
          </Boton>
          <Boton
            icono={
              typeof navigator.share === 'function' ? (
                <Share2 aria-hidden size={18} />
              ) : (
                <MessageCircle aria-hidden size={18} />
              )
            }
            onClick={compartir}
          >
            Compartir
          </Boton>
        </div>
      )}
    </>
  )
}
