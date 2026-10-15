import type { DatosEstadisticas, Evento } from '../estadisticas.js'
import { type Candidato, emparejar } from './emparejar.js'
import { type FichaActa, normalizar, type PersonaActa, type Tarjeta } from './leer.js'

// La ficha leída desde el punto de vista de la plantilla: qué equipo somos, el resultado a favor y
// en contra, y cada persona del acta con el jugador de la plantilla que le corresponde (o null).
// Es lo que revisa el entrenador antes de confirmar; al confirmar se convierte en las estadísticas.

export type JugadorActa = { dorsal: number | null; nombre: string; jugadorId: string | null }
export type GolActa = {
  nombre: string
  jugadorId: string | null
  minuto: number | null
  // En los goles a favor, gol en propia puerta del rival; en contra, de uno de los nuestros
  enPropia: boolean
}

export type Lectura = {
  equipo: 'local' | 'visitante'
  nombreEquipo: string
  rival: string
  competicion: string | null
  jornada: number | null
  fecha: string | null
  hora: string | null
  estadio: string | null
  ciudad: string | null
  golesFavor: number
  golesContra: number
  titulares: JugadorActa[]
  suplentes: JugadorActa[]
  cambios: { entra: JugadorActa; sale: JugadorActa; minuto: number | null }[]
  goles: GolActa[]
  golesEnContra: GolActa[]
  tarjetas: (JugadorActa & { minuto: number | null; tipo: Tarjeta | null })[]
  avisos: string[]
}

export type Partido = { local: boolean | null; fecha: string }
// Correcciones del entrenador: el jugador de cada nombre del acta y el tipo de cada tarjeta
export type Correcciones = {
  jugadores?: { nombre: string; jugadorId: string | null }[]
  tarjetas?: { indice: number; tipo: Tarjeta }[]
}

const palabras = (texto: string) =>
  new Set(
    normalizar(texto)
      .replace(/[^A-Z0-9 ]/g, ' ')
      .split(' ')
      .filter((p) => p.length > 1),
  )

// Qué columna es la nuestra: la que dice el partido o, si no se sabe, la que se parece al club
function nuestroLado(ficha: FichaActa, partido: Partido, club: string) {
  if (partido.local === true) return { lado: 'local' as const, seguro: true }
  if (partido.local === false) return { lado: 'visitante' as const, seguro: true }
  const delClub = palabras(club)
  const parecido = (equipo: string) => [...palabras(equipo)].filter((p) => delClub.has(p)).length
  const [l, v] = [parecido(ficha.local.nombre), parecido(ficha.visitante.nombre)]
  if (l === v) return { lado: 'local' as const, seguro: false }
  return { lado: l > v ? ('local' as const) : ('visitante' as const), seguro: true }
}

export function construirLectura(
  ficha: FichaActa,
  partido: Partido,
  club: string,
  candidatos: Candidato[],
  correcciones: Correcciones = {},
): Lectura {
  const { lado, seguro } = nuestroLado(ficha, partido, club)
  const nuestro = ficha[lado]
  const suyo = ficha[lado === 'local' ? 'visitante' : 'local']
  const plantilla = [...nuestro.titulares, ...nuestro.suplentes]

  const asignados = emparejar(plantilla, candidatos)
  for (const c of correcciones.jugadores ?? []) {
    const persona = plantilla.find((p) => normalizar(p.nombre) === normalizar(c.nombre))
    if (persona) asignados.set(persona.nombre, c.jugadorId)
  }
  const buscar = (nombre: string) =>
    plantilla.find((p) => normalizar(p.nombre) === normalizar(nombre))
  const jugador = (p: PersonaActa): JugadorActa => {
    const enLista = buscar(p.nombre)
    return {
      dorsal: p.dorsal ?? enLista?.dorsal ?? null,
      nombre: enLista?.nombre ?? p.nombre,
      jugadorId: enLista ? (asignados.get(enLista.nombre) ?? null) : null,
    }
  }

  // Goles: si el nombre es de los nuestros, es nuestro; si no, del rival. Un gol a nuestro favor
  // con nombre del rival es un gol en propia puerta suyo, y al revés
  const goles: GolActa[] = []
  const golesEnContra: GolActa[] = []
  for (const g of ficha.goles) {
    const deLosNuestros = buscar(g.nombre)
    const aFavor = g.equipo === lado
    const gol = {
      nombre: g.nombre,
      jugadorId: deLosNuestros ? (asignados.get(deLosNuestros.nombre) ?? null) : null,
      minuto: g.minuto,
      enPropia: aFavor ? !deLosNuestros : Boolean(deLosNuestros),
    }
    if (aFavor) goles.push(gol)
    else golesEnContra.push(gol)
  }

  const tarjetas = nuestro.tarjetas.map((t, indice) => ({
    ...jugador({ dorsal: null, nombre: t.nombre }),
    minuto: t.minuto,
    tipo: correcciones.tarjetas?.find((c) => c.indice === indice)?.tipo ?? t.tipo,
  }))

  const titulares = nuestro.titulares.map(jugador)
  const suplentes = nuestro.suplentes.map(jugador)
  const avisos: string[] = []
  if (!seguro) {
    avisos.push(
      'El partido no dice si fue en casa o fuera y el nombre del club no aparece en el acta: se ha tomado el equipo local. Indica en el partido si fue en casa o fuera y vuelve a leer el acta.',
    )
  }
  if (ficha.fecha && ficha.fecha !== partido.fecha) {
    avisos.push(`El acta es del ${ficha.fecha} y el partido del ${partido.fecha}`)
  }
  const sinJugador = [...titulares, ...suplentes].filter((j) => !j.jugadorId).length
  if (sinJugador > 0) {
    avisos.push(
      sinJugador === 1
        ? 'Hay un jugador del acta sin emparejar: elige quién es o no contará'
        : `Hay ${sinJugador} jugadores del acta sin emparejar: elige quiénes son o no contarán`,
    )
  }
  if (tarjetas.some((t) => !t.tipo))
    avisos.push('Indica el tipo de las tarjetas que no se han podido leer')

  return {
    equipo: lado,
    nombreEquipo: nuestro.nombre,
    rival: suyo.nombre,
    competicion: ficha.competicion,
    jornada: ficha.jornada,
    fecha: ficha.fecha,
    hora: ficha.hora,
    estadio: ficha.estadio,
    ciudad: ficha.ciudad,
    golesFavor: lado === 'local' ? ficha.golesLocal : ficha.golesVisitante,
    golesContra: lado === 'local' ? ficha.golesVisitante : ficha.golesLocal,
    titulares,
    suplentes,
    cambios: nuestro.cambios.map((c) => ({
      entra: jugador(c.entra),
      sale: jugador(c.sale),
      minuto: c.minuto,
    })),
    goles,
    golesEnContra,
    tarjetas,
    avisos,
  }
}

// Las estadísticas que se registran con la fuente «acta». Lo que no tiene jugador de la plantilla
// no se registra (salvo los goles en propia del rival, que no lo necesitan).
export function aEstadisticas(lectura: Lectura): DatosEstadisticas {
  const eventos: Evento[] = []
  for (const c of lectura.cambios) {
    if (c.entra.jugadorId)
      eventos.push({ jugadorId: c.entra.jugadorId, tipo: 'entra', minuto: c.minuto })
    if (c.sale.jugadorId)
      eventos.push({ jugadorId: c.sale.jugadorId, tipo: 'sale', minuto: c.minuto })
  }
  for (const g of lectura.goles) {
    if (g.enPropia) eventos.push({ jugadorId: null, tipo: 'gol_propia', minuto: g.minuto })
    else if (g.jugadorId) eventos.push({ jugadorId: g.jugadorId, tipo: 'gol', minuto: g.minuto })
  }
  for (const g of lectura.golesEnContra) {
    if (g.enPropia && g.jugadorId) {
      eventos.push({ jugadorId: g.jugadorId, tipo: 'gol_propia', minuto: g.minuto })
    }
  }
  for (const t of lectura.tarjetas) {
    if (t.jugadorId && t.tipo)
      eventos.push({ jugadorId: t.jugadorId, tipo: t.tipo, minuto: t.minuto })
  }
  const participaciones = [
    ...lectura.titulares.map((j) => ({ jugadorId: j.jugadorId, titular: true })),
    ...lectura.suplentes.map((j) => ({ jugadorId: j.jugadorId, titular: false })),
  ].flatMap((p) => (p.jugadorId ? [{ jugadorId: p.jugadorId, titular: p.titular }] : []))
  return {
    resultado: { golesFavor: lectura.golesFavor, golesContra: lectura.golesContra },
    participaciones,
    eventos,
  }
}
