import { serve } from '@hono/node-server'
import { crearApp } from './app.js'
import { config } from './config.js'
import { pool } from './db/cliente.js'
import { migrar } from './db/migrar.js'
import { logger } from './logger.js'

// Las migraciones pendientes se aplican antes de aceptar peticiones
try {
  await migrar()
  logger.info('Migraciones de la base de datos al día')
} catch (error) {
  logger.fatal({ err: error }, 'No se pudieron aplicar las migraciones')
  process.exit(1)
}

const server = serve(
  { fetch: crearApp().fetch, port: config.puerto, hostname: '0.0.0.0' },
  (info) => {
    logger.info({ puerto: info.port }, `Backend escuchando en el puerto ${info.port}`)
  },
)

// Cierre ordenado al parar el contenedor
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, 'Parando el backend')
    server.close(() => {
      pool.end().finally(() => process.exit(0))
    })
  })
}
