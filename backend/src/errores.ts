import type { Hook } from '@hono/zod-openapi'
import { z } from '@hono/zod-openapi'
import type { Context, Env, ErrorHandler, NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { logger } from './logger.js'

// Formato común de error de la API (sección 7): { error: { codigo, mensaje, detalles? } }

export const EsquemaError = z
  .object({
    error: z.object({
      codigo: z.string().openapi({ example: 'validacion' }),
      mensaje: z.string().openapi({ example: 'Los datos enviados no son válidos' }),
      detalles: z.unknown().optional(),
    }),
  })
  .openapi('Error')

export type CuerpoError = z.infer<typeof EsquemaError>

export const cuerpoError = (codigo: string, mensaje: string, detalles?: unknown): CuerpoError => ({
  error: detalles === undefined ? { codigo, mensaje } : { codigo, mensaje, detalles },
})

// Error de negocio con código y estado HTTP, para lanzarlo desde cualquier ruta o servicio
export class ErrorApi extends Error {
  constructor(
    public readonly estado: ContentfulStatusCode,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje)
    this.name = 'ErrorApi'
  }
}

const porEstado: Partial<Record<number, [codigo: string, mensaje: string]>> = {
  400: ['peticion_invalida', 'La petición no es válida'],
  401: ['no_autenticado', 'Tienes que iniciar sesión'],
  403: ['sin_permiso', 'No tienes permiso para hacer esto'],
  404: ['no_encontrado', 'No se ha encontrado lo que buscas'],
  413: ['demasiado_grande', 'La petición supera el tamaño máximo permitido'],
}

export const manejarError: ErrorHandler = (error, c) => {
  if (error instanceof ErrorApi) {
    return c.json(cuerpoError(error.codigo, error.message, error.detalles), error.estado)
  }
  if (error instanceof HTTPException && error.status < 500) {
    const [codigo, mensaje] = porEstado[error.status] ?? [
      'error',
      'No se ha podido completar la petición',
    ]
    return c.json(cuerpoError(codigo, mensaje), error.status)
  }
  // Error inesperado: se registra completo, pero al cliente no se le dan detalles internos
  logger.error({ err: error, metodo: c.req.method, ruta: c.req.path }, 'Error no controlado')
  return c.json(
    cuerpoError(
      'error_interno',
      'Se ha producido un error inesperado. Inténtalo de nuevo más tarde.',
    ),
    500,
  )
}

export const rutaNoEncontrada: NotFoundHandler = (c) =>
  c.json(cuerpoError('no_encontrado', `No existe la ruta ${c.req.method} ${c.req.path}`), 404)

// Errores de validación de Zod: 400 con los campos que fallan
export const validacionFallida: Hook<unknown, Env, string, unknown> = (resultado, c: Context) => {
  if (!resultado.success) {
    const detalles = resultado.error.issues.map((i) => ({
      campo: i.path.join('.'),
      mensaje: i.message,
    }))
    return c.json(cuerpoError('validacion', 'Los datos enviados no son válidos', detalles), 400)
  }
}
