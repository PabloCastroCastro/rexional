import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { config } from '../config.js'
import { logger } from '../logger.js'
import * as schema from './schema/index.js'

export const pool = new pg.Pool({
  connectionString: config.baseDeDatos.url,
  max: config.baseDeDatos.poolMax,
  connectionTimeoutMillis: config.baseDeDatos.timeoutConexionMs,
})

// Un error en una conexión inactiva (p. ej. PostgreSQL reiniciado) no debe tumbar el proceso
pool.on('error', (error) =>
  logger.warn({ err: error }, 'Error en una conexión inactiva de PostgreSQL'),
)

export const db = drizzle(pool, { schema })

export type Db = typeof db

// true si PostgreSQL responde a tiempo; lo usa GET /api/health
export async function comprobarBaseDeDatos(timeoutMs = 2000): Promise<boolean> {
  let temporizador: NodeJS.Timeout | undefined
  const limite = new Promise<never>((_, rechazar) => {
    temporizador = setTimeout(
      () => rechazar(new Error(`Sin respuesta en ${timeoutMs} ms`)),
      timeoutMs,
    )
  })
  try {
    await Promise.race([pool.query('select 1'), limite])
    return true
  } catch (error) {
    logger.warn({ err: error }, 'La base de datos no responde')
    return false
  } finally {
    clearTimeout(temporizador)
  }
}
