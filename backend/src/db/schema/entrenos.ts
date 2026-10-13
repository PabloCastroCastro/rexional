import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { fichas, plantillas } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Entrenos de una plantilla y la asistencia de sus jugadores (sección 6). Las columnas de la
// planificación (hora, objetivo, modelos de sesión) llegan en el ciclo 7.

export const estadoAsistencia = pgEnum('estado_asistencia', ['asiste', 'justificada', 'falta'])

export const entrenos = pgTable(
  'entrenos',
  {
    id: id(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    // Día del entreno en Europe/Madrid
    fecha: date('fecha').notNull(),
    notas: text('notas'),
    createdAt: creadoEn(),
  },
  (t) => [
    unique('entrenos_fecha_unica').on(t.plantillaId, t.fecha),
    // Destino de la clave foránea compuesta de asistencias (misma plantilla)
    unique('entrenos_id_plantilla').on(t.id, t.plantillaId),
  ],
)

export const asistencias = pgTable(
  'asistencias',
  {
    entrenoId: uuid('entreno_id').notNull(),
    jugadorId: uuid('jugador_id').notNull(),
    // Copia de la plantilla del entreno: garantiza que el jugador tiene ficha en ella
    plantillaId: uuid('plantilla_id').notNull(),
    estado: estadoAsistencia('estado').notNull(),
    motivo: text('motivo'),
  },
  (t) => [
    primaryKey({ columns: [t.entrenoId, t.jugadorId] }),
    foreignKey({
      name: 'asistencias_entreno_fk',
      columns: [t.entrenoId, t.plantillaId],
      foreignColumns: [entrenos.id, entrenos.plantillaId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'asistencias_ficha_fk',
      columns: [t.plantillaId, t.jugadorId],
      foreignColumns: [fichas.plantillaId, fichas.jugadorId],
    }).onDelete('cascade'),
    // Porcentaje de asistencia y trayectoria de un jugador
    index('asistencias_jugador_idx').on(t.jugadorId),
    // El motivo solo acompaña a una falta justificada, y nunca vacío
    check(
      'asistencias_motivo_justificada',
      sql`${t.motivo} IS NULL OR (${t.estado} = 'justificada' AND btrim(${t.motivo}) <> '')`,
    ),
  ],
)
