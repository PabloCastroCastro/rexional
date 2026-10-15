import { NavLink, Outlet } from 'react-router'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import estilos from './Multas.module.css'
import { PaginaCaja } from './PaginaCaja'
import { PaginaListaMultas } from './PaginaListaMultas'

// Pestaña Multas: caja, multas y catálogo. El rol jugador no ve la caja ni las deudas de los demás:
// empieza en sus multas.
export function SeccionMultas() {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const clase = ({ isActive }: { isActive: boolean }) => (isActive ? estilos.activa : undefined)
  return (
    <div className={estilos.pagina}>
      <h1>Multas</h1>
      <nav className={estilos.pestanas} aria-label="Multas">
        {gestiona ? (
          <>
            <NavLink to="" end className={clase}>
              Caja
            </NavLink>
            <NavLink to="lista" className={clase}>
              Multas
            </NavLink>
          </>
        ) : (
          <NavLink to="" end className={clase}>
            Mis multas
          </NavLink>
        )}
        <NavLink to="catalogo" className={clase}>
          Catálogo
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}

// Índice de la pestaña: la caja para quien gestiona; sus multas para el rol jugador
export function IndiceMultas() {
  const plantilla = usePlantillaActiva()
  return puedeGestionarJugadores(plantilla) ? <PaginaCaja /> : <PaginaListaMultas />
}
