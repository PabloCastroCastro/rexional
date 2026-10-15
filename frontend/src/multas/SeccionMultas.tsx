import { Coins } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeConfigurar } from '../configuracion/PaginaConfiguracion'
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
  if (!plantilla.multasActivas) {
    return (
      <div className={estilos.pagina}>
        <h1>Multas</h1>
        <EstadoVacio
          icono={<Coins size={32} />}
          titulo="Esta plantilla no usa multas"
          descripcion="Las multas y la caja están desactivadas. Si había multas, se conservan y vuelven a verse al activarlas."
          accion={
            puedeConfigurar(plantilla) && (
              <Link to={`/plantillas/${plantilla.id}/mas/configuracion`}>
                Activarlas en Configuración
              </Link>
            )
          }
        />
      </div>
    )
  }
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
