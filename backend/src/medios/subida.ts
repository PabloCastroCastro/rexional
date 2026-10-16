import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import busboy from 'busboy'
import { config } from '../config.js'
import { ErrorApi } from '../errores.js'
import { preparar, raiz } from './almacen.js'
import { BYTES_CABECERA, detectarTipo, type TipoArchivo } from './tipos.js'

// Recibe una subida multipart en streaming: el archivo va directo a disco (tmp/), sin cargarlo
// entero en memoria. El tipo se decide con los primeros bytes y el límite depende de él (foto o
// vídeo). Devuelve la ruta temporal; quien la recibe la procesa o la borra.

export type Subida = {
  temporal: string
  tipo: TipoArchivo
  bytes: number
  campos: Record<string, string>
}

const MB = 1024 * 1024
const demasiadoGrande = (tipo: 'foto' | 'video', maximo: number) =>
  new ErrorApi(
    413,
    'archivo_demasiado_grande',
    `${tipo === 'foto' ? 'La foto' : 'El vídeo'} no puede pasar de ${Math.round(maximo / MB)} MB`,
  )

export async function recibirArchivo(peticion: Request): Promise<Subida> {
  await preparar()
  const { maxFotoBytes, maxVideoBytes } = config.subidas
  const tipoContenido = peticion.headers.get('content-type') ?? ''
  if (!tipoContenido.startsWith('multipart/form-data') || !peticion.body) {
    throw new ErrorApi(
      400,
      'validacion',
      'Envía el archivo en un formulario, en el campo «archivo»',
    )
  }

  return new Promise((resolver, rechazar) => {
    const temporal = join(raiz(), 'tmp', randomUUID())
    const campos: Record<string, string> = {}
    let resultado: Omit<Subida, 'campos'> | null = null
    let fallo: Error | null = null
    let escritura: Promise<void> | null = null

    const lector = busboy({
      headers: { 'content-type': tipoContenido },
      limits: {
        files: 1,
        fields: 10,
        fieldSize: 2000,
        fileSize: Math.max(maxFotoBytes, maxVideoBytes),
      },
    })

    lector.on('field', (nombre, valor) => {
      campos[nombre] = valor
    })

    lector.on('file', (nombre, archivo) => {
      if (nombre !== 'archivo') {
        archivo.resume()
        return
      }
      const destino = createWriteStream(temporal)
      let cabecera = Buffer.alloc(0)
      let tipo: TipoArchivo | null = null
      let bytes = 0
      const cortar = (error: Error) => {
        fallo ??= error
        archivo.unpipe(destino)
        archivo.resume()
        destino.destroy()
      }
      escritura = new Promise((fin) => {
        destino.on('close', () => fin())
        destino.on('error', (error) => {
          fallo ??= error
          fin()
        })
      })

      archivo.on('data', (trozo: Buffer) => {
        if (fallo) return
        bytes += trozo.length
        if (!tipo) {
          cabecera = Buffer.concat([cabecera, trozo]).subarray(0, BYTES_CABECERA)
          if (cabecera.length < BYTES_CABECERA && bytes < BYTES_CABECERA) return
          const detectado = detectarTipo(cabecera)
          if (detectado === 'heic') {
            return cortar(
              new ErrorApi(
                415,
                'tipo_no_admitido',
                'Las fotos HEIC no se admiten: en el iPhone, elige la foto desde el navegador (se convierte a JPEG) o expórtala como JPEG',
              ),
            )
          }
          if (!detectado) {
            return cortar(
              new ErrorApi(
                415,
                'tipo_no_admitido',
                'Solo se admiten fotos JPEG, PNG o WebP y vídeos MP4, MOV o WebM',
              ),
            )
          }
          tipo = detectado
        }
        const maximo = tipo.tipo === 'foto' ? maxFotoBytes : maxVideoBytes
        if (bytes > maximo) cortar(demasiadoGrande(tipo.tipo, maximo))
      })
      archivo.on('limit', () => cortar(demasiadoGrande(tipo?.tipo ?? 'video', maxVideoBytes)))
      archivo.on('end', () => {
        if (!fallo && tipo) resultado = { temporal, tipo, bytes }
        if (!fallo && !tipo) {
          fallo = new ErrorApi(415, 'tipo_no_admitido', 'El archivo está vacío o no se reconoce')
        }
      })
      archivo.pipe(destino)
    })

    lector.on('error', (error) => {
      fallo ??= error instanceof Error ? error : new Error(String(error))
    })

    lector.on('close', async () => {
      await escritura
      if (fallo || !resultado) {
        await unlink(temporal).catch(() => {})
        rechazar(
          fallo ??
            new ErrorApi(400, 'validacion', 'Falta el archivo: envíalo en el campo «archivo»'),
        )
        return
      }
      resolver({ ...resultado, campos })
    })

    Readable.fromWeb(peticion.body as import('node:stream/web').ReadableStream).pipe(lector)
  })
}
