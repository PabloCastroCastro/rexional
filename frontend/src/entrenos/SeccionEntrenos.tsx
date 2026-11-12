import { NavLink, Outlet } from 'react-router'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import estilos from './Entrenos.module.css'
import { PaginaMiAsistencia } from './PaginaMiAsistencia'
import { PaginaPasarLista } from './PaginaPasarLista'

// Pestaña Entrenos: pasar lista (índice), historial, horario y la biblioteca de ejercicios del club,
// cada uno con su ruta. El rol jugador empieza en su asistencia, sin pasar lista ni historial (GH-52).
export function SeccionEntrenos() {
  const gestiona = puedeGestionarJugadores(usePlantillaActiva())
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? estilos.activa : undefined)
  return (
    <div className={estilos.pagina}>
      <h1>Entrenos</h1>
      <nav className={estilos.pestanas} aria-label="Entrenos">
        {gestiona ? (
          <>
            <NavLink to="" end className={clase}>
              Pasar lista
            </NavLink>
            <NavLink to="historial" className={clase}>
              Historial
            </NavLink>
          </>
        ) : (
          <NavLink to="" end className={clase}>
            Mi asistencia
          </NavLink>
        )}
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

// Índice de la pestaña: pasar lista para quien gestiona; su asistencia para el rol jugador
export function IndiceEntrenos() {
  const plantilla = usePlantillaActiva()
  return puedeGestionarJugadores(plantilla) ? <PaginaPasarLista /> : <PaginaMiAsistencia />
}
