import type { MiddlewareHandler } from 'hono'
import { logger } from './logger.js'

// Registra cada petición: método, ruta, estado y duración. Sin cuerpos, cabeceras ni parámetros de
// consulta, para no registrar datos personales ni credenciales.
export const registrarPeticiones = (): MiddlewareHandler => async (c, next) => {
  const inicio = performance.now()
  await next()
  const estado = c.res.status
  const datos = {
    metodo: c.req.method,
    ruta: c.req.routePath,
    url: c.req.path,
    estado,
    ms: Math.round(performance.now() - inicio),
  }
  if (estado >= 500) logger.error(datos, 'Petición')
  else if (estado >= 400) logger.warn(datos, 'Petición')
  // El healthcheck de Docker llama cada pocos segundos: solo se ve con LOG_LEVEL=debug
  else if (c.req.path === '/api/health') logger.debug(datos, 'Petición')
  else logger.info(datos, 'Petición')
}
