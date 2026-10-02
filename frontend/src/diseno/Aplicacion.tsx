import { CalendarDays, ChevronDown, ClipboardCheck, Coins, Menu, Users } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { HojaInferior } from '../componentes/HojaInferior'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { SelectorPlantilla } from '../plantillas/SelectorPlantilla'
import { ActualizacionPwa } from '../pwa/ActualizacionPwa'
import estilos from './Aplicacion.module.css'

const secciones = [
  { ruta: 'plantilla', texto: 'Plantilla', icono: Users },
  { ruta: 'entrenos', texto: 'Entrenos', icono: ClipboardCheck },
  { ruta: 'partidos', texto: 'Partidos', icono: CalendarDays },
  { ruta: 'multas', texto: 'Multas', icono: Coins },
  { ruta: 'mas', texto: 'Más', icono: Menu },
]

// Estructura de las pantallas de una plantilla: cabecera con el cambio de plantilla, contenido y
// navegación inferior (pensada para una mano)
export function Aplicacion() {
  const plantilla = usePlantillaActiva()
  const navegar = useNavigate()
  const ubicacion = useLocation()
  const [cambiando, setCambiando] = useState(false)

  // Al cambiar de plantilla se mantiene la sección: de los entrenos de una a los de la otra
  const seccionActual = ubicacion.pathname.split('/')[3] ?? 'plantilla'

  return (
    <div className={estilos.aplicacion}>
      <a href="#contenido" className="saltar-al-contenido">
        Saltar al contenido
      </a>
      <header className={estilos.cabecera}>
        <img
          src={plantilla.club.escudo ?? '/logo.svg'}
          alt=""
          width={32}
          height={32}
          className={estilos.logo}
        />
        <button
          type="button"
          className={estilos.plantilla}
          onClick={() => setCambiando(true)}
          aria-label={`Plantilla ${plantilla.nombre}, temporada ${plantilla.temporada}. Cambiar de plantilla`}
        >
          <span className={estilos.club}>{plantilla.club.nombre}</span>
          <span className={estilos.nombre}>
            {plantilla.nombre} · {plantilla.temporada}
            <ChevronDown aria-hidden size={18} />
          </span>
        </button>
      </header>

      <main id="contenido" className={estilos.contenido}>
        <Outlet />
      </main>

      <nav className={estilos.navegacion} aria-label="Secciones">
        {secciones.map(({ ruta, texto, icono: Icono }) => (
          <NavLink
            key={ruta}
            to={`/p/${plantilla.id}/${ruta}`}
            className={({ isActive }) =>
              [estilos.enlace, isActive && estilos.activo].filter(Boolean).join(' ')
            }
          >
            <Icono aria-hidden size={24} />
            <span>{texto}</span>
          </NavLink>
        ))}
      </nav>

      <HojaInferior
        abierta={cambiando}
        alCerrar={() => setCambiando(false)}
        titulo="Cambiar de plantilla"
      >
        <SelectorPlantilla
          actualId={plantilla.id}
          alElegir={(id) => {
            setCambiando(false)
            navegar(`/p/${id}/${seccionActual}`)
          }}
        />
      </HojaInferior>

      <ActualizacionPwa />
    </div>
  )
}
