import { and, eq } from 'drizzle-orm'
import type { db } from './db/cliente.js'
import {
  convocados,
  eventosPartido,
  type origenDato,
  participaciones,
  partidos,
  type tipoEvento,
} from './db/schema/index.js'
import { ErrorApi } from './errores.js'

// Registro de estadísticas de partido (sección 2.7). Todo entra por aquí, venga de donde venga: la
// API manual cambia una parte (resultado, titulares, un evento) y el acta del partido registra el
// partido entero con su fuente. En los dos casos se comprueba que el partido en conjunto tiene
// sentido y se recalculan los minutos jugados.

// Duración con la que se calculan los minutos; un gol en el descuento (92') es válido
export const DURACION_PARTIDO = 90

export type TipoEvento = (typeof tipoEvento.enumValues)[number]
export type Origen = (typeof origenDato.enumValues)[number]
export type Resultado = { golesFavor: number; golesContra: number }
export type Participacion = { jugadorId: string; titular: boolean }
export type Evento = { jugadorId: string | null; tipo: TipoEvento; minuto: number | null }

// Lo que produce cualquier fuente (manual, acta, federación), con los jugadores ya identificados
export type DatosEstadisticas = {
  resultado: Resultado | null
  participaciones: Participacion[]
  eventos: Evento[]
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const incoherente = (mensaje: string) => new ErrorApi(400, 'estadisticas_incoherentes', mensaje)

const minutoDe = (eventos: Evento[], jugadorId: string, tipo: TipoEvento) =>
  eventos.find((e) => e.jugadorId === jugadorId && e.tipo === tipo)?.minuto ?? null

// Tramo en el campo de un jugador: desde que empieza (0 o su entrada) hasta que sale o le expulsan.
// null si no llega a jugar.
function tramo(p: Participacion, eventos: Evento[]) {
  const inicio = p.titular ? 0 : minutoDe(eventos, p.jugadorId, 'entra')
  if (inicio === null) return null
  const finales = [minutoDe(eventos, p.jugadorId, 'sale'), minutoDe(eventos, p.jugadorId, 'roja')]
  const fin = Math.min(...finales.filter((m) => m !== null), Number.POSITIVE_INFINITY)
  return { inicio, fin }
}

// Minutos jugados de cada participante, sobre DURACION_PARTIDO
export function calcularMinutos(lista: Participacion[], eventos: Evento[]) {
  return new Map(
    lista.map((p) => {
      const t = tramo(p, eventos)
      if (!t) return [p.jugadorId, 0]
      const inicio = Math.min(t.inicio, DURACION_PARTIDO)
      return [p.jugadorId, Math.max(0, Math.min(t.fin, DURACION_PARTIDO) - inicio)]
    }),
  )
}

// El primer problema del partido en conjunto, o null si todo cuadra
export function comprobar(datos: DatosEstadisticas, convocadosPartido: Set<string>): string | null {
  const { resultado, participaciones: lista, eventos } = datos
  const porJugador = new Map(lista.map((p) => [p.jugadorId, p]))
  if (porJugador.size !== lista.length)
    return 'Un jugador aparece dos veces entre titulares y suplentes'
  if (lista.some((p) => !convocadosPartido.has(p.jugadorId))) {
    return 'Titulares y suplentes tienen que estar convocados'
  }
  if (lista.filter((p) => p.titular).length > 11) return 'No puede haber más de 11 titulares'

  for (const e of eventos) {
    if (e.jugadorId === null) {
      if (e.tipo !== 'gol_propia') return 'Falta el jugador del evento'
      continue
    }
    if (!convocadosPartido.has(e.jugadorId)) return 'Los eventos son de jugadores convocados'
    if ((e.tipo === 'entra' || e.tipo === 'sale') && e.minuto === null) {
      return 'Los cambios necesitan el minuto'
    }
  }

  for (const tipo of ['entra', 'sale', 'roja'] as const) {
    const jugadoresTipo = eventos.filter((e) => e.tipo === tipo).map((e) => e.jugadorId)
    if (new Set(jugadoresTipo).size !== jugadoresTipo.length) {
      return {
        entra: 'Un jugador no puede entrar dos veces',
        sale: 'Un jugador no puede salir dos veces',
        roja: 'Un jugador no puede ver dos rojas',
      }[tipo]
    }
  }

  const cambios = eventos.filter((e) => e.tipo === 'entra' || e.tipo === 'sale')
  if (cambios.length > 0 && lista.length === 0) {
    return 'Para registrar cambios, indica antes los titulares y los suplentes'
  }
  for (const e of cambios) {
    const p = porJugador.get(e.jugadorId ?? '')
    if (!p) return 'Solo cambian jugadores que están entre titulares y suplentes'
    if (e.tipo === 'entra' && p.titular) return 'Un titular no puede entrar: ya está en el campo'
    if (e.tipo === 'sale') {
      const t = tramo(p, eventos)
      if (!t || (e.minuto ?? 0) < t.inicio) return 'Solo sale quien está en el campo'
      const roja = minutoDe(eventos, p.jugadorId, 'roja')
      if (roja !== null && (e.minuto ?? 0) > roja) return 'Un expulsado no puede salir en un cambio'
    }
  }

  // Goles y asistencias: de quien está en el campo, si se sabe quién jugó
  if (lista.length > 0) {
    for (const e of eventos) {
      if ((e.tipo !== 'gol' && e.tipo !== 'asistencia') || e.jugadorId === null) continue
      const p = porJugador.get(e.jugadorId)
      const t = p && tramo(p, eventos)
      const enCampo = t && (e.minuto === null || (e.minuto >= t.inicio && e.minuto <= t.fin))
      if (!enCampo) {
        return e.tipo === 'gol'
          ? 'Un gol tiene que ser de alguien que está en el campo'
          : 'Una asistencia tiene que ser de alguien que está en el campo'
      }
    }
  }

  const cuantos = (f: (e: Evento) => boolean) => eventos.filter(f).length
  const golesNuestros = cuantos((e) => e.tipo === 'gol')
  const aFavor = golesNuestros + cuantos((e) => e.tipo === 'gol_propia' && e.jugadorId === null)
  const enPropia = cuantos((e) => e.tipo === 'gol_propia' && e.jugadorId !== null)
  if (cuantos((e) => e.tipo === 'asistencia') > golesNuestros) {
    return 'Hay más asistencias que goles'
  }
  if (resultado && aFavor > resultado.golesFavor) {
    return `Hay ${aFavor} goles a favor registrados y el resultado dice ${resultado.golesFavor}`
  }
  if (resultado && enPropia > resultado.golesContra) {
    return `Hay ${enPropia} goles en propia puerta y el resultado dice ${resultado.golesContra} en contra`
  }
  return null
}

// Comprueba el partido tal como está guardado y actualiza los minutos jugados. Se llama dentro de
// la transacción de cada cambio: si algo no cuadra, el cambio se deshace.
export async function recalcular(tx: Tx, partidoId: string) {
  const [partido] = await tx
    .select({
      estado: partidos.estado,
      golesFavor: partidos.golesFavor,
      golesContra: partidos.golesContra,
    })
    .from(partidos)
    .where(eq(partidos.id, partidoId))
  if (!partido) throw new ErrorApi(404, 'no_encontrado', 'No existe ese partido en la plantilla')
  const lista = await tx
    .select({ jugadorId: participaciones.jugadorId, titular: participaciones.titular })
    .from(participaciones)
    .where(eq(participaciones.partidoId, partidoId))
  const eventos = await tx
    .select({
      jugadorId: eventosPartido.jugadorId,
      tipo: eventosPartido.tipo,
      minuto: eventosPartido.minuto,
    })
    .from(eventosPartido)
    .where(eq(eventosPartido.partidoId, partidoId))
  const convocadosPartido = await tx
    .select({ jugadorId: convocados.jugadorId })
    .from(convocados)
    .where(eq(convocados.partidoId, partidoId))

  const resultado =
    partido.golesFavor !== null && partido.golesContra !== null
      ? { golesFavor: partido.golesFavor, golesContra: partido.golesContra }
      : null
  const problema = comprobar(
    { resultado, participaciones: lista, eventos },
    new Set(convocadosPartido.map((c) => c.jugadorId)),
  )
  if (problema) throw incoherente(problema)

  for (const [jugadorId, minutos] of calcularMinutos(lista, eventos)) {
    await tx
      .update(participaciones)
      .set({ minutos })
      .where(
        and(eq(participaciones.partidoId, partidoId), eq(participaciones.jugadorId, jugadorId)),
      )
  }
}

// Bloquea el partido: dos cambios a la vez van uno detrás de otro
export async function bloquearPartido(tx: Tx, partidoId: string) {
  const [bloqueado] = await tx
    .select({ id: partidos.id })
    .from(partidos)
    .where(eq(partidos.id, partidoId))
    .for('update')
  if (!bloqueado) throw new ErrorApi(404, 'no_encontrado', 'No existe ese partido en la plantilla')
}

// Registra el partido entero desde una fuente: el resultado (si lo trae) marca el partido como
// jugado, titulares y suplentes se sustituyen y los eventos que esa misma fuente registró antes
// también. Los de otras fuentes se conservan.
export async function registrar(
  tx: Tx,
  partidoId: string,
  origen: Origen,
  datos: DatosEstadisticas,
) {
  await bloquearPartido(tx, partidoId)
  const convocadosPartido = new Set(
    (
      await tx
        .select({ jugadorId: convocados.jugadorId })
        .from(convocados)
        .where(eq(convocados.partidoId, partidoId))
    ).map((c) => c.jugadorId),
  )
  const jugadoresDatos = [
    ...datos.participaciones.map((p) => p.jugadorId),
    ...datos.eventos.flatMap((e) => (e.jugadorId ? [e.jugadorId] : [])),
  ]
  if (jugadoresDatos.some((j) => !convocadosPartido.has(j))) {
    throw incoherente('Las estadísticas son de jugadores convocados')
  }
  if (datos.resultado) {
    await tx
      .update(partidos)
      .set({ estado: 'jugado', ...datos.resultado })
      .where(eq(partidos.id, partidoId))
  }
  await tx.delete(participaciones).where(eq(participaciones.partidoId, partidoId))
  if (datos.participaciones.length > 0) {
    await tx.insert(participaciones).values(datos.participaciones.map((p) => ({ partidoId, ...p })))
  }
  await tx
    .delete(eventosPartido)
    .where(and(eq(eventosPartido.partidoId, partidoId), eq(eventosPartido.origen, origen)))
  if (datos.eventos.length > 0) {
    await tx.insert(eventosPartido).values(datos.eventos.map((e) => ({ partidoId, origen, ...e })))
  }
  await recalcular(tx, partidoId)
}
