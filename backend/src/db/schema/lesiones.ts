import { sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { clubes, jugadores } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Lesiones de los jugadores (GH-230). Son del jugador en el club, no de una plantilla: un lesionado
// lo está también donde juega de invitado. Sin datos médicos: solo las fechas y, como mucho, una nota
// corta para el cuerpo técnico. Las que terminan con un alta se quedan como historial.
export const lesiones = pgTable(
  'lesiones',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    jugadorId: uuid('jugador_id').notNull(),
    desde: date('desde').notNull(),
    vueltaPrevista: date('vuelta_prevista'),
    // Vacía mientras dura
    alta: date('alta'),
    nota: text('nota'),
    createdAt: creadoEn(),
  },
  (t) => [
    // El jugador, del mismo club
    foreignKey({
      name: 'lesiones_jugador_fk',
      columns: [t.jugadorId, t.clubId],
      foreignColumns: [jugadores.id, jugadores.clubId],
    }).onDelete('cascade'),
    index('lesiones_jugador_idx').on(t.jugadorId),
    // Como mucho una lesión abierta por jugador
    uniqueIndex('lesiones_una_abierta').on(t.jugadorId).where(sql`${t.alta} IS NULL`),
    check(
      'lesiones_vuelta_posterior',
      sql`${t.vueltaPrevista} IS NULL OR ${t.vueltaPrevista} >= ${t.desde}`,
    ),
    check('lesiones_alta_posterior', sql`${t.alta} IS NULL OR ${t.alta} >= ${t.desde}`),
    check(
      'lesiones_nota_valida',
      sql`${t.nota} IS NULL OR (btrim(${t.nota}) <> '' AND char_length(${t.nota}) <= 140)`,
    ),
  ],
)
