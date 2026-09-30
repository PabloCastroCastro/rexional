// Exporta el contrato OpenAPI a backend/openapi.json (npm run openapi), del que el frontend genera su
// cliente, o comprueba que está al día (npm run openapi:check, lo ejecuta la CI).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// El contrato no depende del entorno ni de la base de datos: configuración mínima para cargar la app
// sin conectarse a nada (el pool de PostgreSQL no abre conexiones hasta la primera consulta)
Object.assign(process.env, {
  ENTORNO: 'pruebas',
  TZ: 'Europe/Madrid',
  DATABASE_URL: 'postgres://sin-conexion@localhost:5432/vestuario',
  LOG_LEVEL: 'silent',
  BETTER_AUTH_SECRET: 'contrato-openapi-sin-sesiones-0123456789',
  URL_PUBLICA: 'http://localhost',
})

const { crearApp, infoOpenApi } = await import('../app.js')

const archivo = fileURLToPath(new URL('../../openapi.json', import.meta.url))
const contrato = `${JSON.stringify(crearApp().getOpenAPI31Document(infoOpenApi), null, 2)}\n`

if (process.argv.includes('--check')) {
  const actual = existsSync(archivo) ? readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n') : ''
  if (actual !== contrato) {
    console.error('backend/openapi.json no coincide con la API. Actualízalo con: npm run openapi')
    process.exit(1)
  }
  console.log('backend/openapi.json está al día')
} else {
  writeFileSync(archivo, contrato)
  console.log('Contrato exportado a backend/openapi.json')
}

process.exit(0)
