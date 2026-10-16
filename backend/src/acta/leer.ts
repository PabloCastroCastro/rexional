import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Lectura de la ficha del partido en PDF que publica la Federación Gallega de Fútbol. La ficha tiene
// tres columnas: el equipo local a la izquierda, el centro (resultado, árbitro, goles y estadio) y el
// visitante a la derecha. Cada equipo lleva titulares, suplentes, cuerpo técnico, sustituciones y
// tarjetas. Los textos se agrupan por su posición en la página; los iconos dicen lo que el texto no
// dice: en las sustituciones, la flecha azul es quien entra y la roja quien sale, y en las tarjetas
// el color distingue la amarilla de la roja.

export type Texto = { x: number; y: number; texto: string }
// Posición del centro del icono y su color medio
export type Icono = { x: number; y: number; color: [number, number, number] }
export type Elementos = { textos: Texto[]; iconos: Icono[] }

// Una persona tal como sale en la ficha: "APELLIDOS, NOMBRE"
export type PersonaActa = { dorsal: number | null; nombre: string }
export type Tarjeta = 'amarilla' | 'roja'

export type EquipoActa = {
  nombre: string
  titulares: PersonaActa[]
  suplentes: PersonaActa[]
  cambios: { entra: PersonaActa; sale: PersonaActa; minuto: number | null }[]
  // Tipo null si no se ha podido leer el color del icono
  tarjetas: { nombre: string; minuto: number | null; tipo: Tarjeta | null }[]
}

export type FichaActa = {
  competicion: string | null
  jornada: number | null
  fecha: string | null
  hora: string | null
  estadio: string | null
  ciudad: string | null
  local: EquipoActa
  visitante: EquipoActa
  golesLocal: number
  golesVisitante: number
  goles: { equipo: 'local' | 'visitante'; nombre: string; minuto: number | null }[]
}

export class ActaNoLegible extends Error {
  constructor(motivo: string) {
    super(motivo)
    this.name = 'ActaNoLegible'
  }
}

// Mayúsculas y sin tildes, para comparar textos
export const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()

type Matriz = [number, number, number, number, number, number]
const multiplicar = (m: Matriz, n: Matriz): Matriz => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

// Textos e iconos de la primera página del PDF
export async function extraer(pdf: Uint8Array): Promise<Elementos> {
  if (!Buffer.from(pdf.subarray(0, 5)).toString('latin1').startsWith('%PDF-')) {
    throw new ActaNoLegible('El archivo no es un PDF')
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
    throw new ActaNoLegible('No se ha podido abrir el PDF')
  }
  try {
    const pagina = await documento.getPage(1)
    const { items } = await pagina.getTextContent()
    const textos: Texto[] = []
    for (const item of items) {
      if (!('str' in item) || !item.str.trim()) continue
      textos.push({ x: item.transform[4], y: item.transform[5], texto: item.str.trim() })
    }

    // Los iconos son imágenes pequeñas: su posición sale de la matriz de transformación activa
    const operaciones = await pagina.getOperatorList()
    const iconos: Icono[] = []
    let matriz: Matriz = [1, 0, 0, 1, 0, 0]
    const pila: Matriz[] = []
    for (let i = 0; i < operaciones.fnArray.length; i++) {
      const op = operaciones.fnArray[i]
      const args = operaciones.argsArray[i]
      if (op === OPS.save) pila.push(matriz)
      else if (op === OPS.restore) matriz = pila.pop() ?? matriz
      else if (op === OPS.transform) matriz = multiplicar(matriz, args as Matriz)
      else if (op === OPS.paintImageXObject) {
        const [ancho, alto] = [Math.abs(matriz[0]), Math.abs(matriz[3])]
        if (ancho > 20 || alto > 20) continue // escudos y logotipos
        const imagen = await new Promise<{ data: Uint8ClampedArray; kind: number } | null>(
          (resolver) => {
            try {
              pagina.objs.get(args[0], resolver)
            } catch {
              resolver(null)
            }
          },
        )
        if (!imagen?.data) continue
        iconos.push({
          x: matriz[4] + matriz[0] / 2,
          y: matriz[5] + matriz[3] / 2,
          color: colorMedio(imagen.data, imagen.kind),
        })
      }
    }
    return { textos, iconos }
  } finally {
    await documento.destroy()
  }
}

// Color medio de los píxeles opacos (kind 2 = RGB, 3 = RGBA)
function colorMedio(datos: Uint8ClampedArray, tipo: number): [number, number, number] {
  const paso = tipo === 3 ? 4 : 3
  let [r, g, b, n] = [0, 0, 0, 0]
  for (let i = 0; i + 2 < datos.length; i += paso) {
    if (paso === 4 && (datos[i + 3] ?? 0) < 128) continue
    r += datos[i] ?? 0
    g += datos[i + 1] ?? 0
    b += datos[i + 2] ?? 0
    n++
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n]
}

type Color = 'azul' | 'rojo' | 'amarillo' | null
function nombreColor([r, g, b]: [number, number, number]): Color {
  if (b > r + 40 && b > g + 40) return 'azul'
  if (r > 140 && g > 120 && b < g - 30) return 'amarillo'
  if (r > 140 && g < 110 && b < 110) return 'rojo'
  return null
}

// "(33')" o, en el descuento, "(90'+3)", que es el minuto 93
const MINUTO = /^(.*?)\s*\((\d+)'(?:\s*\+\s*(\d+))?\)\s*$/
const conMinuto = (texto: string) => {
  const m = texto.match(MINUTO)
  if (!m) return { nombre: texto, minuto: null }
  return { nombre: (m[1] ?? '').trim(), minuto: Number(m[2]) + Number(m[3] ?? 0) }
}

// Una fila: los textos a la misma altura (con un poco de margen), de izquierda a derecha
type Fila = { y: number; textos: Texto[] }
function filas(textos: Texto[]): Fila[] {
  const resultado: Fila[] = []
  for (const t of [...textos].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const fila = resultado.find((f) => Math.abs(f.y - t.y) <= 2.5)
    if (fila) fila.textos.push(t)
    else resultado.push({ y: t.y, textos: [t] })
  }
  for (const f of resultado) f.textos.sort((a, b) => a.x - b.x)
  return resultado.sort((a, b) => b.y - a.y)
}

// Dorsal (si lo hay) y el resto del texto
function persona(f: Fila): PersonaActa & { minuto: number | null } {
  const [primero, ...resto] = f.textos
  const tieneDorsal = primero && /^\d{1,3}$/.test(primero.texto) && resto.length > 0
  const texto = (tieneDorsal ? resto : f.textos).map((t) => t.texto).join(' ')
  const { nombre, minuto } = conMinuto(texto)
  return { dorsal: tieneDorsal ? Number(primero.texto) : null, nombre, minuto }
}

const SECCIONES = ['TITULARES', 'SUPLENTES', 'CUERPO TECNICO', 'SUSTITUCIONES', 'TARJETAS'] as const
type Seccion = (typeof SECCIONES)[number]

function leerEquipo(textos: Texto[], iconos: Icono[]): EquipoActa {
  const cabeceras = textos
    .filter((t) => (SECCIONES as readonly string[]).includes(normalizar(t.texto)))
    .map((t) => ({ seccion: normalizar(t.texto) as Seccion, y: t.y }))
    .sort((a, b) => b.y - a.y)
  const titulares = cabeceras.find((c) => c.seccion === 'TITULARES')
  if (!titulares) throw new ActaNoLegible('No se encuentran los titulares de un equipo')

  // Las filas de una sección: por debajo de su cabecera y por encima de la siguiente
  const enSeccion = (seccion: Seccion) => {
    const i = cabeceras.findIndex((c) => c.seccion === seccion)
    const cabecera = cabeceras[i]
    if (!cabecera) return []
    const hasta = cabeceras[i + 1]?.y ?? Number.NEGATIVE_INFINITY
    return filas(textos.filter((t) => t.y < cabecera.y - 1 && t.y > hasta + 1))
  }
  const iconoDe = (f: Fila) =>
    iconos
      .filter((i) => Math.abs(i.y - f.y) <= 4)
      .sort((a, b) => Math.abs(a.y - f.y) - Math.abs(b.y - f.y))[0]

  // El nombre del equipo va justo encima de los titulares
  const nombre = filas(textos.filter((t) => t.y > titulares.y + 5 && t.y < titulares.y + 45)).at(-1)

  const sinMinuto = (f: Fila): PersonaActa => {
    const { dorsal, nombre: n } = persona(f)
    return { dorsal, nombre: n }
  }

  // Sustituciones: por parejas; la flecha dice quién entra y quién sale. Sin flecha, sale quien
  // lleva minuto.
  const cambios: EquipoActa['cambios'] = []
  let entra: (PersonaActa & { minuto: number | null }) | null = null
  let sale: (PersonaActa & { minuto: number | null }) | null = null
  for (const f of enSeccion('SUSTITUCIONES')) {
    const p = persona(f)
    const color = iconoDe(f) ? nombreColor(iconoDe(f)?.color ?? [0, 0, 0]) : null
    const esEntrada = color === 'azul' || (color === null && p.minuto === null)
    if (esEntrada) entra = p
    else sale = p
    if (entra && sale) {
      cambios.push({
        entra: { dorsal: entra.dorsal, nombre: entra.nombre },
        sale: { dorsal: sale.dorsal, nombre: sale.nombre },
        minuto: sale.minuto ?? entra.minuto,
      })
      entra = null
      sale = null
    }
  }

  const tarjetas = enSeccion('TARJETAS').map((f) => {
    const { nombre: n, minuto } = persona(f)
    const icono = iconoDe(f)
    const color = icono ? nombreColor(icono.color) : null
    return {
      nombre: n,
      minuto,
      tipo:
        color === 'amarillo' ? ('amarilla' as const) : color === 'rojo' ? ('roja' as const) : null,
    }
  })

  return {
    nombre: nombre?.textos.map((t) => t.texto).join(' ') ?? '',
    titulares: enSeccion('TITULARES').map(sinMinuto),
    suplentes: enSeccion('SUPLENTES').map(sinMinuto),
    cambios,
    tarjetas,
  }
}

const MARCADOR = /^(\d+)\s*-\s*(\d+)$/

// "11-10-2026" → "2026-10-11"
const fechaIso = (texto: string) => {
  const m = texto.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
  return m ? `${m[3]}-${m[2]?.padStart(2, '0')}-${m[1]?.padStart(2, '0')}` : null
}

export function interpretar({ textos, iconos }: Elementos): FichaActa {
  const titulares = textos
    .filter((t) => normalizar(t.texto) === 'TITULARES')
    .sort((a, b) => a.x - b.x)
  const [izquierda, derecha] = titulares
  if (!izquierda || !derecha || titulares.length !== 2) {
    throw new ActaNoLegible('No parece una ficha del partido de la Federación Gallega')
  }
  // El centro empieza en lo primero que es suyo: sus etiquetas o los marcadores de los goles, que
  // según la ficha quedan más a la izquierda que las etiquetas
  const etiquetasCentro = textos.filter(
    (t) =>
      ['GOLES', 'ESTADIO:', 'ARBITROS:', 'ARBITRO'].includes(normalizar(t.texto)) ||
      MARCADOR.test(t.texto),
  )
  const inicioDerecha = derecha.x - 8
  const inicioCentro = Math.min(...etiquetasCentro.map((t) => t.x), inicioDerecha) - 8
  const columna = (x: number) =>
    x >= inicioDerecha ? 'derecha' : x >= inicioCentro ? 'centro' : 'izquierda'
  const de = <T extends { x: number }>(lista: T[], col: string) =>
    lista.filter((e) => columna(e.x) === col)

  // Cabecera: competición y jornada, fecha y hora (por encima de los nombres de los equipos)
  const arriba = filas(textos.filter((t) => t.y > izquierda.y + 15))
  const textoTras = (etiqueta: string) => {
    for (const f of arriba.concat(filas(textos))) {
      const i = f.textos.findIndex((t) => normalizar(t.texto) === etiqueta)
      if (i >= 0) return f.textos[i + 1]?.texto ?? null
    }
    return null
  }
  const filaJornada = arriba.find((f) => f.textos.some((t) => /^jornada\s+\d+/i.test(t.texto)))
  const jornada = filaJornada?.textos.find((t) => /^jornada\s+\d+/i.test(t.texto))
  const competicion =
    filaJornada?.textos
      .filter((t) => t !== jornada)
      .map((t) => t.texto)
      .join(' ') || null

  // Centro: marcador, goles y estadio
  const centro = filas(de(textos, 'centro'))
  const cabeceraGoles = centro.find((f) => f.textos.some((t) => normalizar(t.texto) === 'GOLES'))
  const marcador = centro
    .filter((f) => f.y > (cabeceraGoles?.y ?? 0) + 30)
    .map((f) =>
      f.textos
        .map((t) => t.texto)
        .join(' ')
        .match(MARCADOR),
    )
    .find(Boolean)
  const goles: FichaActa['goles'] = []
  let anterior = [0, 0]
  for (const f of centro) {
    if (cabeceraGoles && f.y >= cabeceraGoles.y) continue
    const [primero, ...resto] = f.textos
    const m = primero?.texto.match(MARCADOR)
    if (!m || resto.length === 0) continue
    const actual = [Number(m[1]), Number(m[2])]
    const { nombre, minuto } = conMinuto(resto.map((t) => t.texto).join(' '))
    goles.push({
      equipo: (actual[0] ?? 0) > (anterior[0] ?? 0) ? 'local' : 'visitante',
      nombre,
      minuto,
    })
    anterior = actual
  }
  const ultimo = goles.length > 0 ? anterior : [0, 0]
  const hora = textoTras('HORA:')?.match(/\d{1,2}:\d{2}/)?.[0] ?? null

  return {
    competicion,
    jornada: jornada ? Number(jornada.texto.match(/\d+/)?.[0]) : null,
    fecha: fechaIso(textoTras('FECHA:') ?? ''),
    hora: hora?.padStart(5, '0') ?? null,
    estadio: textoTras('ESTADIO:'),
    ciudad: textoTras('CIUDAD:'),
    local: leerEquipo(de(textos, 'izquierda'), de(iconos, 'izquierda')),
    visitante: leerEquipo(de(textos, 'derecha'), de(iconos, 'derecha')),
    golesLocal: marcador ? Number(marcador[1]) : (ultimo[0] ?? 0),
    golesVisitante: marcador ? Number(marcador[2]) : (ultimo[1] ?? 0),
    goles,
  }
}

export const leerActa = async (pdf: Uint8Array) => interpretar(await extraer(pdf))
