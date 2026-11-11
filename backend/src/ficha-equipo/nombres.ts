// Arreglos de los textos de la ficha del equipo de la federación (GH-197)

// Caracteres de Windows-1252 que no coinciden con Latin-1 (bytes 0x80–0x9F)
const CP1252: Record<string, number> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  Š: 0x8a,
  '‹': 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '˜': 0x98,
  '™': 0x99,
  š: 0x9a,
  '›': 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
}

// La ficha trae los nombres en UTF-8 leído como Windows-1252: «Ã“» es «Ó», «Ã‘» es «Ñ». La Á y la Í
// caen en bytes que Windows-1252 no tiene y salen las dos como «Ã•»; se lee Á, que es la que aparece
// en los apellidos (Fernández, Vázquez, Adrián).
export function repararTildes(texto: string) {
  return texto.replace(/([ÂÃ])(.)/gu, (par, inicio: string, siguiente: string) => {
    if (inicio === 'Ã' && siguiente === '•') return 'Á'
    const codigo = CP1252[siguiente] ?? siguiente.codePointAt(0) ?? 0
    if (codigo < 0x80 || codigo > 0xbf) return par
    return Buffer.from([inicio === 'Â' ? 0xc2 : 0xc3, codigo]).toString('utf8')
  })
}

const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos'])

// Abreviaturas que se quedan en mayúsculas en el nombre del equipo: «S.D.», «CD», «UD»
function esAbreviatura(palabra: string) {
  if (palabra.includes('.')) return true
  const letras = palabra.replace(/[^\p{L}]/gu, '')
  return /^[A-ZÇÑ]{2,4}$/u.test(letras) && !/[AEIOU]/.test(letras)
}

// «FERNÁNDEZ DE LA FUENTE» → «Fernández de la Fuente». Con abreviaturas, para el nombre del equipo.
export function capitalizar(texto: string, { abreviaturas = false } = {}) {
  let primera = true
  return texto
    .trim()
    .split(/\s+/)
    .map((palabra) => {
      const minusculas = palabra.toLocaleLowerCase('es')
      const resultado =
        abreviaturas && esAbreviatura(palabra)
          ? palabra
          : !primera && PARTICULAS.has(minusculas)
            ? minusculas
            : // Cada parte de un apellido compuesto («Pérez-Llorca») y tras comillas o paréntesis
              minusculas.replace(
                /(^|[-'"(«])(\p{L})/gu,
                (_, antes: string, letra: string) => `${antes}${letra.toLocaleUpperCase('es')}`,
              )
      primera = false
      return resultado
    })
    .join(' ')
}

// «ENTRENADOR TITULAR» → «Entrenador titular»
export const enFrase = (texto: string) => {
  const minusculas = texto.trim().toLocaleLowerCase('es')
  return minusculas.charAt(0).toLocaleUpperCase('es') + minusculas.slice(1)
}

// «BLANCO CAMBON, DIEGO» → nombre «Diego», apellidos «Blanco Cambon»
export function separarNombre(texto: string) {
  const coma = texto.indexOf(',')
  if (coma < 0) return { nombre: capitalizar(texto), apellidos: null }
  const apellidos = capitalizar(texto.slice(0, coma))
  const nombre = capitalizar(texto.slice(coma + 1))
  return nombre ? { nombre, apellidos: apellidos || null } : { nombre: apellidos, apellidos: null }
}
