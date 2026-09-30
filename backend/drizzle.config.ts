import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  // DRIZZLE_OUT permite a db:check generar en una copia temporal sin tocar las migraciones reales
  out: process.env.DRIZZLE_OUT ?? './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
})
