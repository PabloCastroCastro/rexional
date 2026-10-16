// Tipo real de un archivo subido, por sus primeros bytes (nunca por el nombre ni por lo que dice el
// navegador). Solo se admiten las fotos y los vídeos que la aplicación sabe mostrar.

export type TipoArchivo = {
  tipo: 'foto' | 'video'
  mime: string
  extension: string
}

const empieza = (b: Buffer, firma: number[], desde = 0) =>
  b.length >= desde + firma.length && firma.every((byte, i) => b[desde + i] === byte)

const ascii = (b: Buffer, desde: number, hasta: number) =>
  b.subarray(desde, hasta).toString('latin1')

// Bytes necesarios para decidir
export const BYTES_CABECERA = 16

// 'heic' si es una foto HEIC/HEIF (no se puede procesar); null si no es un tipo admitido
export function detectarTipo(b: Buffer): TipoArchivo | 'heic' | null {
  if (empieza(b, [0xff, 0xd8, 0xff])) return { tipo: 'foto', mime: 'image/jpeg', extension: 'jpg' }
  if (empieza(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { tipo: 'foto', mime: 'image/png', extension: 'png' }
  }
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') {
    return { tipo: 'foto', mime: 'image/webp', extension: 'webp' }
  }
  if (empieza(b, [0x1a, 0x45, 0xdf, 0xa3]))
    return { tipo: 'video', mime: 'video/webm', extension: 'webm' }
  // ISO Base Media (MP4, MOV, HEIC): "ftyp" y la marca principal
  if (ascii(b, 4, 8) === 'ftyp') {
    const marca = ascii(b, 8, 12)
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(marca))
      return 'heic'
    if (['avif', 'avis'].includes(marca)) return null
    if (marca === 'qt  ') return { tipo: 'video', mime: 'video/quicktime', extension: 'mov' }
    return { tipo: 'video', mime: 'video/mp4', extension: 'mp4' }
  }
  return null
}
