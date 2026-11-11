import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { normalizar } from '../acta/leer.js'
import { capitalizar, enFrase, repararTildes, separarNombre } from './nombres.js'

// Lectura de la ficha del equipo en PDF que publica la Federación Gallega de Fútbol (GH-197). A la
// izquierda van los datos del club (nombre del equipo encima de «Club:», «Categoría:»); a la derecha,
// las licencias por secciones: «Jugadores (N)», «Técnicos (N)», «Delegados (N)» y «Auxiliares (N)».
// Cada persona ocupa una fila, «APELLIDOS, NOMBRE» y su licencia o función, que puede partirse en
// varias líneas. Los nombres llegan con las tildes mal codificadas (ver repararTildes).

export type PersonaFicha = {
  // Como sale en la ficha, con las tildes arregladas: «FERNÁNDEZ CASTRO, IVÁN»
  ficha: string
  nombre: string
  apellidos: string | null
  // Tipo de licencia del jugador o función del técnico: «Aficionado», «Entrenador titular»
  funcion: string | null
}

export type FichaEquipo = {
  equipo: string | null
  categoria: string | null
  jugadores: PersonaFicha[]
  cuerpoTecnico: PersonaFicha[]
}

export class FichaNoLegible extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'FichaNoLegible'
  }
}

type Texto = { pagina: number; x: number; y: number; ancho: number; texto: string }

async function extraer(pdf: Uint8Array): Promise<Texto[]> {
  if (!Buffer.from(pdf.subarray(0, 5)).toString('latin1').startsWith('%PDF-')) {
    throw new FichaNoLegible('El archivo no es un PDF')
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
    throw new FichaNoLegible('No se ha podido abrir el PDF')
  }
  try {
    const textos: Texto[] = []
    // Una plantilla larga puede seguir en otra página
    for (let n = 1; n <= Math.min(documento.numPages, 5); n++) {
      const pagina = await documento.getPage(n)
      const { items } = await pagina.getTextContent()
      for (const item of items) {
        if (!('str' in item) || !item.str.trim()) continue
        textos.push({
          pagina: n,
          x: item.transform[4],
          y: item.transform[5],
          ancho: item.width,
          texto: repararTildes(item.str.replace(/\s+/g, ' ').trim()),
        })
      }
    }
    return juntar(textos)
  } finally {
    await documento.destroy()
  }
}

// Una fila: los textos de la misma página a la misma altura, de izquierda a derecha. Las filas van
// de arriba abajo y de una página a la siguiente.
type Fila = { pagina: number; y: number; textos: Texto[] }
function filas(textos: Texto[]): Fila[] {
  const resultado: Fila[] = []
  for (const t of textos) {
    const fila = resultado.find((f) => f.pagina === t.pagina && Math.abs(f.y - t.y) <= 2.5)
    if (fila) fila.textos.push(t)
    else resultado.push({ pagina: t.pagina, y: t.y, textos: [t] })
  }
  for (const f of resultado) f.textos.sort((a, b) => a.x - b.x)
  return resultado.sort((a, b) => a.pagina - b.pagina || b.y - a.y)
}

// Algunos PDF traen cada palabra por separado: se juntan las que van seguidas en la misma línea
// (separadas como mucho por un espacio), para que «APELLIDOS, NOMBRE» o «Jugadores (24)» sean un texto
function juntar(textos: Texto[]): Texto[] {
  return filas(textos).flatMap((f) => {
    const resultado: Texto[] = []
    for (const t of f.textos) {
      const anterior = resultado.at(-1)
      if (anterior && t.x - (anterior.x + anterior.ancho) <= 4) {
        anterior.texto = `${anterior.texto} ${t.texto}`
        anterior.ancho = t.x + t.ancho - anterior.x
      } else resultado.push({ ...t })
    }
    return resultado
  })
}

const SECCION = /^(JUGADORES|TECNICOS|DELEGADOS|AUXILIARES)\s*\((\d+)\)$/
const CABECERAS = new Set(['LICENCIAS', 'TIPO LICENCIA'])
// Entre las líneas de una misma función (unos 10 puntos); entre dos personas hay más (13 o más)
const INTERLINEADO = 11.5

type Seccion = { tipo: string; total: number }
type Entrada = { pagina: number; y: number; ficha: string; funcion: Texto[] }

export function interpretar(textos: Texto[]): FichaEquipo {
  const secciones = textos.filter((t) => SECCION.test(normalizar(t.texto)))
  const jugadoresCabecera = secciones.find((t) => normalizar(t.texto).startsWith('JUGADORES'))
  if (!jugadoresCabecera) {
    throw new FichaNoLegible('No parece la ficha de un equipo de la Federación Gallega')
  }
  // La columna de las licencias y, dentro de ella, dónde empieza la licencia o la función
  const inicioLicencias = Math.min(...secciones.map((t) => t.x)) - 15
  const tipoLicencia = textos.find((t) => normalizar(t.texto) === 'TIPO LICENCIA')
  const inicioFuncion = (tipoLicencia?.x ?? jugadoresCabecera.x + 150) - 10

  // Licencias: cada fila con «APELLIDOS, NOMBRE» es una persona. La función va en un bloque de
  // líneas seguidas, centrado en la fila de su persona
  const porSeccion = new Map<Seccion, { personas: Entrada[]; lineas: Fila[] }>()
  let actual: { personas: Entrada[]; lineas: Fila[] } | null = null
  for (const f of filas(
    textos.filter((t) => t.x >= inicioLicencias && !CABECERAS.has(normalizar(t.texto))),
  )) {
    const cabecera = f.textos.map((t) => normalizar(t.texto).match(SECCION)).find((m) => m !== null)
    if (cabecera) {
      actual = { personas: [], lineas: [] }
      porSeccion.set({ tipo: cabecera[1] ?? '', total: Number(cabecera[2]) }, actual)
      continue
    }
    if (!actual) continue
    const ficha = f.textos
      .filter((t) => t.x < inicioFuncion)
      .map((t) => t.texto)
      .join(' ')
    if (ficha.includes(',')) actual.personas.push({ pagina: f.pagina, y: f.y, ficha, funcion: [] })
    const funcion = f.textos.filter((t) => t.x >= inicioFuncion)
    if (funcion.length > 0) actual.lineas.push({ ...f, textos: funcion })
  }
  for (const { personas, lineas } of porSeccion.values()) {
    const bloques: Fila[][] = []
    for (const linea of lineas) {
      const bloque = bloques.at(-1)
      const ultima = bloque?.at(-1)
      if (bloque && ultima?.pagina === linea.pagina && ultima.y - linea.y <= INTERLINEADO) {
        bloque.push(linea)
      } else bloques.push([linea])
    }
    for (const bloque of bloques) {
      const [primera] = bloque
      const ultima = bloque.at(-1)
      if (!primera || !ultima) continue
      const centro = (primera.y + ultima.y) / 2
      const persona = personas
        .filter((p) => p.pagina === primera.pagina)
        .sort((a, b) => Math.abs(a.y - centro) - Math.abs(b.y - centro))[0]
      persona?.funcion.push(...bloque.flatMap((l) => l.textos))
    }
  }

  const personas = (tipos: string[]) =>
    [...porSeccion]
      .filter(([s]) => tipos.includes(s.tipo))
      .flatMap(([, { personas: entradas }]) =>
        entradas.map((e): PersonaFicha => {
          const funcion = e.funcion.map((t) => t.texto).join(' ')
          return {
            ficha: e.ficha,
            ...separarNombre(e.ficha),
            funcion: funcion ? enFrase(funcion) : null,
          }
        }),
      )

  const jugadores = personas(['JUGADORES'])
  const esperados = [...porSeccion.keys()]
    .filter((s) => s.tipo === 'JUGADORES')
    .reduce((total, s) => Math.max(total, s.total), 0)
  if (jugadores.length !== esperados) {
    throw new FichaNoLegible(
      `Se han leído ${jugadores.length} de los ${esperados} jugadores de la ficha`,
    )
  }

  // Datos del club: el nombre del equipo va justo encima de «Club:»; si no, el del club
  const izquierda = filas(textos.filter((t) => t.x < inicioLicencias))
  const tras = (etiqueta: string) => {
    const fila = izquierda.find((f) => f.textos.some((t) => normalizar(t.texto) === etiqueta))
    const i = fila?.textos.findIndex((t) => normalizar(t.texto) === etiqueta) ?? -1
    const valor = fila?.textos
      .slice(i + 1)
      .map((t) => t.texto)
      .join(' ')
    return valor ? { fila, valor } : { fila, valor: null }
  }
  const club = tras('CLUB:')
  const encima = club.fila
    ? izquierda.filter(
        (f) => f.pagina === club.fila?.pagina && f.y > club.fila.y && f.y < club.fila.y + 40,
      )
    : []
  const equipo =
    encima
      .at(-1)
      ?.textos.map((t) => t.texto)
      .join(' ') ?? club.valor
  const categoria = tras('CATEGORIA:').valor

  return {
    equipo: equipo ? capitalizar(equipo, { abreviaturas: true }) : null,
    categoria: categoria ? capitalizar(categoria, { abreviaturas: true }) : null,
    jugadores,
    cuerpoTecnico: personas(['TECNICOS', 'DELEGADOS', 'AUXILIARES']),
  }
}

export const leerFichaEquipo = async (pdf: Uint8Array) => interpretar(await extraer(pdf))
