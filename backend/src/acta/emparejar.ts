import { normalizar } from './leer.js'

// Emparejamiento de los nombres del acta ("APELLIDOS, NOMBRE", en mayúsculas) con los jugadores de
// la plantilla. Se compara sin tildes ni mayúsculas, palabra a palabra: en la app un jugador puede
// tener solo el primer apellido o ninguno. El dorsal ayuda a decidir, pero no basta solo: en la
// federación el dorsal de un partido puede no ser el habitual.

export type Candidato = {
  jugadorId: string
  nombre: string
  apellidos: string | null
  dorsal: number | null
}

const palabras = (texto: string) =>
  normalizar(texto)
    .replace(/[^A-Z0-9Ñ ]/g, ' ')
    .split(' ')
    .filter(Boolean)

const contiene = (todas: string[], algunas: string[]) => algunas.every((p) => todas.includes(p))

// Puntuación: 0 si no puede ser él
function puntuar(nombreActa: string, dorsal: number | null, c: Candidato) {
  const [apellidosActa = '', nombreDeActa = ''] = nombreActa.includes(',')
    ? nombreActa.split(',')
    : ['', nombreActa]
  const enActa = { nombre: palabras(nombreDeActa), apellidos: palabras(apellidosActa) }
  const todas = [...enActa.nombre, ...enActa.apellidos]
  const nombre = palabras(c.nombre)
  const apellidos = palabras(c.apellidos ?? '')
  if (nombre.length === 0) return 0
  // El nombre de pila, en el nombre del acta (o en cualquier parte si el acta no separa con coma)
  if (!contiene(enActa.nombre.length > 0 ? enActa.nombre : todas, nombre)) return 0
  let puntos = 1
  if (apellidos.length > 0) {
    if (!contiene(enActa.apellidos.length > 0 ? enActa.apellidos : todas, apellidos)) return 0
    puntos += 2
  }
  if (dorsal !== null && c.dorsal === dorsal) puntos += 1
  return puntos
}

// El jugador de cada persona del acta, o null si no hay uno claro. Un jugador solo se asigna una
// vez: si dos personas del acta encajan con el mismo, se queda con la que mejor encaja.
export function emparejar(
  personas: { nombre: string; dorsal: number | null }[],
  candidatos: Candidato[],
): Map<string, string | null> {
  const propuestas = personas.map((p) => {
    const puntuados = candidatos
      .map((c) => ({ jugadorId: c.jugadorId, puntos: puntuar(p.nombre, p.dorsal, c) }))
      .filter((c) => c.puntos > 0)
      .sort((a, b) => b.puntos - a.puntos)
    const [mejor, segundo] = puntuados
    // Solo nombre de pila: hace falta el dorsal para estar seguros. Empate: no se decide.
    const claro = mejor && mejor.puntos >= 2 && mejor.puntos !== segundo?.puntos
    return {
      nombre: p.nombre,
      jugadorId: claro ? mejor.jugadorId : null,
      puntos: mejor?.puntos ?? 0,
    }
  })
  const resultado = new Map<string, string | null>()
  for (const p of propuestas) {
    const rival = propuestas.find(
      (o) => o !== p && o.jugadorId !== null && o.jugadorId === p.jugadorId && o.puntos >= p.puntos,
    )
    resultado.set(p.nombre, rival ? null : p.jugadorId)
  }
  return resultado
}
