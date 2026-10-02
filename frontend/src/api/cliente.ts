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

// Devuelve los datos o lanza un ErrorApi, para usarlo en las consultas de TanStack Query:
//   useQuery({ queryKey: ['salud'], queryFn: () => datos(api.GET('/api/health')) })
export async function datos<T>(peticion: Promise<Respuesta<T>>): Promise<T> {
  const { data, error, response } = await peticion
  if (response.ok && data !== undefined) return data
  const cuerpo = (
    error as { error?: { codigo?: string; mensaje?: string; detalles?: unknown } } | undefined
  )?.error
  throw new ErrorApi(
    response.status,
    cuerpo?.codigo ?? 'error',
    cuerpo?.mensaje ?? 'No se ha podido conectar con el servidor. Inténtalo de nuevo.',
    cuerpo?.detalles,
  )
}
