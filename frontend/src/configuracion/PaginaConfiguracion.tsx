import { ChevronLeft } from 'lucide-react'
import { Link } from 'react-router'
import { useClubes, usePlantillas } from '../plantillas/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { Administradores } from './Administradores'
import estilos from './Configuracion.module.css'
import { DatosPlantilla } from './DatosPlantilla'
import { NombreClub } from './NombreClub'
import { PlantillasClub } from './PlantillasClub'
import { Seccion } from './Seccion'

// Quién ve la configuración: el entrenador y el admin de la plantilla, y los administradores del club
export const puedeConfigurar = (plantilla: { rol: string; esAdminClub: boolean }) =>
  plantilla.esAdminClub || plantilla.rol === 'admin' || plantilla.rol === 'entrenador'

export function PaginaConfiguracion() {
  const plantilla = usePlantillaActiva()
  const plantillas = usePlantillas()
  const clubes = useClubes()
  const club = clubes.data?.find((c) => c.id === plantilla.clubId)

  return (
    <div className={estilos.pagina}>
      <Link to={`/p/${plantilla.id}/mas`} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        Más
      </Link>
      <h1>Configuración</h1>

      {puedeConfigurar(plantilla) ? (
        <Seccion
          titulo="Esta plantilla"
          descripcion={`${plantilla.club.nombre} · temporada ${plantilla.temporada}`}
        >
          <DatosPlantilla plantilla={plantilla} />
          <p className={estilos.descripcion}>
            La temporada no se cambia: para la siguiente se crea una plantilla nueva enlazada con
            esta.
          </p>
        </Seccion>
      ) : (
        <p className={estilos.descripcion}>
          Tu rol en esta plantilla no permite cambiar su configuración.
        </p>
      )}

      {plantilla.esAdminClub && club && (
        <>
          <Seccion
            titulo="Club"
            descripcion="Solo los administradores del club ven estas opciones."
          >
            <NombreClub club={club} />
          </Seccion>

          <Seccion
            titulo="Plantillas del club"
            descripcion="Todas las categorías del club, por temporada."
          >
            <PlantillasClub
              club={club}
              plantillas={plantillas.data ?? []}
              actualId={plantilla.id}
            />
          </Seccion>

          <Seccion
            titulo="Administradores del club"
            descripcion="Pueden hacerlo todo en el club y en todas sus plantillas."
          >
            <Administradores club={club} />
          </Seccion>
        </>
      )}
    </div>
  )
}
