import { OpenAPIHono } from '@hono/zod-openapi'
import { Scalar } from '@scalar/hono-api-reference'
import { manejarAutenticacion } from './autenticacion.js'
import { config } from './config.js'
import { recibirAvisoCsp } from './csp.js'
import { comprobarBaseDeDatos } from './db/cliente.js'
import { manejarError, rutaNoEncontrada, soloMismoOrigen, validacionFallida } from './errores.js'
import { registrarPeticiones } from './peticiones.js'
import { rutasActas } from './rutas/actas.js'
import { rutasCalendario } from './rutas/calendario.js'
import { rutasClubes } from './rutas/clubes.js'
import { rutasCuenta } from './rutas/cuenta.js'
import { rutasEjercicios } from './rutas/ejercicios.js'
import { rutasEntrenos } from './rutas/entrenos.js'
import { rutasEstadisticas, rutasEstadisticasClub } from './rutas/estadisticas.js'
import { rutasExportacion } from './rutas/exportacion.js'
import { rutasInvitacionesClub, rutasInvitacionesPlantilla } from './rutas/invitaciones.js'
import { rutasJugadoresClub, rutasJugadoresPlantilla } from './rutas/jugadores.js'
import { rutasMedios, rutasMediosClub } from './rutas/medios.js'
import { rutasMultas, rutasMultasJugadores } from './rutas/multas.js'
import { rutasNotas } from './rutas/notas.js'
import { rutasPartidos } from './rutas/partidos.js'
import { rutasModelosSesion, rutasPlanes } from './rutas/planes.js'
import { rutasPlanificacion } from './rutas/planificacion.js'
import { rutasPlantillas } from './rutas/plantillas.js'
import { rutasSalud } from './rutas/salud.js'
import { rutasVideos } from './rutas/videos.js'

export const infoOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'API de Vestuario',
    version: '1.7.0',
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

  // Avisos de violación de la CSP (GH-57): los manda el navegador, sin sesión y sin garantía de
  // que lleve Origin, así que van antes de la comprobación del origen
  app.post('/csp', recibirAvisoCsp)
  // Ninguna petición que modifique datos desde otro origen
  app.use(soloMismoOrigen(config.urlPublica))
  // Autenticación (Better Auth): /api/auth/sign-in/email, /sign-out, /get-session y /change-password,
  // con el bloqueo de cuentas y los eventos de seguridad
  app.on(['GET', 'POST'], '/auth/*', manejarAutenticacion)

  app.route('/', rutasSalud(d.comprobarBaseDeDatos))
  app.route('/', rutasCuenta())
  app.route('/', rutasClubes())
  app.route('/', rutasPlantillas())
  app.route('/', rutasJugadoresPlantilla())
  app.route('/', rutasJugadoresClub())
  app.route('/', rutasInvitacionesPlantilla())
  app.route('/', rutasInvitacionesClub())
  app.route('/', rutasEntrenos())
  // Antes que los partidos: en /partidos/calendario, «calendario» no es el id de un partido
  app.route('/', rutasCalendario())
  app.route('/', rutasPartidos())
  app.route('/', rutasEstadisticas())
  app.route('/', rutasEstadisticasClub())
  app.route('/', rutasExportacion())
  app.route('/', rutasActas())
  app.route('/', rutasVideos())
  app.route('/', rutasNotas())
  app.route('/', rutasPlanificacion())
  app.route('/', rutasEjercicios())
  app.route('/', rutasPlanes())
  app.route('/', rutasModelosSesion())
  app.route('/', rutasMediosClub())
  app.route('/', rutasMedios())
  app.route('/', rutasMultas())
  app.route('/', rutasMultasJugadores())

  if (d.documentacion) {
    app.doc31('/openapi.json', infoOpenApi)
    app.get('/docs', Scalar({ url: '/api/openapi.json', pageTitle: 'API de Vestuario' }))
  }

  return app
}

export type App = ReturnType<typeof crearApp>
