import { Copy, MessageCircle, Share2 } from 'lucide-react'
import { useAvisos } from './Avisos'
import { Boton } from './Boton'
import estilos from './MensajeCompartible.module.css'

// Un mensaje para WhatsApp: vista previa, copiar y compartir (con el menú del sistema si el navegador
// lo tiene; si no, con el enlace wa.me). Lo usan la convocatoria y las deudas de multas.
export function MensajeCompartible({
  texto,
  whatsapp,
  conAcciones = true,
}: {
  texto: string
  // Enlace wa.me con el texto
  whatsapp: string
  conAcciones?: boolean
}) {
  const { avisar } = useAvisos()

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
