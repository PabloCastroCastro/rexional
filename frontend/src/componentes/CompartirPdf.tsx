import { Download, Share2 } from 'lucide-react'
import { useState } from 'react'
import { useAvisos } from './Avisos'
import { Boton } from './Boton'

// Botones para un PDF que genera la API: «Compartir PDF» abre el menú del sistema con el archivo
// adjunto (WhatsApp, correo…) y «Descargar PDF» lo guarda. Compartir solo aparece si el navegador
// comparte archivos (en el móvil sí; en el ordenador, casi nunca). También sirven para un Excel
// (GH-170).

const FORMATOS = {
  pdf: { tipo: 'application/pdf', texto: 'PDF', extension: 'pdf' },
  excel: {
    tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    texto: 'Excel',
    extension: 'xlsx',
  },
}

type Formato = keyof typeof FORMATOS

const puedeCompartirArchivos = (formato: Formato) =>
  navigator.canShare?.({
    files: [
      new File([''], `prueba.${FORMATOS[formato].extension}`, { type: FORMATOS[formato].tipo }),
    ],
  }) ?? false

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

async function mensajeDeError(respuesta: Response, formato: Formato) {
  try {
    const cuerpo = (await respuesta.json()) as { error?: { mensaje?: string } }
    if (cuerpo.error?.mensaje) return cuerpo.error.mensaje
  } catch {
    // Sin cuerpo JSON: mensaje genérico
  }
  return `No se ha podido preparar el ${FORMATOS[formato].texto}. Inténtalo de nuevo.`
}

export function BotonesPdf({
  url,
  nombre,
  titulo,
  disabled,
  formato = 'pdf',
}: {
  // Ruta de la API que devuelve el archivo
  url: string
  // Nombre del archivo, con la extensión
  nombre: string
  // Título para el menú de compartir
  titulo: string
  disabled?: boolean
  formato?: Formato
}) {
  const { avisar } = useAvisos()
  const [enCurso, setEnCurso] = useState<'compartir' | 'descargar' | null>(null)
  const [compartible] = useState(() => puedeCompartirArchivos(formato))
  const { tipo, texto } = FORMATOS[formato]

  // Pide el archivo; null si falla (ya avisado)
  async function pedirArchivo() {
    try {
      const respuesta = await globalThis.fetch(url, { credentials: 'same-origin' })
      if (!respuesta.ok) {
        avisar({ tipo: 'error', mensaje: await mensajeDeError(respuesta, formato) })
        return null
      }
      return new File([await respuesta.blob()], nombre, { type: tipo })
    } catch {
      avisar({
        tipo: 'error',
        mensaje: 'No se ha podido conectar con el servidor. Inténtalo de nuevo.',
      })
      return null
    }
  }

  async function accion(cual: 'compartir' | 'descargar') {
    setEnCurso(cual)
    try {
      const archivo = await pedirArchivo()
      if (!archivo) return
      if (cual === 'compartir') {
        try {
          await navigator.share({ files: [archivo], title: titulo })
          return
        } catch (error) {
          // Cerrar el menú de compartir no es un error; si el navegador no lo deja tras la espera,
          // se descarga
          if (error instanceof DOMException && error.name === 'AbortError') return
        }
      }
      descargar(archivo)
    } finally {
      setEnCurso(null)
    }
  }

  return (
    <>
      {compartible && (
        <Boton
          variante="secundario"
          icono={<Share2 aria-hidden size={18} />}
          cargando={enCurso === 'compartir'}
          disabled={disabled || enCurso !== null}
          onClick={() => accion('compartir')}
        >
          Compartir {texto}
        </Boton>
      )}
      <Boton
        variante="secundario"
        icono={<Download aria-hidden size={18} />}
        cargando={enCurso === 'descargar'}
        disabled={disabled || enCurso !== null}
        onClick={() => accion('descargar')}
      >
        Descargar {texto}
      </Boton>
    </>
  )
}
