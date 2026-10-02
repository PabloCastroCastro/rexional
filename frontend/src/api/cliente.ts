import createClient from 'openapi-fetch'
import type { paths } from './esquema'

// Cliente tipado de la API. Los tipos se generan del contrato del backend (npm run api:generar), así
// que una ruta o un campo que no exista no compila. Las peticiones van al mismo origen (/api), con la
// cookie de sesión.
export const api = createClient<paths>({
  baseUrl: globalThis.location?.origin ?? '',
  credentials: 'same-origin',
  // fetch se resuelve en cada petición (y no al crear el cliente), para poder simularlo en los tests
  fetch: (peticion) => globalThis.fetch(peticion),
})

// Error de la API con el formato común { error: { codigo, mensaje, detalles? } }
export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje)
    this.name = 'ErrorApi'
  }
}

type Respuesta<T> = { data?: T; error?: unknown; response: Response }

function errorDe(respuesta: Respuesta<unknown>): ErrorApi {
  const cuerpo = (
    respuesta.error as
      | { error?: { codigo?: string; mensaje?: string; detalles?: unknown } }
      | undefined
  )?.error
  return new ErrorApi(
    respuesta.response.status,
    cuerpo?.codigo ?? 'error',
    cuerpo?.mensaje ?? 'No se ha podido conectar con el servidor. Inténtalo de nuevo.',
    cuerpo?.detalles,
  )
}

// Devuelve los datos o lanza un ErrorApi, para usarlo en las consultas de TanStack Query:
//   useQuery({ queryKey: ['salud'], queryFn: () => datos(api.GET('/api/health')) })
export async function datos<T>(peticion: Promise<Respuesta<T>>): Promise<T> {
  const respuesta = await peticion
  if (respuesta.response.ok && respuesta.data !== undefined) return respuesta.data
  throw errorDe(respuesta)
}

// Para operaciones sin datos de respuesta (204: borrar, retirar…): solo comprueba que ha ido bien
export async function enviar(peticion: Promise<Respuesta<unknown>>): Promise<void> {
  const respuesta = await peticion
  if (!respuesta.response.ok) throw errorDe(respuesta)
}

// Errores de validación de la API por campo: { campo: mensaje }
export function erroresPorCampo(error: unknown): Record<string, string> {
  if (!(error instanceof ErrorApi) || !Array.isArray(error.detalles)) return {}
  return Object.fromEntries(
    (error.detalles as { campo: string; mensaje: string }[]).map((d) => [d.campo, d.mensaje]),
  )
}
