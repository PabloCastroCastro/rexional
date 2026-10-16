import { spawn } from 'node:child_process'
import { unlink } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../db/cliente.js'
import { ejercicioMedios, ejercicios } from '../db/schema/index.js'
import { ErrorApi } from '../errores.js'
import { logger } from '../logger.js'
import { absoluta, borrar, carpetaDeClub, mover, nueva, tamano } from './almacen.js'

// Procesado de los medios. Las fotos, al subirlas: se giran según su EXIF, se reducen a 1920 px, se
// guardan en WebP sin metadatos (ni ubicación) y con miniatura. Los vídeos, en segundo plano y de uno
// en uno (la Raspberry no da para más): los MP4 H.264 y los WebM se guardan tal cual, un MOV con
// H.264 se pasa a MP4 sin recodificar, y el resto (HEVC del iPhone) se recodifica a MP4 H.264.
// Todos llevan miniatura y duración.

const LADO_FOTO = 1920
const LADO_MINIATURA = 480

const miniaturaDe = (entrada: string | Buffer, salida: string) =>
  sharp(entrada)
    .rotate()
    .resize({
      width: LADO_MINIATURA,
      height: LADO_MINIATURA,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 70 })
    .toFile(absoluta(salida))

export async function procesarFoto(temporal: string, clubId: string) {
  const carpeta = carpetaDeClub(clubId)
  const archivo = nueva(carpeta, 'webp')
  const miniatura = nueva(carpeta, 'webp')
  try {
    await mover(temporal, `${archivo}.original`)
    const original = absoluta(`${archivo}.original`)
    // sharp no copia los metadatos (EXIF, ubicación…) salvo que se le pida
    await sharp(original)
      .rotate()
      .resize({ width: LADO_FOTO, height: LADO_FOTO, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(absoluta(archivo))
    await miniaturaDe(original, miniatura)
    await borrar(`${archivo}.original`)
    return { archivo, miniatura, mime: 'image/webp', tamanoBytes: await tamano(archivo) }
  } catch (error) {
    await borrar(`${archivo}.original`, archivo, miniatura)
    await unlink(temporal).catch(() => {})
    if (
      error instanceof Error &&
      /unsupported image format|Input file contains/i.test(error.message)
    ) {
      throw new ErrorApi(415, 'tipo_no_admitido', 'La foto está dañada o no se puede leer')
    }
    throw error
  }
}

function ejecutar(programa: string, argumentos: string[]) {
  return new Promise<string>((resolver, rechazar) => {
    const proceso = spawn(programa, argumentos, { stdio: ['ignore', 'pipe', 'pipe'] })
    let salida = ''
    let errores = ''
    proceso.stdout.on('data', (d) => {
      salida += d
    })
    proceso.stderr.on('data', (d) => {
      errores += d
    })
    proceso.on('error', rechazar)
    proceso.on('close', (codigo) =>
      codigo === 0
        ? resolver(salida)
        : rechazar(new Error(`${programa} terminó con ${codigo}: ${errores.slice(-500)}`)),
    )
  })
}

type Sonda = { formato: string; video: string | null; duracion: number | null }

async function sondear(ruta: string): Promise<Sonda> {
  const json = JSON.parse(
    await ejecutar('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=format_name,duration:stream=codec_type,codec_name',
      '-of',
      'json',
      ruta,
    ]),
  ) as {
    format?: { format_name?: string; duration?: string }
    streams?: { codec_type?: string; codec_name?: string }[]
  }
  const duracion = Number(json.format?.duration)
  return {
    formato: json.format?.format_name ?? '',
    video: json.streams?.find((s) => s.codec_type === 'video')?.codec_name ?? null,
    duracion: Number.isFinite(duracion) ? duracion : null,
  }
}

export const ffmpegDisponible = () =>
  ejecutar('ffmpeg', ['-version']).then(
    () => true,
    () => false,
  )

// Procesa un vídeo pendiente (estado «procesando», con el original en pendientes/)
export async function procesarVideo(medioId: string) {
  const [medio] = await db
    .select({ archivo: ejercicioMedios.archivo, clubId: ejercicios.clubId })
    .from(ejercicioMedios)
    .innerJoin(ejercicios, eq(ejercicios.id, ejercicioMedios.ejercicioId))
    .where(eq(ejercicioMedios.id, medioId))
  if (!medio?.archivo) return // borrado mientras esperaba
  const pendiente = medio.archivo
  const carpeta = carpetaDeClub(medio.clubId)
  let archivo: string | null = null
  const miniatura = nueva(carpeta, 'webp')
  try {
    const sonda = await sondear(absoluta(pendiente))
    if (!sonda.video) throw new Error('El archivo no tiene vídeo')
    const webm = sonda.formato.includes('webm') || sonda.formato.includes('matroska')
    const mp4 = sonda.formato.includes('mp4') && pendiente.endsWith('.mp4')
    if (webm && ['vp8', 'vp9', 'av1'].includes(sonda.video)) {
      archivo = nueva(carpeta, 'webm')
      await mover(absoluta(pendiente), archivo)
    } else if (sonda.video === 'h264' && mp4) {
      archivo = nueva(carpeta, 'mp4')
      await mover(absoluta(pendiente), archivo)
    } else {
      archivo = nueva(carpeta, 'mp4')
      // H.264 en MOV: solo cambia el contenedor. Lo demás se recodifica (máximo 1280 px de ancho).
      const video =
        sonda.video === 'h264'
          ? ['-c:v', 'copy']
          : [
              '-c:v',
              'libx264',
              '-preset',
              'veryfast',
              '-crf',
              '26',
              '-pix_fmt',
              'yuv420p',
              '-vf',
              "scale='min(1280,iw)':-2",
              '-threads',
              '2',
            ]
      await ejecutar('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        absoluta(pendiente),
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        ...video,
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        absoluta(archivo),
      ])
      await borrar(pendiente)
    }
    // Miniatura: un fotograma del primer segundo (o del medio, si es más corto)
    const segundo = Math.min(1, (sonda.duracion ?? 0) / 2)
    const fotograma = await new Promise<Buffer>((resolver, rechazar) => {
      const proceso = spawn('ffmpeg', [
        '-v',
        'error',
        '-ss',
        String(segundo),
        '-i',
        absoluta(archivo as string),
        '-frames:v',
        '1',
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        '-',
      ])
      const trozos: Buffer[] = []
      proceso.stdout.on('data', (d: Buffer) => trozos.push(d))
      proceso.on('error', rechazar)
      proceso.on('close', (codigo) =>
        codigo === 0 && trozos.length
          ? resolver(Buffer.concat(trozos))
          : rechazar(new Error('Sin fotograma')),
      )
    })
    await miniaturaDe(fotograma, miniatura)

    const actualizados = await db
      .update(ejercicioMedios)
      .set({
        estado: 'listo',
        archivo,
        miniatura,
        mime: archivo.endsWith('.webm') ? 'video/webm' : 'video/mp4',
        tamanoBytes: await tamano(archivo),
        duracionSeg: sonda.duracion === null ? null : Math.round(sonda.duracion),
      })
      .where(eq(ejercicioMedios.id, medioId))
      .returning({ id: ejercicioMedios.id })
    // Borrado mientras se procesaba: fuera también lo generado
    if (actualizados.length === 0) await borrar(archivo, miniatura)
  } catch (error) {
    logger.error({ err: error, medioId }, 'No se ha podido procesar el vídeo')
    await borrar(pendiente, archivo, miniatura)
    await db.update(ejercicioMedios).set({ estado: 'error' }).where(eq(ejercicioMedios.id, medioId))
  }
}
