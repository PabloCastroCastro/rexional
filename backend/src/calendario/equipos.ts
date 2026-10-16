import { normalizar } from '../acta/leer.js'

// Comparación de nombres de equipos: el calendario los escribe a su manera («SPORTING CORUÑES SDC
// "B"») y en la aplicación pueden estar de otra («Sporting Coruñés B»). Se comparan por las palabras
// que distinguen al equipo, sin siglas de sociedad ni artículos. La misma lógica está en el
// frontend (src/partidos/calendario.ts) para marcar en la vista previa los partidos que ya están.

const GENERICAS = new Set([
  'CLUB',
  'CD',
  'SD',
  'SDC',
  'CF',
  'FC',
  'UD',
  'CP',
  'SC',
  'AD',
  'DE',
  'DEL',
  'LA',
  'EL',
  'LOS',
  'LAS',
])

export const palabrasEquipo = (nombre: string) =>
  new Set(
    normalizar(nombre)
      // Siglas con puntos: «C.D.» → «CD»
      .replace(/\b([A-Z])\.(?=[A-Z]\.)/g, '$1')
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(' ')
      .filter((p) => p.length > 1 && !GENERICAS.has(p)),
  )

// Cuántas palabras distintivas comparten dos nombres
export function parecido(a: string, b: string) {
  const pa = palabrasEquipo(a)
  return [...palabrasEquipo(b)].filter((p) => pa.has(p)).length
}

// El equipo del calendario que más se parece al club; null si no hay uno claro
export function detectarEquipo(equipos: string[], club: string) {
  // A igualdad de palabras comunes, el de nombre más corto: «CD Ciudad» es «C.D. CIUDAD» y no
  // «C.D. CIUDAD JARDÍN "B"»
  const puntos = equipos
    .map((e) => ({ e, p: parecido(e, club), sobran: palabrasEquipo(e).size }))
    .sort((a, b) => b.p - a.p || a.sobran - b.sobran)
  const [primero, segundo] = puntos
  if (!primero || primero.p === 0) return null
  if (segundo && segundo.p === primero.p && segundo.sobran === primero.sobran) return null
  return primero.e
}

const dias = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

// Un partido del calendario ya está si hay otro ese mismo día o, con pocos días de diferencia (el
// calendario da el domingo y puede jugarse el sábado), contra un rival que se le parece
export const yaRegistrado = (
  nuevo: { fecha: string; rival: string },
  existentes: { fecha: string; rival: string }[],
) =>
  existentes.some(
    (e) =>
      e.fecha === nuevo.fecha ||
      (dias(e.fecha, nuevo.fecha) <= 3 && parecido(e.rival, nuevo.rival) > 0),
  )
