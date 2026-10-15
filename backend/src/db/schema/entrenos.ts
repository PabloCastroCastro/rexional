import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { fichas, plantillas } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Entrenos de una plantilla, su horario semanal y la asistencia de sus jugadores (sección 6). Los
// entrenos se planifican antes de pasar lista: los crea el horario o se crean sueltos, y un día puede
// tener varios (doble sesión). El resto de la planificación (objetivo, modelos de sesión) llega en el
// ciclo 7.

export const estadoAsistencia = pgEnum('estado_asistencia', ['asiste', 'justificada', 'falta'])

export const entrenos = pgTable(
  'entrenos',
  {
    id: id(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    // Día y hora del entreno en Europe/Madrid; la hora es opcional
    fecha: date('fecha').notNull(),
    hora: time('hora'),
    // Opcional; si se indica, posterior a la hora de inicio (que entonces es obligatoria)
    horaFin: time('hora_fin'),
    // true si lo creó el horario de la plantilla: al cambiar el horario se rehacen estos
    deHorario: boolean('de_horario').notNull().default(false),
    notas: text('notas'),
    createdAt: creadoEn(),
  },
  (t) => [
    // Varios entrenos por día, pero no dos a la misma hora (ni dos sin hora)
    unique('entrenos_fecha_hora_unica').on(t.plantillaId, t.fecha, t.hora).nullsNotDistinct(),
    check(
      'entrenos_hora_fin_posterior',
      sql`${t.horaFin} IS NULL OR (${t.hora} IS NOT NULL AND ${t.horaFin} > ${t.hora})`,
    ),
    // Destino de la clave foránea compuesta de asistencias (misma plantilla)
    unique('entrenos_id_plantilla').on(t.id, t.plantillaId),
  ],
)

// Sesiones de la semana: día (1 lunes … 7 domingo), hora "HH:MM" y hora de fin opcional
export type SesionHorario = { dia: number; hora: string; horaFin?: string | null }

// Horario semanal de la plantilla (uno por plantilla): al guardarlo se crean sus entrenos entre
// desde y hasta
export const horarios = pgTable(
  'horarios',
  {
    plantillaId: uuid('plantilla_id')
      .primaryKey()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    desde: date('desde').notNull(),
    hasta: date('hasta').notNull(),
    sesiones: jsonb('sesiones').$type<SesionHorario[]>().notNull(),
    createdAt: creadoEn(),
  },
  (t) => [check('horarios_hasta_posterior', sql`${t.hasta} >= ${t.desde}`)],
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
