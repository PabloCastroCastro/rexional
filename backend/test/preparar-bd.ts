import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'
import { nombreBaseDeDatos, urlDeTest } from './bd.js'

// Se ejecuta una vez antes de todos los tests: crea la base de datos de test si no existe y le
// aplica las migraciones
export default async function prepararBaseDeDatos() {
  const url = urlDeTest()
  const nombre = nombreBaseDeDatos(url)

  const servidor = new URL(url)
  servidor.pathname = '/postgres'
  const cliente = new pg.Client({ connectionString: servidor.toString() })
  await cliente.connect()
  try {
    const existe = await cliente.query('select 1 from pg_database where datname = $1', [nombre])
    if (existe.rowCount === 0) {
      await cliente.query(`create database "${nombre.replaceAll('"', '""')}"`)
    }
  } finally {
    await cliente.end()
  }

  const pool = new pg.Pool({ connectionString: url })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' })
  } finally {
    await pool.end()
  }
}
