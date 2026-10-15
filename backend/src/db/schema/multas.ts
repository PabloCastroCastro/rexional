import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { fichas, plantillas } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Catálogo de motivos y multas de cada plantilla (secciones 2.5 y 6). La caja es de la plantilla, así
// que empieza de cero cada temporada. Los importes van en céntimos enteros: las sumas son exactas.
// La multa originada por una tarjeta (evento_id) llega con las estadísticas, en el ciclo 6.

export const tipoTarjeta = pgEnum('tipo_tarjeta', ['amarilla', 'roja'])

export const motivosMulta = pgTable(
  'motivos_multa',
  {
    id: id(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    descripcion: text('descripcion').notNull(),
    importeCentimos: integer('importe_centimos').notNull(),
    // Tarjeta que propone este motivo al registrar estadísticas (ciclo 6)
    tipoTarjeta: tipoTarjeta('tipo_tarjeta'),
    // Los motivos no se borran: se desactivan y las multas conservan el suyo
    activo: boolean('activo').notNull().default(true),
    createdAt: creadoEn(),
  },
  (t) => [
    // Destino de la clave foránea compuesta de multas (motivo de la misma plantilla)
    unique('motivos_multa_id_plantilla').on(t.id, t.plantillaId),
    uniqueIndex('motivos_multa_descripcion_unica_activos')
      .on(t.plantillaId, sql`lower(btrim(${t.descripcion}))`)
      .where(sql`${t.activo}`),
    check('motivos_multa_descripcion_no_vacia', sql`btrim(${t.descripcion}) <> ''`),
    check('motivos_multa_importe_no_negativo', sql`${t.importeCentimos} >= 0`),
  ],
)

export const multas = pgTable(
  'multas',
  {
    id: id(),
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    jugadorId: uuid('jugador_id').notNull(),
    // Del catálogo de la plantilla, o null si es «otro» con texto libre
    motivoId: uuid('motivo_id'),
    // Copias del motivo y del importe: cambiar el catálogo no altera las multas
    motivo: text('motivo').notNull(),
    importeCentimos: integer('importe_centimos').notNull(),
    fecha: date('fecha').notNull(),
    // Cobrada si y solo si tiene fecha de pago
    fechaPago: date('fecha_pago'),
    creadaPor: uuid('creada_por').references(() => user.id, { onDelete: 'set null' }),
    createdAt: creadoEn(),
  },
  (t) => [
    // Solo jugadores con ficha en la plantilla
    foreignKey({
      name: 'multas_ficha_fk',
      columns: [t.plantillaId, t.jugadorId],
      foreignColumns: [fichas.plantillaId, fichas.jugadorId],
    }).onDelete('cascade'),
    // El motivo es del catálogo de la misma plantilla. Sin acción al borrar: los motivos se
    // desactivan, y al borrar la plantilla se van a la vez motivos y multas.
    foreignKey({
      name: 'multas_motivo_fk',
      columns: [t.motivoId, t.plantillaId],
      foreignColumns: [motivosMulta.id, motivosMulta.plantillaId],
    }),
    index('multas_plantilla_jugador_idx').on(t.plantillaId, t.jugadorId),
    check('multas_motivo_no_vacio', sql`btrim(${t.motivo}) <> ''`),
    check('multas_importe_positivo', sql`${t.importeCentimos} > 0`),
    check('multas_pago_posterior', sql`${t.fechaPago} IS NULL OR ${t.fechaPago} >= ${t.fecha}`),
  ],
)
