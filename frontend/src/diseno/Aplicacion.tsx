import { CalendarDays, ClipboardCheck, Coins, Menu, Users } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { ActualizacionPwa } from '../pwa/ActualizacionPwa'
import estilos from './Aplicacion.module.css'

const secciones = [
  { ruta: '/plantilla', texto: 'Plantilla', icono: Users },
  { ruta: '/entrenos', texto: 'Entrenos', icono: ClipboardCheck },
  { ruta: '/partidos', texto: 'Partidos', icono: CalendarDays },
  { ruta: '/multas', texto: 'Multas', icono: Coins },
  { ruta: '/mas', texto: 'Más', icono: Menu },
]

// Estructura de todas las pantallas: cabecera, contenido y navegación inferior (pensada para una mano)
export function Aplicacion() {
  return (
    <div className={estilos.aplicacion}>
      <a href="#contenido" className="saltar-al-contenido">
        Saltar al contenido
      </a>
      <header className={estilos.cabecera}>
        <img src="/logo.svg" alt="" width={32} height={32} className={estilos.logo} />
        <span className={estilos.titulo}>Vestuario</span>
      </header>

      <main id="contenido" className={estilos.contenido}>
        <Outlet />
      </main>

      <nav className={estilos.navegacion} aria-label="Secciones">
        {secciones.map(({ ruta, texto, icono: Icono }) => (
          <NavLink
            key={ruta}
            to={ruta}
            className={({ isActive }) =>
              [estilos.enlace, isActive && estilos.activo].filter(Boolean).join(' ')
            }
          >
            <Icono aria-hidden size={24} />
            <span>{texto}</span>
          </NavLink>
        ))}
      </nav>

      <ActualizacionPwa />
    </div>
  )
}
