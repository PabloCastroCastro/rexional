import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { config } from '../config.js'

// Archivos de los medios en la carpeta de subidas (el volumen uploads). En la base de datos se
// guarda la ruta relativa; los nombres se generan, nunca se usa el nombre original:
//   ejercicios/<club>/<uuid>.webp|mp4|webm   fotos, vídeos y miniaturas
//   partidos/<plantilla>/<partido>/<uuid>.pdf|webp   planificación de un partido (GH-147)
//   clubes/<club>/<uuid>.webp                el escudo del club (GH-28)
//   pendientes/<uuid>.<ext>                  vídeos subidos que esperan su procesado
//   tmp/<uuid>                               subidas en curso

export const raiz = () => resolve(config.subidas.dir)

// Ruta absoluta de una relativa, sin salir nunca de la carpeta de subidas
export function absoluta(relativa: string) {
  const ruta = resolve(raiz(), relativa)
  if (ruta !== raiz() && !ruta.startsWith(raiz() + sep)) {
    throw new Error(`Ruta fuera de la carpeta de subidas: ${relativa}`)
  }
  return ruta
}

export const nueva = (carpeta: string, extension: string) =>
  `${carpeta}/${randomUUID()}.${extension}`

export const carpetaDeClub = (clubId: string) => `ejercicios/${clubId}`

export const carpetaDeEscudo = (clubId: string) => `clubes/${clubId}`

// Los archivos de un partido van en su carpeta: al borrar el partido o la plantilla se borra entera
export const carpetaDePlantilla = (plantillaId: string) => `partidos/${plantillaId}`
export const carpetaDePartido = (plantillaId: string, partidoId: string) =>
  `${carpetaDePlantilla(plantillaId)}/${partidoId}`

// Borra una carpeta entera; si no existe, no pasa nada
export const borrarCarpeta = (relativa: string) =>
  rm(absoluta(relativa), { recursive: true, force: true })

export async function preparar() {
  for (const carpeta of ['ejercicios', 'pendientes', 'tmp']) {
    await mkdir(join(raiz(), carpeta), { recursive: true })
  }
}

// Mueve un archivo (absoluto) a una ruta relativa de la carpeta de subidas
export async function mover(origen: string, destino: string) {
  await mkdir(absoluta(join(destino, '..')), { recursive: true })
  await rename(origen, absoluta(destino))
}

export async function borrar(...rutas: (string | null | undefined)[]) {
  for (const ruta of rutas) {
    if (!ruta) continue
    await unlink(absoluta(ruta)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

export const tamano = async (ruta: string) => (await stat(absoluta(ruta))).size

// Subidas a medias que quedaron de un reinicio: fuera las de más de un día
export async function limpiarTemporales() {
  const tmp = join(raiz(), 'tmp')
  const limite = Date.now() - 24 * 60 * 60 * 1000
  for (const nombre of await readdir(tmp).catch(() => [])) {
    const ruta = join(tmp, nombre)
    const info = await stat(ruta).catch(() => null)
    if (info && info.mtimeMs < limite) await unlink(ruta).catch(() => {})
  }
}

export const relativa = (absolutaRuta: string) =>
  relative(raiz(), absolutaRuta).split(sep).join('/')
