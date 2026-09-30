import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as schema from './schema/index.js'

// Conexión mínima (GH-3). GH-4 añade la configuración validada, el tamaño del pool y el healthcheck.
const url = process.env.DATABASE_URL
if (!url) throw new Error('Falta la variable de entorno DATABASE_URL')

export const pool = new pg.Pool({ connectionString: url })

export const db = drizzle(pool, { schema })

export type Db = typeof db
