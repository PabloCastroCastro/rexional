import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { fichas, plantillas } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Partidos de una plantilla y sus convocados (sección 6). El estado y el resultado llegan en el
// ciclo 6, con su propia migración.

const noVacioOpcional = (columna: AnyPgColumn) => sql`${columna} IS NULL OR btrim(${columna}) <> ''`

export const partidos = pgTable(
  'partidos',
  {
    id: id(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    rival: text('rival').notNull(),
    competicion: text('competicion'),
    // Día y horas en Europe/Madrid
    fecha: date('fecha').notNull(),
    hora: time('hora'),
    horaCitacion: time('hora_citacion'),
    lugar: text('lugar'),
    // true en casa, false fuera; null si es en campo neutral o no se sabe
    local: boolean('local'),
    createdAt: creadoEn(),
  },
  (t) => [
    // Destino de la clave foránea compuesta de convocados (misma plantilla)
    unique('partidos_id_plantilla').on(t.id, t.plantillaId),
    index('partidos_plantilla_fecha_idx').on(t.plantillaId, t.fecha),
    check('partidos_rival_no_vacio', sql`btrim(${t.rival}) <> ''`),
    check('partidos_competicion_no_vacia', noVacioOpcional(t.competicion)),
    check('partidos_lugar_no_vacio', noVacioOpcional(t.lugar)),
    // La citación es antes del partido (o a la vez)
    check(
      'partidos_citacion_antes',
      sql`${t.hora} IS NULL OR ${t.horaCitacion} IS NULL OR ${t.horaCitacion} <= ${t.hora}`,
    ),
  ],
)

export const convocados = pgTable(
  'convocados',
  {
    partidoId: uuid('partido_id').notNull(),
    jugadorId: uuid('jugador_id').notNull(),
    // Copia de la plantilla del partido: garantiza que el jugador tiene ficha en ella. Que la ficha
    // esté activa se comprueba al convocar; si después causa baja, la convocatoria se conserva.
    plantillaId: uuid('plantilla_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.partidoId, t.jugadorId] }),
    foreignKey({
      name: 'convocados_partido_fk',
      columns: [t.partidoId, t.plantillaId],
      foreignColumns: [partidos.id, partidos.plantillaId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'convocados_ficha_fk',
      columns: [t.plantillaId, t.jugadorId],
      foreignColumns: [fichas.plantillaId, fichas.jugadorId],
    }).onDelete('cascade'),
    // Partidos de un jugador (estadísticas y trayectoria)
    index('convocados_jugador_idx').on(t.jugadorId),
  ],
)
