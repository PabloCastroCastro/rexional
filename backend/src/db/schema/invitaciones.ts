import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { clubes, jugadores, plantillas, rol } from './clubes.js'
import { creadoEn, id } from './comun.js'

// Invitaciones (sección 6, GH-49): a una plantilla con un rol o como administrador del club. El
// enlace lleva un token de un solo uso; aquí solo se guarda su hash (SHA-256), nunca el token.
export const invitaciones = pgTable(
  'invitaciones',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    // Nula: invitación como administrador del club
    plantillaId: uuid('plantilla_id').references(() => plantillas.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    rol: rol('rol'),
    // Jugador del club al que se vinculará el usuario al aceptar
    jugadorId: uuid('jugador_id'),
    tokenHash: text('token_hash').notNull(),
    expira: timestamp('expira', { withTimezone: true }).notNull(),
    usadaEn: timestamp('usada_en', { withTimezone: true }),
    revocadaEn: timestamp('revocada_en', { withTimezone: true }),
    creadaPor: uuid('creada_por').references(() => user.id, { onDelete: 'set null' }),
    createdAt: creadoEn(),
  },
  (t) => [
    // El jugador, del mismo club que la invitación
    foreignKey({
      name: 'invitaciones_jugador_fk',
      columns: [t.jugadorId, t.clubId],
      foreignColumns: [jugadores.id, jugadores.clubId],
    }).onDelete('cascade'),
    uniqueIndex('invitaciones_token_unico').on(t.tokenHash),
    // Una sola pendiente por email en cada plantilla (o como administrador del club)
    uniqueIndex('invitaciones_una_pendiente')
      .on(
        t.clubId,
        sql`coalesce(${t.plantillaId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
        t.email,
      )
      .where(sql`${t.usadaEn} IS NULL AND ${t.revocadaEn} IS NULL`),
    index('invitaciones_plantilla_idx').on(t.plantillaId),
    check(
      'invitaciones_email_normalizado',
      sql`${t.email} = lower(btrim(${t.email})) AND ${t.email} <> ''`,
    ),
    // Con plantilla, un rol; como administrador del club, ninguno
    check('invitaciones_rol_con_plantilla', sql`(${t.plantillaId} IS NULL) = (${t.rol} IS NULL)`),
    check('invitaciones_jugador_rol', sql`${t.jugadorId} IS NULL OR ${t.rol} = 'jugador'`),
  ],
)
