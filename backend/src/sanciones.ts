import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { db } from './db/cliente.js'
import { ajustesSancion, eventosPartido, partidos, plantillas } from './db/schema/index.js'

// Sanciones (GH-231): se calculan, no se guardan. A partir de las tarjetas de los partidos jugados y
// de las reglas de la plantilla:
//   - roja directa (una roja sin amarillas en el partido): partidosRoja
//   - doble amarilla (roja y alguna amarilla, o dos amarillas, en el mismo partido): partidosDobleAmarilla;
//     esas amarillas no cuentan para el ciclo
//   - ciclo: cada amarillasCiclo amarillas en la misma competición, 1 partido (0, sin ciclo)
// Una sanción se cumple con los siguientes partidos jugados de su competición; si se acumulan, una
// detrás de otra. Los partidos sin competición son amistosos: sus tarjetas no sancionan ni cumplen.
// El comité puede cambiar el número de partidos de una sanción (o anularla con 0): son los ajustes.

export type TipoSancion = 'roja' | 'doble_amarilla' | 'ciclo'

export type Reglas = { amarillasCiclo: number; partidosRoja: number; partidosDobleAmarilla: number }

export type PartidoSancion = {
  id: string
  rival: string
  fecha: string
  hora: string | null
  competicion: string | null
  estado: 'programado' | 'jugado' | 'aplazado'
  createdAt: Date
}

export type Tarjeta = { partidoId: string; jugadorId: string; tipo: 'amarilla' | 'roja' }

export type Ajuste = {
  partidoId: string
  jugadorId: string
  tipo: TipoSancion
  partidos: number
  nota: string | null
}

export type Sancion = {
  partidoId: string
  rival: string
  fecha: string
  competicion: string
  jugadorId: string
  tipo: TipoSancion
  // Los que salen de las reglas y los que cuentan (con el ajuste del comité, si lo hay)
  calculados: number
  partidos: number
  cumplidos: number
  ajustada: boolean
  nota: string | null
}

export type EstadoJugador = {
  jugadorId: string
  // Partidos que le quedan por cumplir en cada competición
  pendientes: { competicion: string; partidos: number }[]
  // A una amarilla de cerrar el ciclo
  apercibido: { competicion: string; amarillas: number }[]
  // La más reciente primero
  sanciones: Sancion[]
}

// Sin la jornada del final: al registrar el acta, la competición se guarda como «Preferente ·
// Jornada 5», y todas las jornadas son la misma competición
export const sinJornada = (texto: string) =>
  texto.replace(/\s*[·,|-]?\s*jornada\s*\d+\s*$/iu, '').trim()

// «Preferente · Grupo 2», «preferente  · grupo 2» y «Preferente · Grupo 2 · Jornada 5» son la misma
// competición
export const normalizarCompeticion = (texto: string | null) => {
  const n = sinJornada(texto ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
  return n || null
}

// Por fecha, hora (sin hora, al final del día) y orden de alta
const ordenar = (lista: PartidoSancion[]) =>
  [...lista].sort(
    (a, b) =>
      a.fecha.localeCompare(b.fecha) ||
      (a.hora ?? '99').localeCompare(b.hora ?? '99') ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )

type Pendiente = { sancion: Sancion; quedan: number }

type Calculo = {
  sanciones: Sancion[]
  // Lo que debe cada jugador en cada competición justo antes de cada partido (de cualquier estado)
  antesDe: Map<string, Map<string, number>>
  // Al final: lo que debe y las amarillas del ciclo en curso, por jugador y competición
  debe: Map<string, Map<string, number>>
  ciclo: Map<string, Map<string, number>>
  nombres: Map<string, string>
}

const clave = (jugadorId: string, competicion: string) => `${jugadorId}|${competicion}`

export function calcularSanciones(
  lista: PartidoSancion[],
  tarjetas: Tarjeta[],
  reglas: Reglas,
  ajustes: Ajuste[],
): Calculo {
  const ordenados = ordenar(lista)
  const nombres = new Map<string, string>()
  const tarjetasDe = new Map<string, Tarjeta[]>()
  for (const t of tarjetas) tarjetasDe.set(t.partidoId, [...(tarjetasDe.get(t.partidoId) ?? []), t])
  const ajusteDe = new Map(ajustes.map((a) => [`${a.partidoId}|${a.jugadorId}|${a.tipo}`, a]))

  const sanciones: Sancion[] = []
  // Cola de sanciones por cumplir y amarillas del ciclo, por jugador y competición
  const colas = new Map<string, Pendiente[]>()
  const amarillas = new Map<string, number>()
  const antesDe = new Map<string, Map<string, number>>()

  const deudaDe = (k: string) => (colas.get(k) ?? []).reduce((total, p) => total + p.quedan, 0)

  for (const p of ordenados) {
    const competicion = normalizarCompeticion(p.competicion)
    // Lo que debe cada jugador antes de este partido, en su competición
    const foto = new Map<string, number>()
    if (competicion) {
      for (const [k] of colas) {
        const [jugadorId, comp] = k.split('|') as [string, string]
        if (comp === competicion && deudaDe(k) > 0) foto.set(jugadorId, deudaDe(k))
      }
    }
    antesDe.set(p.id, foto)
    if (p.estado !== 'jugado' || !competicion) continue
    if (!nombres.has(competicion))
      nombres.set(competicion, sinJornada(p.competicion ?? competicion))

    // El partido cumple un partido de la primera sanción pendiente de cada jugador
    for (const [k, cola] of colas) {
      if (!k.endsWith(`|${competicion}`)) continue
      const primera = cola.find((x) => x.quedan > 0)
      if (primera) {
        primera.quedan -= 1
        primera.sancion.cumplidos += 1
      }
    }

    // Y sus tarjetas generan las nuevas, que se cumplen desde el siguiente
    const porJugador = new Map<string, { rojas: number; amarillas: number }>()
    for (const t of tarjetasDe.get(p.id) ?? []) {
      const actual = porJugador.get(t.jugadorId) ?? { rojas: 0, amarillas: 0 }
      if (t.tipo === 'roja') actual.rojas += 1
      else actual.amarillas += 1
      porJugador.set(t.jugadorId, actual)
    }
    for (const [jugadorId, { rojas, amarillas: nAmarillas }] of porJugador) {
      const k = clave(jugadorId, competicion)
      const nuevas: TipoSancion[] = []
      if ((rojas > 0 && nAmarillas > 0) || (rojas === 0 && nAmarillas >= 2)) {
        nuevas.push('doble_amarilla')
      } else if (rojas > 0) {
        nuevas.push('roja')
      } else if (nAmarillas > 0 && reglas.amarillasCiclo > 0) {
        const total = (amarillas.get(k) ?? 0) + nAmarillas
        if (total >= reglas.amarillasCiclo) {
          nuevas.push('ciclo')
          amarillas.set(k, total - reglas.amarillasCiclo)
        } else amarillas.set(k, total)
      }
      for (const tipo of nuevas) {
        const calculados =
          tipo === 'roja'
            ? reglas.partidosRoja
            : tipo === 'doble_amarilla'
              ? reglas.partidosDobleAmarilla
              : 1
        const ajuste = ajusteDe.get(`${p.id}|${jugadorId}|${tipo}`)
        const sancion: Sancion = {
          partidoId: p.id,
          rival: p.rival,
          fecha: p.fecha,
          competicion: sinJornada(p.competicion ?? competicion),
          jugadorId,
          tipo,
          calculados,
          partidos: ajuste?.partidos ?? calculados,
          cumplidos: 0,
          ajustada: ajuste !== undefined,
          nota: ajuste?.nota ?? null,
        }
        sanciones.push(sancion)
        colas.set(k, [...(colas.get(k) ?? []), { sancion, quedan: sancion.partidos }])
      }
    }
  }

  const debe = new Map<string, Map<string, number>>()
  for (const [k] of colas) {
    const [jugadorId, comp] = k.split('|') as [string, string]
    const deuda = deudaDe(k)
    if (deuda > 0) debe.set(jugadorId, new Map([...(debe.get(jugadorId) ?? []), [comp, deuda]]))
  }
  const ciclo = new Map<string, Map<string, number>>()
  for (const [k, n] of amarillas) {
    const [jugadorId, comp] = k.split('|') as [string, string]
    ciclo.set(jugadorId, new Map([...(ciclo.get(jugadorId) ?? []), [comp, n]]))
  }
  return { sanciones, antesDe, debe, ciclo, nombres }
}

// El estado de cada jugador hoy: lo que debe, si está apercibido y sus sanciones
export function estadoDeJugadores(calculo: Calculo, reglas: Reglas): EstadoJugador[] {
  const ids = new Set([
    ...calculo.sanciones.map((s) => s.jugadorId),
    ...calculo.debe.keys(),
    ...calculo.ciclo.keys(),
  ])
  const nombre = (comp: string) => calculo.nombres.get(comp) ?? comp
  const estados: EstadoJugador[] = []
  for (const jugadorId of ids) {
    const pendientes = [...(calculo.debe.get(jugadorId) ?? [])].map(([comp, n]) => ({
      competicion: nombre(comp),
      partidos: n,
    }))
    const apercibido =
      reglas.amarillasCiclo > 1
        ? [...(calculo.ciclo.get(jugadorId) ?? [])]
            .filter(([, n]) => n === reglas.amarillasCiclo - 1)
            .map(([comp, n]) => ({ competicion: nombre(comp), amarillas: n }))
        : []
    const sanciones = calculo.sanciones.filter((s) => s.jugadorId === jugadorId).reverse()
    if (pendientes.length || apercibido.length || sanciones.length) {
      estados.push({ jugadorId, pendientes, apercibido, sanciones })
    }
  }
  return estados
}

// --- Con la base de datos ---

export async function reglasDe(plantillaId: string): Promise<Reglas> {
  const [reglas] = await db
    .select({
      amarillasCiclo: plantillas.amarillasCiclo,
      partidosRoja: plantillas.partidosRoja,
      partidosDobleAmarilla: plantillas.partidosDobleAmarilla,
    })
    .from(plantillas)
    .where(eq(plantillas.id, plantillaId))
  return reglas ?? { amarillasCiclo: 5, partidosRoja: 1, partidosDobleAmarilla: 1 }
}

export async function calcularDePlantilla(plantillaId: string) {
  const reglas = await reglasDe(plantillaId)
  const lista = await db
    .select({
      id: partidos.id,
      rival: partidos.rival,
      fecha: partidos.fecha,
      hora: partidos.hora,
      competicion: partidos.competicion,
      estado: partidos.estado,
      createdAt: partidos.createdAt,
    })
    .from(partidos)
    .where(eq(partidos.plantillaId, plantillaId))
  const jugados = lista.filter((p) => p.estado === 'jugado').map((p) => p.id)
  const tarjetas = jugados.length
    ? ((await db
        .select({
          partidoId: eventosPartido.partidoId,
          jugadorId: eventosPartido.jugadorId,
          tipo: eventosPartido.tipo,
        })
        .from(eventosPartido)
        .where(
          and(
            inArray(eventosPartido.partidoId, jugados),
            inArray(eventosPartido.tipo, ['amarilla', 'roja']),
            isNotNull(eventosPartido.jugadorId),
          ),
        )) as Tarjeta[])
    : []
  const ajustes = await db
    .select({
      partidoId: ajustesSancion.partidoId,
      jugadorId: ajustesSancion.jugadorId,
      tipo: ajustesSancion.tipo,
      partidos: ajustesSancion.partidos,
      nota: ajustesSancion.nota,
    })
    .from(ajustesSancion)
    .where(eq(ajustesSancion.plantillaId, plantillaId))
  return { reglas, calculo: calcularSanciones(lista, tarjetas, reglas, ajustes) }
}

// Lo que debe cada jugador para un partido de la plantilla (en su competición)
export async function sancionesParaPartido(plantillaId: string, partidoId: string) {
  const { calculo } = await calcularDePlantilla(plantillaId)
  return calculo.antesDe.get(partidoId) ?? new Map<string, number>()
}
