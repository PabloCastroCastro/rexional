import { NavLink, Outlet } from 'react-router'
import estilos from './Entrenos.module.css'

// Pestaña Entrenos: pasar lista (índice) e historial, cada uno con su ruta
export function SeccionEntrenos() {
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? estilos.activa : undefined)
  return (
    <div className={estilos.pagina}>
      <h1>Entrenos</h1>
      <nav className={estilos.pestanas} aria-label="Entrenos">
        <NavLink to="" end className={clase}>
          Pasar lista
        </NavLink>
        <NavLink to="historial" className={clase}>
          Historial
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
