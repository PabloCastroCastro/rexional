import { fileURLToPath } from 'node:url'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db } from './cliente.js'

// backend/drizzle, tanto desde src/db (tsx) como desde dist/db (compilado)
const carpeta = fileURLToPath(new URL('../../drizzle', import.meta.url))

// Aplica las migraciones pendientes. Drizzle registra las aplicadas en drizzle.__drizzle_migrations.
export async function migrar() {
  await migrate(db, { migrationsFolder: carpeta })
}
