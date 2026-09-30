import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { config } from './config.js'
import { db } from './db/cliente.js'
import { account, session, user, verification } from './db/schema/index.js'

// Autenticación con email y contraseña (sección 4.2). Rutas bajo /api/auth.

export const LONGITUD_MINIMA_CONTRASENA = 10

// Rutas de Better Auth que usa la aplicación: iniciar y cerrar sesión, consultar la sesión y cambiar
// la contraseña. El resto se desactivan (responden 404): registro, recuperación de contraseña por
// email, cuentas sociales, borrado de usuario, gestión de sesiones, etc.
export const RUTAS_AUTH = ['/sign-in/email', '/sign-out', '/get-session', '/change-password']

const RUTAS_DESACTIVADAS = [
  '/account-info',
  '/callback/:id',
  '/change-email',
  '/delete-user',
  '/delete-user/callback',
  '/error',
  '/get-access-token',
  '/link-social',
  '/list-accounts',
  '/list-sessions',
  '/ok',
  '/refresh-token',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/revoke-other-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/social',
  '/sign-up/email',
  '/unlink-account',
  '/update-session',
  '/update-user',
  '/verify-email',
  '/verify-password',
]

const DIA = 60 * 60 * 24

export const auth = betterAuth({
  appName: 'Vestuario',
  baseURL: config.urlPublica,
  basePath: '/api/auth',
  secret: config.secretoAuth,
  // Solo se aceptan peticiones que modifican datos desde la propia aplicación (protección CSRF)
  trustedOrigins: [config.urlPublica],
  disabledPaths: RUTAS_DESACTIVADAS,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // Los usuarios se crean con el comando crear-admin y, más adelante, por invitación (GH-50)
    disableSignUp: true,
    minPasswordLength: LONGITUD_MINIMA_CONTRASENA,
  },
  session: {
    // 30 días, renovada con el uso una vez al día: en el móvil no hay que volver a entrar
    expiresIn: 30 * DIA,
    updateAge: DIA,
  },
  rateLimit: {
    enabled: true,
    storage: 'memory',
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
    },
  },
  advanced: {
    database: { generateId: false },
    // HttpOnly y SameSite=Lax son los valores por defecto; Secure salvo en desarrollo (http://localhost)
    useSecureCookies: config.entorno !== 'desarrollo',
    cookiePrefix: 'vestuario',
    // nginx sobrescribe X-Real-IP con la IP de la conexión; X-Forwarded-For lo puede falsear el cliente
    ipAddress: { ipAddressHeaders: ['x-real-ip'] },
  },
})

export type Sesion = typeof auth.$Infer.Session
