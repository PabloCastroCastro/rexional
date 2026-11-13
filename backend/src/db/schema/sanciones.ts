import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { fichas } from './clubes.js'
import { creadoEn, id } from './comun.js'
import { partidos } from './partidos.js'

// Sanciones (GH-231). No se guardan: se calculan con las tarjetas de los partidos jugados y las reglas
// de la plantilla. Aquí solo van las correcciones a mano de una sanción concreta (las decide el comité
// de competición): otro número de partidos, o 0 para anularla.
export const tipoSancion = pgEnum('tipo_sancion', ['roja', 'doble_amarilla', 'ciclo'])

export const ajustesSancion = pgTable(
  'ajustes_sancion',
  {
    id: id(),
    plantillaId: uuid('plantilla_id').notNull(),
    // El partido en el que se vio la tarjeta que la causa
    partidoId: uuid('partido_id').notNull(),
    jugadorId: uuid('jugador_id').notNull(),
    tipo: tipoSancion('tipo').notNull(),
    partidos: smallint('partidos').notNull(),
    nota: text('nota'),
    createdAt: creadoEn(),
  },
  (t) => [
    unique('ajustes_sancion_unico').on(t.partidoId, t.jugadorId, t.tipo),
    foreignKey({
      name: 'ajustes_sancion_partido_fk',
      columns: [t.partidoId, t.plantillaId],
      foreignColumns: [partidos.id, partidos.plantillaId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'ajustes_sancion_ficha_fk',
      columns: [t.plantillaId, t.jugadorId],
      foreignColumns: [fichas.plantillaId, fichas.jugadorId],
    }).onDelete('cascade'),
    check('ajustes_sancion_partidos_validos', sql`${t.partidos} BETWEEN 0 AND 20`),
    check(
      'ajustes_sancion_nota_valida',
      sql`${t.nota} IS NULL OR (btrim(${t.nota}) <> '' AND char_length(${t.nota}) <= 140)`,
    ),
  ],
)
