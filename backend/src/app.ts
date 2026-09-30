import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { config } from './config.js'
import { comprobarBaseDeDatos } from './db/cliente.js'
import { manejarError, rutaNoEncontrada, validacionFallida } from './errores.js'
import { registrarPeticiones } from './peticiones.js'
import { rutasSalud } from './rutas/salud.js'

export const infoOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'API de Vestuario',
    version: '0.1.0',
    description:
      'API REST de Vestuario. Todas las rutas cuelgan de /api. Errores con el formato { error: { codigo, mensaje, detalles? } }.',
  },
}

type Dependencias = {
  comprobarBaseDeDatos: () => Promise<boolean>
  // Documentación interactiva y contrato en /api/docs y /api/openapi.json
  documentacion: boolean
}

// Las dependencias se pueden sustituir en los tests
export function crearApp(dependencias: Partial<Dependencias> = {}) {
  const d: Dependencias = {
    comprobarBaseDeDatos,
    documentacion: config.entorno !== 'produccion',
    ...dependencias,
  }

  const app = new OpenAPIHono({ defaultHook: validacionFallida }).basePath('/api')

  app.use(registrarPeticiones())
  app.onError(manejarError)
  app.notFound(rutaNoEncontrada)

  app.route('/', rutasSalud(d.comprobarBaseDeDatos))

  if (d.documentacion) {
    app.doc31('/openapi.json', infoOpenApi)
    app.get('/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'API de Vestuario' }))
  }

  return app
}

export type App = ReturnType<typeof crearApp>
