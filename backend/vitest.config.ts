import { defineConfig } from 'vitest/config'
import { urlDeTest } from './test/bd.js'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/preparar-bd.ts'],
    // Configuración válida para cargar la app; la base de datos es siempre la de test
    env: {
      ENTORNO: 'pruebas',
      TZ: 'Europe/Madrid',
      DATABASE_URL: urlDeTest(),
      LOG_LEVEL: 'silent',
      BETTER_AUTH_SECRET: 'tests-sin-valor-real-0123456789abcdefghij',
      URL_PUBLICA: 'http://localhost:5173',
    },
    // Los archivos comparten la base de datos: se ejecutan de uno en uno
    fileParallelism: false,
  },
})
