import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { detectarTipo } from '../src/medios/tipos.js'

// El tipo de un archivo sale de sus primeros bytes, no del nombre

const fixture = (nombre: string) => readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url))
const ftyp = (marca: string) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from(`ftyp${marca}`, 'latin1'),
    Buffer.alloc(8),
  ])

describe('tipo de archivo', () => {
  it.each([
    ['foto-gps.jpg', 'foto', 'image/jpeg'],
    ['video-h264.mp4', 'video', 'video/mp4'],
    ['video-hevc.mov', 'video', 'video/quicktime'],
    ['video.webm', 'video', 'video/webm'],
  ])('%s es %s (%s)', (nombre, tipo, mime) => {
    expect(detectarTipo(fixture(nombre).subarray(0, 16))).toMatchObject({ tipo, mime })
  })

  it('reconoce PNG y WebP', () => {
    expect(
      detectarTipo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toMatchObject({
      mime: 'image/png',
    })
    expect(detectarTipo(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1'))).toMatchObject({
      mime: 'image/webp',
    })
  })

  it('distingue HEIC y rechaza lo demás', () => {
    expect(detectarTipo(ftyp('heic'))).toBe('heic')
    expect(detectarTipo(ftyp('mif1'))).toBe('heic')
    expect(detectarTipo(ftyp('avif'))).toBeNull()
    expect(detectarTipo(fixture('ficha-partido.pdf').subarray(0, 16))).toBeNull()
    expect(detectarTipo(Buffer.from('hola, esto no es una foto'))).toBeNull()
  })
})
