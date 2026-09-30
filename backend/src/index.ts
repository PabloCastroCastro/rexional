import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { pool } from './db/cliente.js'
import { migrar } from './db/migrar.js'

// Esqueleto mínimo. La API base real, con configuración validada, healthcheck de la base de datos
// y OpenAPI, llega con GH-4.
const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ estado: 'ok' }))

// Las migraciones pendientes se aplican antes de aceptar peticiones
try {
  await migrar()
  console.log('Migraciones de la base de datos al día')
} catch (error) {
  console.error('No se pudieron aplicar las migraciones', error)
  process.exit(1)
}

const port = Number(process.env.PORT ?? 3000)

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Backend escuchando en el puerto ${info.port}`)
})

// Cierre ordenado al parar el contenedor
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      pool.end().finally(() => process.exit(0))
    })
  })
}
