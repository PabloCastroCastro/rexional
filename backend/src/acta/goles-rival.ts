import { and, asc, eq, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/cliente.js'
import { actasPartido, clubes, eventosPartido, partidos, plantillas } from '../db/schema/index.js'
import { ErrorApi } from '../errores.js'
import { bloquearPartido, recalcular } from '../estadisticas.js'
import { construirLectura, golesDelRival } from './lectura.js'
import { ActaNoLegible, leerActa } from './leer.js'

// Completa los goles del rival de los partidos registrados antes de GH-151: vuelve a leer el acta
// guardada y añade sus goles en contra como gol_rival con la fuente «acta». No toca nada más. Un
// partido que ya tiene goles del rival se salta, así que se puede repetir sin duplicar. Sin
// `aplicar`, cada partido se deshace al terminar y solo se informa de lo que se haría.

export type ResultadoPartido = {
  partidoId: string
  fecha: string
  rival: string
  estado: 'anadidos' | 'ya_tenia' | 'sin_goles' | 'no_legible' | 'incoherente'
  minutos: (number | null)[]
  detalle?: string
}

class Simulacion extends Error {}

export async function completarGolesRival(
  db: Db,
  { aplicar }: { aplicar: boolean },
): Promise<ResultadoPartido[]> {
  const conActa = await db
    .select({
      id: partidos.id,
      fecha: partidos.fecha,
      rival: partidos.rival,
      local: partidos.local,
      club: clubes.nombre,
      pdf: actasPartido.pdf,
    })
    .from(partidos)
    .innerJoin(actasPartido, eq(actasPartido.partidoId, partidos.id))
    .innerJoin(plantillas, eq(plantillas.id, partidos.plantillaId))
    .innerJoin(clubes, eq(clubes.id, plantillas.clubId))
    .where(eq(partidos.estado, 'jugado'))
    .orderBy(asc(partidos.fecha))

  const resultados: ResultadoPartido[] = []
  for (const p of conActa) {
    const base = { partidoId: p.id, fecha: p.fecha, rival: p.rival }
    let goles: ReturnType<typeof golesDelRival>
    try {
      const ficha = await leerActa(p.pdf)
      // Sin candidatos ni correcciones: el gol en propia de los nuestros se distingue igual, por
      // los nombres de nuestra columna del acta, pero queda sin jugador
      const lectura = construirLectura(ficha, p, p.club, [])
      // Esos goles en propia ya se guardaron con su jugador al confirmar el acta: se reconocen por
      // el minuto y no se repiten como gol del rival
      const propias = await db
        .select({ minuto: eventosPartido.minuto })
        .from(eventosPartido)
        .where(
          and(
            eq(eventosPartido.partidoId, p.id),
            eq(eventosPartido.tipo, 'gol_propia'),
            isNotNull(eventosPartido.jugadorId),
          ),
        )
      const enContra = [...lectura.golesEnContra]
      for (const { minuto } of propias) {
        const i = enContra.findIndex((g) => g.enPropia && g.minuto === minuto)
        if (i >= 0) enContra.splice(i, 1)
      }
      goles = golesDelRival({ ...lectura, golesEnContra: enContra })
    } catch (error) {
      if (!(error instanceof ActaNoLegible)) throw error
      resultados.push({ ...base, estado: 'no_legible', minutos: [], detalle: error.message })
      continue
    }
    const minutos = goles.map((g) => g.minuto)
    if (goles.length === 0) {
      resultados.push({ ...base, estado: 'sin_goles', minutos })
      continue
    }

    try {
      await db.transaction(async (tx) => {
        await bloquearPartido(tx, p.id)
        const ya = await tx
          .select({ id: eventosPartido.id })
          .from(eventosPartido)
          .where(and(eq(eventosPartido.partidoId, p.id), eq(eventosPartido.tipo, 'gol_rival')))
          .limit(1)
        if (ya.length > 0) {
          resultados.push({ ...base, estado: 'ya_tenia', minutos })
          return
        }
        await tx
          .insert(eventosPartido)
          .values(goles.map((g) => ({ ...g, partidoId: p.id, origen: 'acta' as const })))
        await recalcular(tx, p.id)
        resultados.push({ ...base, estado: 'anadidos', minutos })
        if (!aplicar) throw new Simulacion()
      })
    } catch (error) {
      if (error instanceof Simulacion) continue
      if (!(error instanceof ErrorApi)) throw error
      resultados.push({ ...base, estado: 'incoherente', minutos, detalle: error.message })
    }
  }
  return resultados
}
