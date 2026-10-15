import { sql } from 'drizzle-orm'
import { timestamp, uuid } from 'drizzle-orm/pg-core'

// Identificador UUID v7 generado por PostgreSQL 18: ordenado en el tiempo, indexa mejor que uno aleatorio
export const id = () => uuid('id').primaryKey().default(sql`uuidv7()`)

export const creadoEn = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

export const actualizadoEn = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())
