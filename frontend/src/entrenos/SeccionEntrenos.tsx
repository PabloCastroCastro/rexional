import { NavLink, Outlet } from 'react-router'
import estilos from './Entrenos.module.css'

// Pestaña Entrenos: pasar lista (índice), historial, horario y la biblioteca de ejercicios del club,
// cada uno con su ruta
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
        <NavLink to="horario" className={clase}>
          Horario
        </NavLink>
        <NavLink to="ejercicios" className={clase}>
          Ejercicios
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
