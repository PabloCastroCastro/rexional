import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { actualizadoEn, creadoEn, id } from './comun.js'

// Tablas de Better Auth. Los nombres de las propiedades son los que espera su adaptador de Drizzle.
// Los identificadores los genera PostgreSQL (uuidv7), así que Better Auth debe configurarse con
// advanced.database.generateId: false (GH-5).

export const user = pgTable('user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: creadoEn(),
  updatedAt: actualizadoEn(),
})

export const session = pgTable(
  'session',
  {
    id: id(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = pgTable(
  'account',
  {
    id: id(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = pgTable(
  'verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)
