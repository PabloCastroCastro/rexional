import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { fichas, plantillas } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Partidos de una plantilla, sus convocados y sus estadísticas: resultado, participaciones y eventos
// (sección 6)

export const estadoPartido = pgEnum('estado_partido', ['programado', 'jugado', 'aplazado'])

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
    estado: estadoPartido('estado').notNull().default('programado'),
    // Resultado desde el punto de vista de la plantilla; solo en los partidos jugados
    golesFavor: smallint('goles_favor'),
    golesContra: smallint('goles_contra'),
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
    // Un partido jugado tiene resultado, y solo los jugados lo tienen
    check(
      'partidos_resultado_si_jugado',
      sql`(${t.estado} = 'jugado') = (${t.golesFavor} IS NOT NULL AND ${t.golesContra} IS NOT NULL) AND (${t.golesFavor} IS NULL) = (${t.golesContra} IS NULL)`,
    ),
    check('partidos_goles_no_negativos', sql`${t.golesFavor} >= 0 AND ${t.golesContra} >= 0`),
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

// Titulares y suplentes de un partido jugado. Solo de jugadores convocados
export const participaciones = pgTable(
  'participaciones',
  {
    partidoId: uuid('partido_id').notNull(),
    jugadorId: uuid('jugador_id').notNull(),
    titular: boolean('titular').notNull(),
    // Se calculan a partir de la titularidad y los cambios; un suplente que no entra juega 0
    minutos: smallint('minutos'),
  },
  (t) => [
    primaryKey({ columns: [t.partidoId, t.jugadorId] }),
    foreignKey({
      name: 'participaciones_convocado_fk',
      columns: [t.partidoId, t.jugadorId],
      foreignColumns: [convocados.partidoId, convocados.jugadorId],
    }).onDelete('cascade'),
    index('participaciones_jugador_idx').on(t.jugadorId),
    check('participaciones_minutos_validos', sql`${t.minutos} BETWEEN 0 AND 150`),
  ],
)

export const tipoEvento = pgEnum('tipo_evento', [
  'gol',
  'asistencia',
  'amarilla',
  'roja',
  'entra',
  'sale',
  'gol_propia',
])

// De dónde viene una estadística: a mano, del acta del partido o de la federación
export const origenDato = pgEnum('origen_dato', ['manual', 'acta', 'federacion'])

// Lo que pasa en un partido, con jugador y minuto
export const eventosPartido = pgTable(
  'eventos_partido',
  {
    id: id(),
    partidoId: uuid('partido_id')
      .notNull()
      .references(() => partidos.id, { onDelete: 'cascade' }),
    // Siempre un convocado. Sin jugador solo el gol en propia puerta del rival a nuestro favor;
    // gol_propia con jugador es un gol en propia de uno de los nuestros
    jugadorId: uuid('jugador_id'),
    tipo: tipoEvento('tipo').notNull(),
    minuto: smallint('minuto'),
    origen: origenDato('origen').notNull().default('manual'),
    createdAt: creadoEn(),
  },
  (t) => [
    foreignKey({
      name: 'eventos_partido_convocado_fk',
      columns: [t.partidoId, t.jugadorId],
      foreignColumns: [convocados.partidoId, convocados.jugadorId],
    }).onDelete('cascade'),
    index('eventos_partido_partido_idx').on(t.partidoId),
    index('eventos_partido_jugador_idx').on(t.jugadorId),
    check('eventos_partido_jugador', sql`${t.jugadorId} IS NOT NULL OR ${t.tipo} = 'gol_propia'`),
    check('eventos_partido_minuto_valido', sql`${t.minuto} BETWEEN 0 AND 150`),
  ],
)

// Contenido binario (el PDF del acta)
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

// La ficha del partido en PDF que publica la federación, una por partido. Se guarda en la base de
// datos (pesa unos 50 KB, como mucho 2 MB): así entra en las copias de seguridad
export const actasPartido = pgTable(
  'actas_partido',
  {
    partidoId: uuid('partido_id')
      .primaryKey()
      .references(() => partidos.id, { onDelete: 'cascade' }),
    pdf: bytea('pdf').notNull(),
    nombreArchivo: text('nombre_archivo').notNull(),
    tamano: integer('tamano').notNull(),
    subidaPor: uuid('subida_por').references(() => user.id, { onDelete: 'set null' }),
    subidaEn: timestamp('subida_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('actas_partido_tamano', sql`${t.tamano} BETWEEN 1 AND 2097152`),
    check('actas_partido_nombre_no_vacio', sql`btrim(${t.nombreArchivo}) <> ''`),
  ],
)
