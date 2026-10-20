import { Share2 } from 'lucide-react'
import { useState } from 'react'
import { useAvisos } from './Avisos'
import { Boton } from './Boton'

// Pide un PDF a la API y lo comparte con el menú del sistema: en el móvil, con el archivo adjunto
// (WhatsApp, correo…). Si el navegador no comparte archivos, o no deja hacerlo tras la espera, se
// descarga.

function descargar(archivo: File) {
  const url = URL.createObjectURL(archivo)
  const enlace = document.createElement('a')
  enlace.href = url
  enlace.download = archivo.name
  document.body.append(enlace)
  enlace.click()
  enlace.remove()
  // Safari necesita la URL un momento después del clic
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function mensajeDeError(respuesta: Response) {
  try {
    const cuerpo = (await respuesta.json()) as { error?: { mensaje?: string } }
    if (cuerpo.error?.mensaje) return cuerpo.error.mensaje
  } catch {
    // Sin cuerpo JSON: mensaje genérico
  }
  return 'No se ha podido preparar el PDF. Inténtalo de nuevo.'
}

export function BotonCompartirPdf({
  url,
  nombre,
  titulo,
  disabled,
}: {
  // Ruta de la API que devuelve el PDF
  url: string
  // Nombre del archivo, con la extensión
  nombre: string
  // Título para el menú de compartir
  titulo: string
  disabled?: boolean
}) {
  const { avisar } = useAvisos()
  const [cargando, setCargando] = useState(false)

  async function compartir() {
    setCargando(true)
    try {
      const respuesta = await globalThis.fetch(url, { credentials: 'same-origin' })
      if (!respuesta.ok) {
        avisar({ tipo: 'error', mensaje: await mensajeDeError(respuesta) })
        return
      }
      const archivo = new File([await respuesta.blob()], nombre, { type: 'application/pdf' })
      if (navigator.canShare?.({ files: [archivo] })) {
        try {
          await navigator.share({ files: [archivo], title: titulo })
          return
        } catch (error) {
          // Cerrar el menú de compartir no es un error; si el navegador no lo deja, se descarga
          if (error instanceof DOMException && error.name === 'AbortError') return
        }
      }
      descargar(archivo)
    } catch {
      avisar({
        tipo: 'error',
        mensaje: 'No se ha podido conectar con el servidor. Inténtalo de nuevo.',
      })
    } finally {
      setCargando(false)
    }
  }

  return (
    <Boton
      variante="secundario"
      icono={<Share2 aria-hidden size={18} />}
      cargando={cargando}
      disabled={disabled}
      onClick={compartir}
    >
      Compartir PDF
    </Boton>
  )
}
