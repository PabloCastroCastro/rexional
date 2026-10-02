import { useQuery } from '@tanstack/react-query'
import { ErrorApi } from '../api/cliente'

// Cliente mínimo de la autenticación (Better Auth en /api/auth): solo las tres rutas que usa la app.

export type Usuario = { id: string; name: string; email: string }
export type Sesion = { user: Usuario; session: { expiresAt: string } }

export const CLAVE_SESION = ['sesion'] as const

const enviar = (ruta: string, cuerpo: unknown) =>
  fetch(`/api/auth${ruta}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  })

export async function obtenerSesion(): Promise<Sesion | null> {
  const res = await fetch('/api/auth/get-session', { credentials: 'same-origin' })
  if (!res.ok) throw new ErrorApi(res.status, 'error', 'No se ha podido comprobar la sesión')
  return (await res.json()) as Sesion | null
}

export async function iniciarSesion(email: string, password: string) {
  let res: Response
  try {
    res = await enviar('/sign-in/email', { email, password })
  } catch {
    throw new ErrorApi(
      0,
      'sin_conexion',
      'No hay conexión con el servidor. Comprueba la cobertura.',
    )
  }
  if (res.ok) return
  if (res.status === 401)
    throw new ErrorApi(401, 'credenciales', 'El email o la contraseña no son correctos')
  if (res.status === 429) {
    throw new ErrorApi(
      429,
      'demasiados_intentos',
      'Demasiados intentos. Espera un minuto y vuelve a probar.',
    )
  }
  throw new ErrorApi(res.status, 'error', 'No se ha podido iniciar sesión. Inténtalo de nuevo.')
}

export async function cerrarSesion() {
  await enviar('/sign-out', {})
}

export const useSesion = () =>
  useQuery({ queryKey: CLAVE_SESION, queryFn: obtenerSesion, staleTime: 5 * 60_000, retry: false })

// Aviso de sesión caducada para la pantalla de login (sobrevive a la redirección)
const CLAVE_CADUCADA = 'vestuario:sesion-caducada'

export const marcarSesionCaducada = () => {
  try {
    sessionStorage.setItem(CLAVE_CADUCADA, '1')
  } catch {}
}

export const consumirSesionCaducada = () => {
  try {
    const caducada = sessionStorage.getItem(CLAVE_CADUCADA) === '1'
    sessionStorage.removeItem(CLAVE_CADUCADA)
    return caducada
  } catch {
    return false
  }
}
