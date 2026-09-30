import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { EsquemaError, validacionFallida } from '../errores.js'

const EsquemaSalud = z
  .object({
    estado: z
      .enum(['ok', 'error'])
      .openapi({ description: 'ok solo si todos los componentes funcionan' }),
    api: z.literal('ok'),
    baseDeDatos: z.enum(['ok', 'error']),
  })
  .openapi('Salud')

const ruta = createRoute({
  method: 'get',
  path: '/health',
  tags: ['Salud'],
  summary: 'Estado de la API y de la base de datos',
  description:
    'Lo usa el healthcheck de Docker: responde 503 si la base de datos no está disponible.',
  responses: {
    200: {
      description: 'Todo funciona',
      content: { 'application/json': { schema: EsquemaSalud } },
    },
    503: {
      description: 'La base de datos no responde',
      content: { 'application/json': { schema: EsquemaSalud } },
    },
    500: {
      description: 'Error inesperado',
      content: { 'application/json': { schema: EsquemaError } },
    },
  },
})

export const rutasSalud = (comprobarBaseDeDatos: () => Promise<boolean>) =>
  new OpenAPIHono({ defaultHook: validacionFallida }).openapi(ruta, async (c) => {
    if (await comprobarBaseDeDatos()) {
      return c.json({ estado: 'ok', api: 'ok', baseDeDatos: 'ok' } as const, 200)
    }
    return c.json({ estado: 'error', api: 'ok', baseDeDatos: 'error' } as const, 503)
  })
