import { z } from 'zod'

// Mensajes de validación de Zod en español para toda la aplicación. Va aquí porque config es el
// primer módulo que se carga.
z.config(z.locales.es())

// Configuración del backend a partir de las variables de entorno, validada al arrancar (sección 5).

const esquema = z.object({
  ENTORNO: z.enum(['desarrollo', 'pruebas', 'produccion']),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(
      /^postgres(ql)?:\/\/.+/,
      'Debe ser una URL de PostgreSQL (postgres://usuario:clave@host:puerto/base)',
    ),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DB_TIMEOUT_CONEXION_MS: z.coerce.number().int().min(100).default(5000),
  // Todas las fechas de la aplicación se calculan en esta zona horaria (sección 4.2)
  TZ: z.literal('Europe/Madrid', { error: 'Debe ser Europe/Madrid' }),
  // Clave con la que se firman las cookies de sesión; distinta en cada entorno
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'Debe tener al menos 32 caracteres (genérala con: openssl rand -base64 32)'),
  // Dirección desde la que se usa la aplicación, p. ej. https://servidor.tailnet.ts.net:8443
  URL_PUBLICA: z.url({
    protocol: /^https?$/,
    error: 'Debe ser una URL http(s), p. ej. https://servidor.tailnet.ts.net:8443',
  }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})

export type Config = {
  entorno: 'desarrollo' | 'pruebas' | 'produccion'
  puerto: number
  baseDeDatos: { url: string; poolMax: number; timeoutConexionMs: number }
  zonaHoraria: string
  secretoAuth: string
  urlPublica: string
  nivelLog: z.infer<typeof esquema>['LOG_LEVEL']
}

export class ErrorConfiguracion extends Error {
  constructor(public readonly problemas: string[]) {
    super(`Configuración no válida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`)
    this.name = 'ErrorConfiguracion'
  }
}

export function leerConfig(env: Record<string, string | undefined>): Config {
  const r = esquema.safeParse(env)
  if (!r.success) {
    throw new ErrorConfiguracion(
      r.error.issues.map((i) => {
        const variable = i.path.join('.')
        return env[variable] === undefined
          ? `${variable}: falta la variable`
          : `${variable}: ${i.message}`
      }),
    )
  }
  const e = r.data
  return {
    entorno: e.ENTORNO,
    puerto: e.PORT,
    baseDeDatos: {
      url: e.DATABASE_URL,
      poolMax: e.DB_POOL_MAX,
      timeoutConexionMs: e.DB_TIMEOUT_CONEXION_MS,
    },
    zonaHoraria: e.TZ,
    secretoAuth: e.BETTER_AUTH_SECRET,
    // Sin barra final: es el origen que se compara con la cabecera Origin
    urlPublica: e.URL_PUBLICA.replace(/\/+$/, ''),
    nivelLog: e.LOG_LEVEL,
  }
}

function cargar(): Config {
  try {
    return leerConfig(process.env)
  } catch (error) {
    if (error instanceof ErrorConfiguracion) {
      // El backend no arranca con una configuración incompleta: se indica qué falta y termina
      console.error(error.message)
      process.exit(1)
    }
    throw error
  }
}

export const config = cargar()
