import { createRequire } from 'node:module'
import { dirname, join, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import type { Content } from 'pdfmake'
import pdfmake from 'pdfmake'
import sharp from 'sharp'
import { db } from '../db/cliente.js'
import { clubes } from '../db/schema/index.js'
import { absoluta } from '../medios/almacen.js'

// Motor común de los PDF que genera la aplicación (GH-131): la sesión de entrenamiento y, más
// adelante, el informe de multas (GH-132) y la ficha del ejercicio (GH-137). Cada documento aporta
// su contenido; aquí van la fuente, la cabecera con el club y el pie. Los PDF se generan al pedirlos
// y no se guardan.

// Roboto, la fuente que trae pdfmake: tildes, «ñ», «€» y comillas sin depender del sistema
const carpetaFuentes = resolve(
  dirname(createRequire(import.meta.url).resolve('pdfmake/package.json')),
  'fonts',
  'Roboto',
)

pdfmake.setFonts({
  Roboto: {
    normal: join(carpetaFuentes, 'Roboto-Regular.ttf'),
    bold: join(carpetaFuentes, 'Roboto-Medium.ttf'),
    italics: join(carpetaFuentes, 'Roboto-Italic.ttf'),
    bolditalics: join(carpetaFuentes, 'Roboto-MediumItalic.ttf'),
  },
})
// Nada de descargar URLs ni leer archivos: las imágenes llegan ya leídas, como data URL, y solo se
// abren las fuentes
pdfmake.setUrlAccessPolicy(() => false)
pdfmake.setLocalAccessPolicy((ruta) => resolve(ruta).startsWith(carpetaFuentes + sep))

type Documento = Parameters<typeof pdfmake.createPdf>[0]

export type ClubPdf = { nombre: string; colorPrincipal: string; escudo: string | null }

// Lo que la cabecera necesita del club
export async function clubPdf(clubId: string): Promise<ClubPdf> {
  const [club] = await db
    .select({
      nombre: clubes.nombre,
      colorPrincipal: clubes.colorPrincipal,
      escudo: clubes.escudo,
    })
    .from(clubes)
    .where(eq(clubes.id, clubId))
  if (!club) throw new Error('El club no existe')
  return club
}

// Una imagen de la carpeta de subidas (webp) como PNG, que es lo que entiende pdfmake. Si falta o no
// se puede leer, el documento sale sin ella.
export async function imagenPng(relativa: string | null, ancho: number) {
  if (!relativa) return null
  try {
    const png = await sharp(absoluta(relativa))
      .resize({ width: ancho * 2, withoutEnlargement: true })
      .png()
      .toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

const GRIS = '#555555'

const fechaGeneracion = () =>
  new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Madrid',
  }).format(new Date())

export async function generarPdf(opciones: {
  club: ClubPdf
  // Encima del título, en pequeño: la plantilla y la temporada, por ejemplo
  antetitulo: string
  titulo: string
  contenido: Content[]
}): Promise<Buffer> {
  const { club, antetitulo, titulo, contenido } = opciones
  const escudo = await imagenPng(club.escudo, 40)
  const generado = fechaGeneracion()
  const documento: Documento = {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 50],
    info: { title: titulo, creator: 'Vestuario' },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    styles: {
      antetitulo: { fontSize: 9, color: GRIS },
      titulo: { fontSize: 18, bold: true },
      seccion: { fontSize: 12, bold: true, margin: [0, 12, 0, 4] },
      secundario: { color: GRIS },
    },
    content: [
      {
        columns: [
          ...(escudo ? [{ image: escudo, width: 40, margin: [0, 0, 10, 0] } as Content] : []),
          {
            width: '*',
            stack: [
              { text: club.nombre, bold: true, color: club.colorPrincipal, fontSize: 11 },
              { text: antetitulo, style: 'antetitulo' },
            ],
          },
        ],
      },
      // Filete con el color del club: en blanco y negro queda como una línea gris
      {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 2,
            lineColor: club.colorPrincipal,
          },
        ],
        margin: [0, 8, 0, 10],
      },
      { text: titulo, style: 'titulo' },
      ...contenido,
    ],
    footer: (pagina, paginas) => ({
      columns: [
        { text: `Generado el ${generado}`, style: 'secundario' },
        { text: `${pagina} / ${paginas}`, alignment: 'right', style: 'secundario' },
      ],
      fontSize: 8,
      margin: [40, 20, 40, 0],
    }),
  }
  return pdfmake.createPdf(documento).getBuffer()
}
