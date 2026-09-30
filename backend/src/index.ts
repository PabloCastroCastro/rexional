import { serve } from '@hono/node-server'
import { Hono } from 'hono'

// Esqueleto mínimo (GH-2). La API base real, con configuración validada,
// conexión a la base de datos y OpenAPI, llega con GH-4.
const app = new Hono().basePath('/api')

app.get('/health', (c) => c.json({ estado: 'ok' }))

const port = Number(process.env.PORT ?? 3000)

const server = serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`Backend escuchando en el puerto ${info.port}`)
})

// Cierre ordenado al parar el contenedor
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
