import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { normalizar } from '../acta/leer.js'

// Lectura del calendario de la competición en PDF que publica la Federación Gallega de Fútbol (GH-127).
// Cada página de jornadas tiene dos columnas, la primera vuelta a la izquierda y la segunda a la
// derecha. Cada jornada empieza con «Jornada N (dd-mm-aaaa)» y sigue con sus enfrentamientos en una
// línea cada uno: el local alineado a la derecha, un guion y el visitante. «Descansa» ocupa el sitio
// del rival del equipo que no juega. Las páginas con los datos de los equipos no llevan guiones
// entre equipos y se ignoran.

export type Enfrentamiento = { local: string; visitante: string }
export type Jornada = {
  numero: number
  fecha: string
  enfrentamientos: Enfrentamiento[]
  descansa: string | null
}
export type Calendario = {
  competicion: string | null
  temporada: string | null
  equipos: string[]
  jornadas: Jornada[]
}

export class CalendarioNoLegible extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'CalendarioNoLegible'
  }
}

type Texto = { pagina: number; x: number; y: number; texto: string }

const JORNADA = /^Jornada\s+(\d+)\s*\((\d{2})-(\d{2})-(\d{4})\)$/i
const DESCANSA = 'DESCANSA'
// Misma línea: los textos de un enfrentamiento comparten la y (con tolerancia)
const MISMA_LINEA = 2

async function extraer(pdf: Uint8Array): Promise<{ textos: Texto[]; ancho: number }> {
  if (!Buffer.from(pdf.subarray(0, 5)).toString('latin1').startsWith('%PDF-')) {
    throw new CalendarioNoLegible('El archivo no es un PDF')
  }
  let documento: Awaited<ReturnType<typeof getDocument>['promise']>
  try {
    // pdf.js se queda el búfer: se le pasa una copia
    documento = await getDocument({
      data: new Uint8Array(pdf),
      verbosity: 0,
      isEvalSupported: false,
      useSystemFonts: false,
      disableFontFace: true,
    }).promise
  } catch {
    throw new CalendarioNoLegible('No se ha podido abrir el PDF')
  }
  try {
    const textos: Texto[] = []
    let ancho = 0
    for (let n = 1; n <= Math.min(documento.numPages, 40); n++) {
      const pagina = await documento.getPage(n)
      ancho = Math.max(ancho, pagina.view[2] ?? 0)
      const { items } = await pagina.getTextContent()
      for (const item of items) {
        if (!('str' in item) || !item.str.trim()) continue
        textos.push({
          pagina: n,
          x: item.transform[4],
          y: item.transform[5],
          texto: item.str.replace(/\s+/g, ' ').trim(),
        })
      }
    }
    return { textos, ancho }
  } finally {
    await documento.destroy()
  }
}

export async function leerCalendario(pdf: Uint8Array): Promise<Calendario> {
  const { textos, ancho } = await extraer(pdf)
  const mitad = ancho / 2
  const columna = (t: Texto) => (t.x < mitad ? 0 : 1)

  // Cabeceras de las jornadas, por página y columna
  const cabeceras = textos.flatMap((t) => {
    const m = JORNADA.exec(t.texto)
    if (!m) return []
    const [, numero, dia, mes, anio] = m
    return [{ ...t, numero: Number(numero), fecha: `${anio}-${mes}-${dia}` }]
  })
  if (cabeceras.length === 0) {
    throw new CalendarioNoLegible('No parece un calendario de la federación: no tiene jornadas')
  }

  // Cada guion con texto a los dos lados en la misma línea es un enfrentamiento
  const jornadas = new Map<number, Jornada>()
  for (const c of cabeceras) {
    if (!jornadas.has(c.numero)) {
      jornadas.set(c.numero, {
        numero: c.numero,
        fecha: c.fecha,
        enfrentamientos: [],
        descansa: null,
      })
    }
  }
  for (const guion of textos.filter((t) => t.texto === '-')) {
    const enLinea = textos.filter(
      (t) =>
        t !== guion &&
        t.pagina === guion.pagina &&
        columna(t) === columna(guion) &&
        Math.abs(t.y - guion.y) <= MISMA_LINEA,
    )
    const local = enLinea.filter((t) => t.x < guion.x).sort((a, b) => b.x - a.x)[0]
    const visitante = enLinea.filter((t) => t.x > guion.x).sort((a, b) => a.x - b.x)[0]
    if (!local || !visitante) continue
    // La jornada es la última cabecera por encima en la misma columna (de esta página o de antes)
    const cabecera = cabeceras
      .filter(
        (c) =>
          columna(c) === columna(guion) &&
          (c.pagina < guion.pagina || (c.pagina === guion.pagina && c.y > guion.y)),
      )
      .sort((a, b) => b.pagina - a.pagina || a.y - b.y)[0]
    const jornada = cabecera && jornadas.get(cabecera.numero)
    if (!jornada) continue
    const [l, v] = [local.texto, visitante.texto]
    if (normalizar(l) === DESCANSA) jornada.descansa = v
    else if (normalizar(v) === DESCANSA) jornada.descansa = l
    else jornada.enfrentamientos.push({ local: l, visitante: v })
  }

  const ordenadas = [...jornadas.values()]
    .filter((j) => j.enfrentamientos.length > 0 || j.descansa)
    .sort((a, b) => a.numero - b.numero)
  if (ordenadas.length === 0) {
    throw new CalendarioNoLegible('No se han encontrado enfrentamientos en el calendario')
  }
  const equipos = new Set<string>()
  for (const j of ordenadas) {
    for (const e of j.enfrentamientos) equipos.add(e.local).add(e.visitante)
    if (j.descansa) equipos.add(j.descansa)
  }

  // La cabecera de la primera página: «Calendario de Competiciones», la competición y la temporada
  const primera = textos.filter((t) => t.pagina === 1)
  const temporada = primera
    .map((t) => /Temporada\s+(\d{4}-\d{4})/i.exec(t.texto)?.[1])
    .find(Boolean)
  const titulo = primera.find((t) => /^Calendario de Competiciones$/i.test(t.texto))
  const competicion = titulo
    ? primera
        .filter((t) => t.y < titulo.y && titulo.y - t.y < 40 && !/^Temporada/i.test(t.texto))
        .sort((a, b) => b.y - a.y || a.x - b.x)[0]?.texto
    : undefined

  return {
    competicion: competicion ?? null,
    temporada: temporada ?? null,
    equipos: [...equipos].sort((a, b) => a.localeCompare(b, 'es')),
    jornadas: ordenadas,
  }
}
