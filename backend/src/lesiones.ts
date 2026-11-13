import { z } from '@hono/zod-openapi'
import { type SQL, sql } from 'drizzle-orm'
import { config } from './config.js'
import { fichas } from './db/schema/index.js'
import { type Rol, rolAlcanza } from './permisos.js'

// Lesiones en las listas de jugadores (GH-230): la que tiene cada uno en un día, con lo justo para
// verla (desde cuándo y cuándo se espera que vuelva). La nota y el historial van aparte, solo para el
// cuerpo técnico.

export const EsquemaLesionActual = z
  .object({
    desde: z.string().openapi({ example: '2026-11-03' }),
    vueltaPrevista: z.string().nullable().openapi({ example: '2026-11-17' }),
  })
  .nullable()
  .openapi('LesionActual', {
    description:
      'La lesión que tiene ese día, o null. Al rol jugador solo le llega la suya: la de los demás, siempre null',
  })

export type LesionActual = { desde: string; vueltaPrevista: string | null } | null

// Hoy en la zona horaria de la aplicación, en SQL: sirve en columnas que se definen una vez
export const hoySql = sql`(now() at time zone ${config.zonaHoraria})::date`

// La lesión del jugador de la ficha en un día: empezó ese día o antes y no tiene alta, o el alta es
// posterior (el día del alta ya está recuperado). Para consultas sobre fichas sin alias
export const lesionEn = (fecha: SQL | string) => sql<LesionActual>`(
  select json_build_object('desde', l.desde, 'vueltaPrevista', l.vuelta_prevista)
  from lesiones l
  where l.jugador_id = ${fichas.jugadorId}
    and l.desde <= ${fecha}::date
    and (l.alta is null or l.alta > ${fecha}::date)
  order by l.desde desc
  limit 1
)`

// Es un dato de salud: el cuerpo técnico ve la de todos; el rol jugador, solo la suya
export function lesionesVisibles<T extends { jugadorId: string; lesion: LesionActual }>(
  filas: T[],
  acceso: { rol: Rol; jugadorId: string | null },
): T[] {
  if (rolAlcanza(acceso.rol, 'delegado')) return filas
  return filas.map((f) => (f.jugadorId === acceso.jugadorId ? f : { ...f, lesion: null }))
}
