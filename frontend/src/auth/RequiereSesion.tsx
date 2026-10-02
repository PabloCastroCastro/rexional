import { Navigate, Outlet, useLocation } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { useSesion } from './sesion'

// Envuelve todas las rutas de la aplicación: sin sesión lleva al login y, al entrar, devuelve aquí
export function RequiereSesion() {
  const sesion = useSesion()
  const ubicacion = useLocation()

  if (sesion.isPending) return <Cargando />
  if (!sesion.data) {
    const volver = ubicacion.pathname + ubicacion.search
    return <Navigate to="/login" replace state={{ volver }} />
  }
  return <Outlet />
}
