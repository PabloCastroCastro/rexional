import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import busboy from 'busboy'
import { config } from '../config.js'
import { ErrorApi } from '../errores.js'
import { preparar, raiz } from './almacen.js'
import { BYTES_CABECERA, detectarTipo, esPdf, type TipoArchivo } from './tipos.js'

// Recibe una subida multipart en streaming: el archivo va directo a disco (tmp/), sin cargarlo
// entero en memoria. El tipo se decide con los primeros bytes y el límite depende de él (foto o
// vídeo). Devuelve la ruta temporal; quien la recibe la procesa o la borra.

export type Subida = {
  temporal: string
  tipo: TipoArchivo
  bytes: number
  // Como lo llamó el navegador; solo para mostrarlo, nunca para guardar en disco
  nombre: string
  campos: Record<string, string>
}

const MB = 1024 * 1024
const PDF: TipoArchivo = { tipo: 'pdf', mime: 'application/pdf', extension: 'pdf' }

const NOMBRES = { foto: 'La foto', video: 'El vídeo', pdf: 'El archivo' } as const

const demasiadoGrande = (tipo: TipoArchivo['tipo'], maximo: number) =>
  new ErrorApi(
    413,
    'archivo_demasiado_grande',
    `${NOMBRES[tipo]} no puede pasar de ${Math.round(maximo / MB)} MB`,
  )

// «medios»: fotos y vídeos de un ejercicio. «planificacion»: PDF o fotos de un partido (GH-147), con
// el límite de las fotos. «escudo»: el escudo del club (GH-28), solo PNG o WebP y con su límite
export type Admite = 'medios' | 'planificacion' | 'escudo'

const ESCUDO = ['image/png', 'image/webp']
const escudoGrande = (maximo: number) =>
  new ErrorApi(
    413,
    'archivo_demasiado_grande',
    `El escudo no puede pasar de ${Math.round(maximo / MB)} MB`,
  )

export async function recibirArchivo(
  peticion: Request,
  admite: Admite = 'medios',
): Promise<Subida> {
  await preparar()
  const { maxFotoBytes, maxVideoBytes, maxEscudoBytes } = config.subidas
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
      // Los nombres con tilde («Charla técnica.pdf») llegan en UTF-8
      defParamCharset: 'utf8',
      limits: {
        files: 1,
        fields: 10,
        fieldSize: 2000,
        fileSize:
          admite === 'medios'
            ? Math.max(maxFotoBytes, maxVideoBytes)
            : admite === 'escudo'
              ? maxEscudoBytes
              : maxFotoBytes,
      },
    })

    lector.on('field', (nombre, valor) => {
      campos[nombre] = valor
    })

    lector.on('file', (nombre, archivo, info) => {
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
          const detectado =
            admite === 'planificacion' && esPdf(cabecera) ? PDF : detectarTipo(cabecera)
          if (admite === 'escudo') {
            if (!detectado || detectado === 'heic' || !ESCUDO.includes(detectado.mime)) {
              return cortar(
                new ErrorApi(
                  415,
                  'tipo_no_admitido',
                  'El escudo tiene que ser una imagen PNG o WebP',
                ),
              )
            }
          } else if (detectado === 'heic') {
            return cortar(
              new ErrorApi(
                415,
                'tipo_no_admitido',
                'Las fotos HEIC no se admiten: en el iPhone, elige la foto desde el navegador (se convierte a JPEG) o expórtala como JPEG',
              ),
            )
          } else if (!detectado || (admite === 'planificacion' && detectado.tipo === 'video')) {
            return cortar(
              new ErrorApi(
                415,
                'tipo_no_admitido',
                admite === 'medios'
                  ? 'Solo se admiten fotos JPEG, PNG o WebP y vídeos MP4, MOV o WebM'
                  : 'Solo se admiten PDF o fotos JPEG, PNG o WebP',
              ),
            )
          }
          tipo = detectado
        }
        if (admite === 'escudo') {
          if (bytes > maxEscudoBytes) cortar(escudoGrande(maxEscudoBytes))
          return
        }
        const maximo = tipo.tipo === 'video' ? maxVideoBytes : maxFotoBytes
        if (bytes > maximo) cortar(demasiadoGrande(tipo.tipo, maximo))
      })
      archivo.on('limit', () =>
        cortar(
          admite === 'escudo'
            ? escudoGrande(maxEscudoBytes)
            : admite === 'medios'
              ? demasiadoGrande(tipo?.tipo ?? 'video', maxVideoBytes)
              : demasiadoGrande(tipo?.tipo ?? 'pdf', maxFotoBytes),
        ),
      )
      archivo.on('end', () => {
        if (!fallo && tipo) resultado = { temporal, tipo, bytes, nombre: info.filename ?? '' }
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
