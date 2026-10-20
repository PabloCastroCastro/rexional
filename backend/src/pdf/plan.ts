import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Content, TableCell } from 'pdfmake'
import { db } from '../db/cliente.js'
import { clubes, ejercicioMedios, ejercicios } from '../db/schema/index.js'
import type { leerPlan } from '../rutas/planes.js'
import { generarPdf, imagenPng } from './documento.js'

// PDF del plan de un entreno (GH-131), para imprimirlo o compartirlo: fecha y horas, objetivo, notas
// y los ejercicios en orden con su miniatura, material, indicaciones y duración.

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

const ANCHO_MINIATURA = 64

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

// Material y miniatura (la del primer medio listo) de los ejercicios del plan
async function detallesEjercicios(ids: string[]) {
  if (ids.length === 0)
    return new Map<string, { material: string | null; miniatura: string | null }>()
  const [filas, medios] = await Promise.all([
    db
      .select({ id: ejercicios.id, material: ejercicios.material })
      .from(ejercicios)
      .where(inArray(ejercicios.id, ids)),
    db
      .select({ ejercicioId: ejercicioMedios.ejercicioId, miniatura: ejercicioMedios.miniatura })
      .from(ejercicioMedios)
      .where(
        and(
          inArray(ejercicioMedios.ejercicioId, ids),
          eq(ejercicioMedios.estado, 'listo'),
          isNotNull(ejercicioMedios.miniatura),
        ),
      )
      .orderBy(asc(ejercicioMedios.orden)),
  ])
  const miniaturas = new Map<string, string | null>()
  for (const m of medios)
    if (!miniaturas.has(m.ejercicioId)) miniaturas.set(m.ejercicioId, m.miniatura)
  return new Map(
    filas.map((f) => [f.id, { material: f.material, miniatura: miniaturas.get(f.id) ?? null }]),
  )
}

export async function pdfPlan(
  plantilla: { clubId: string; nombre: string; temporada: string },
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
  // Una vez por ejercicio aunque se repita en el plan
  const imagenes = new Map(
    await Promise.all(
      [...detalles].map(
        async ([id, d]) => [id, await imagenPng(d.miniatura, ANCHO_MINIATURA)] as const,
      ),
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
      const imagen = imagenes.get(e.ejercicioId)
      const datos = [
        e.categoria && CATEGORIAS[e.categoria],
        d?.material && `Material: ${d.material}`,
      ]
        .filter(Boolean)
        .join(' · ')
      return [
        { text: String(posicion + 1), bold: true },
        imagen ? { image: imagen, fit: [ANCHO_MINIATURA, 48] } : { text: '' },
        {
          stack: [
            { text: e.nombre, bold: true },
            ...(datos ? [{ text: datos, style: 'secundario', fontSize: 9 }] : []),
            ...(e.indicaciones ? [{ text: e.indicaciones, margin: [0, 2, 0, 0] }] : []),
          ] as Content[],
        },
        { text: e.duracionMin ? `${e.duracionMin}'` : '', alignment: 'right', bold: true },
      ]
    })
    contenido.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [16, ANCHO_MINIATURA, '*', 32],
        body: [
          [
            { text: '#', style: 'secundario' },
            { text: '' },
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
