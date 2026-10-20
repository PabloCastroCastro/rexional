import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Content, TableCell } from 'pdfmake'
import { config } from '../config.js'
import { db } from '../db/cliente.js'
import { clubes, ejercicioMedios, ejercicios } from '../db/schema/index.js'
import type { leerPlan } from '../rutas/planes.js'
import { generarPdf, imagenPng } from './documento.js'

// PDF del plan de un entreno (GH-131), para imprimirlo o compartirlo: fecha y horas, objetivo, notas
// y los ejercicios en orden con lo que hay en la biblioteca (categoría, jugadores, material,
// descripción, fotos y enlaces), las indicaciones de la sesión y la duración.

const CATEGORIAS: Record<string, string> = {
  calentamiento: 'Calentamiento',
  tecnica: 'Técnica',
  tactica: 'Táctica',
  fisico: 'Físico',
  finalizacion: 'Finalización',
  porteros: 'Porteros',
  partido: 'Partido',
  vuelta_calma: 'Vuelta a la calma',
}

// Hasta 4 fotos por ejercicio, en una fila bajo su texto
const MAX_FOTOS = 4
const ANCHO_FOTO = 104
const COLOR_ENLACE = '#1a5fb4'

// «Martes, 21 de octubre de 2026»
const textoFecha = (fecha: string) => {
  const texto = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${fecha}T00:00:00Z`))
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

const textoHoras = (hora: string | null, horaFin: string | null) =>
  hora ? (horaFin ? `${hora} – ${horaFin}` : `A las ${hora}`) : 'Sin hora'

type Detalle = {
  descripcion: string | null
  jugadores: string | null
  material: string | null
  fotos: string[]
  enlaces: { url: string; pie: string | null }[]
  tieneVideo: boolean
}

// Lo que el plan no trae de cada ejercicio: sus datos de la biblioteca y sus medios listos, en orden
async function detallesEjercicios(ids: string[]) {
  const detalles = new Map<string, Detalle>()
  if (ids.length === 0) return detalles
  const [filas, medios] = await Promise.all([
    db
      .select({
        id: ejercicios.id,
        descripcion: ejercicios.descripcion,
        jugadores: ejercicios.jugadores,
        material: ejercicios.material,
      })
      .from(ejercicios)
      .where(inArray(ejercicios.id, ids)),
    db
      .select({
        ejercicioId: ejercicioMedios.ejercicioId,
        tipo: ejercicioMedios.tipo,
        archivo: ejercicioMedios.archivo,
        url: ejercicioMedios.url,
        pie: ejercicioMedios.pie,
      })
      .from(ejercicioMedios)
      .where(and(inArray(ejercicioMedios.ejercicioId, ids), eq(ejercicioMedios.estado, 'listo')))
      .orderBy(asc(ejercicioMedios.orden), asc(ejercicioMedios.createdAt)),
  ])
  for (const f of filas) detalles.set(f.id, { ...f, fotos: [], enlaces: [], tieneVideo: false })
  for (const m of medios) {
    const d = detalles.get(m.ejercicioId)
    if (!d) continue
    if (m.tipo === 'foto' && m.archivo && d.fotos.length < MAX_FOTOS) d.fotos.push(m.archivo)
    else if (m.tipo === 'enlace' && m.url) d.enlaces.push({ url: m.url, pie: m.pie })
    else if (m.tipo === 'video') d.tieneVideo = true
  }
  return detalles
}

const enlace = (texto: string, url: string): Content => ({
  text: texto,
  link: url,
  color: COLOR_ENLACE,
  decoration: 'underline',
})

export async function pdfPlan(
  plantilla: { id: string; clubId: string; nombre: string; temporada: string },
  plan: Awaited<ReturnType<typeof leerPlan>>,
) {
  const [club] = await db
    .select({
      nombre: clubes.nombre,
      colorPrincipal: clubes.colorPrincipal,
      escudo: clubes.escudo,
    })
    .from(clubes)
    .where(eq(clubes.id, plantilla.clubId))
  if (!club) throw new Error('El club de la plantilla no existe')

  const detalles = await detallesEjercicios([...new Set(plan.ejercicios.map((e) => e.ejercicioId))])
  // Las fotos se convierten una vez por ejercicio aunque se repita en el plan
  const fotos = new Map(
    await Promise.all(
      [...detalles].map(async ([id, d]) => {
        const leidas = await Promise.all(d.fotos.map((f) => imagenPng(f, ANCHO_FOTO)))
        return [id, leidas.filter((f): f is string => f !== null)] as const
      }),
    ),
  )

  const contenido: Content[] = [
    { text: textoFecha(plan.fecha), fontSize: 12, bold: true, margin: [0, 6, 0, 0] },
    { text: textoHoras(plan.hora, plan.horaFin), style: 'secundario' },
  ]
  if (plan.objetivo) contenido.push({ text: 'Objetivo', style: 'seccion' }, { text: plan.objetivo })
  if (plan.notas) contenido.push({ text: 'Notas', style: 'seccion' }, { text: plan.notas })

  contenido.push({ text: 'Ejercicios', style: 'seccion' })
  if (plan.ejercicios.length === 0) {
    contenido.push({ text: 'Este entreno aún no tiene ejercicios.', style: 'secundario' })
  } else {
    const sobra = plan.duracionPrevista !== null && plan.duracionTotal > plan.duracionPrevista
    contenido.push({
      text: [
        { text: `${plan.duracionTotal}' de ejercicios`, bold: true },
        plan.duracionPrevista !== null ? ` · el entreno dura ${plan.duracionPrevista}'` : '',
        sobra ? ` (sobran ${plan.duracionTotal - (plan.duracionPrevista ?? 0)}')` : '',
      ],
      margin: [0, 0, 0, 6],
    })
    const filas: TableCell[][] = plan.ejercicios.map((e, posicion) => {
      const d = detalles.get(e.ejercicioId)
      const fotosEjercicio = fotos.get(e.ejercicioId) ?? []
      const datos = [
        e.categoria && CATEGORIAS[e.categoria],
        d?.jugadores && `Jugadores: ${d.jugadores}`,
      ]
        .filter(Boolean)
        .join(' · ')
      const texto: Content[] = [{ text: e.nombre, bold: true }]
      if (datos) texto.push({ text: datos, style: 'secundario', fontSize: 9 })
      if (d?.material)
        texto.push({ text: `Material: ${d.material}`, style: 'secundario', fontSize: 9 })
      if (d?.descripcion) texto.push({ text: d.descripcion, margin: [0, 3, 0, 0] })
      if (e.indicaciones) {
        texto.push({
          text: [{ text: 'En esta sesión: ', bold: true }, e.indicaciones],
          margin: [0, 3, 0, 0],
        })
      }
      if (fotosEjercicio.length > 0) {
        texto.push({
          columns: fotosEjercicio.map((imagen) => ({
            image: imagen,
            fit: [ANCHO_FOTO, (ANCHO_FOTO * 3) / 4],
            width: ANCHO_FOTO,
          })),
          columnGap: 6,
          margin: [0, 6, 0, 0],
        })
      }
      for (const { url, pie } of d?.enlaces ?? []) {
        texto.push({
          text: [{ text: 'Vídeo: ' }, enlace(pie || url, url)],
          fontSize: 9,
          margin: [0, 3, 0, 0],
        })
      }
      if (d?.tieneVideo) {
        texto.push({
          text: [
            'Tiene vídeo: ',
            enlace(
              'verlo en la app',
              `${config.urlPublica}/plantillas/${plantilla.id}/entrenos/ejercicios/${e.ejercicioId}`,
            ),
          ],
          fontSize: 9,
          margin: [0, 3, 0, 0],
        })
      }
      return [
        { text: String(posicion + 1), bold: true },
        { stack: texto, margin: [0, 0, 0, 4] },
        { text: e.duracionMin ? `${e.duracionMin}'` : '', alignment: 'right', bold: true },
      ]
    })
    contenido.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [16, '*', 32],
        body: [
          [
            { text: '#', style: 'secundario' },
            { text: 'Ejercicio', style: 'secundario' },
            { text: 'Min.', style: 'secundario', alignment: 'right' },
          ],
          ...filas,
        ],
      },
      layout: 'lightHorizontalLines',
    })
  }

  const pdf = await generarPdf({
    club,
    antetitulo: `${plantilla.nombre} · Temporada ${plantilla.temporada}`,
    titulo: 'Sesión de entrenamiento',
    contenido,
  })
  return { pdf, nombre: `entreno-${plan.fecha}.pdf` }
}
