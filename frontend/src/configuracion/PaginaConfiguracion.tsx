import { ChevronLeft } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { useClubes, usePlantillas } from '../plantillas/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { Administradores } from './Administradores'
import estilos from './Configuracion.module.css'
import { DatosPlantilla } from './DatosPlantilla'
import { IdentidadClub } from './IdentidadClub'
import { Miembros } from './Miembros'
import { NombreClub } from './NombreClub'
import { PlantillasClub } from './PlantillasClub'
import { Seccion } from './Seccion'

// Quién ve la configuración: el entrenador y el admin de la plantilla, y los administradores del club
export const puedeConfigurar = (plantilla: { rol: string; esAdminClub: boolean }) =>
  plantilla.esAdminClub || plantilla.rol === 'admin' || plantilla.rol === 'entrenador'

type Pestana = 'plantilla' | 'club'

const PESTANAS: { id: Pestana; texto: string }[] = [
  { id: 'plantilla', texto: 'Esta plantilla' },
  { id: 'club', texto: 'Club' },
]

// Dos pestañas (GH-298): «Esta plantilla» (datos, multas, sanciones, miembros e invitaciones) y
// «Club» (nombre, escudo y colores, plantillas y administradores), que solo ven los administradores
// del club; para el resto, la página es la de la plantilla, sin pestañas
export function PaginaConfiguracion() {
  const plantilla = usePlantillaActiva()
  const plantillas = usePlantillas()
  const clubes = useClubes()
  const club = clubes.data?.find((c) => c.id === plantilla.clubId)
  const [parametros, setParametros] = useSearchParams()
  const conPestanas = plantilla.esAdminClub
  // La pestaña va en la dirección, para volver a ella
  const pestana: Pestana =
    conPestanas && parametros.get('pestana') === 'club' ? 'club' : 'plantilla'
  const elegir = (id: Pestana) => setParametros({ pestana: id }, { replace: true })
  // Flechas, Inicio y Fin mueven entre pestañas, y el foco va con ellas
  const teclas = (e: KeyboardEvent) => {
    const indice = PESTANAS.findIndex((x) => x.id === pestana)
    const destino =
      e.key === 'ArrowRight'
        ? (indice + 1) % PESTANAS.length
        : e.key === 'ArrowLeft'
          ? (indice - 1 + PESTANAS.length) % PESTANAS.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? PESTANAS.length - 1
              : null
    if (destino === null) return
    e.preventDefault()
    const id = PESTANAS[destino]?.id ?? 'plantilla'
    elegir(id)
    document.getElementById(`pestana-${id}`)?.focus()
  }

  const dePlantilla = (
    <>
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

      {(plantilla.esAdminClub || plantilla.rol === 'admin') && (
        <Seccion
          titulo="Miembros"
          descripcion="Quién tiene acceso a esta plantilla y con qué rol. Solo lo ve el admin."
        >
          <Miembros plantilla={plantilla} />
        </Seccion>
      )}
    </>
  )

  const delClub = club ? (
    <>
      <Seccion titulo="Club" descripcion="Solo los administradores del club ven estas opciones.">
        <NombreClub club={club} />
      </Seccion>

      <Seccion
        titulo="Identidad del club"
        descripcion="El escudo y los colores se aplican a todas las plantillas del club."
      >
        <IdentidadClub club={club} />
      </Seccion>

      <Seccion
        titulo="Plantillas del club"
        descripcion="Todas las categorías del club, por temporada."
      >
        <PlantillasClub club={club} plantillas={plantillas.data ?? []} actualId={plantilla.id} />
      </Seccion>

      <Seccion
        titulo="Administradores del club"
        descripcion="Pueden hacerlo todo en el club y en todas sus plantillas."
      >
        <Administradores club={club} />
      </Seccion>
    </>
  ) : clubes.isPending ? (
    <Cargando />
  ) : null

  return (
    <div className={estilos.pagina}>
      <Link to={`/plantillas/${plantilla.id}/mas`} className={estilos.volver}>
        <ChevronLeft aria-hidden size={20} />
        Más
      </Link>
      <h1>Configuración</h1>

      {conPestanas ? (
        <>
          <div role="tablist" aria-label="Configuración" className={estilos.pestanas}>
            {PESTANAS.map(({ id, texto }) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`pestana-${id}`}
                aria-selected={pestana === id}
                aria-controls={`panel-${id}`}
                tabIndex={pestana === id ? 0 : -1}
                onClick={() => elegir(id)}
                onKeyDown={teclas}
              >
                {texto}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`panel-${pestana}`}
            aria-labelledby={`pestana-${pestana}`}
            className={estilos.panelPestana}
          >
            {pestana === 'club' ? delClub : dePlantilla}
          </div>
        </>
      ) : (
        dePlantilla
      )}
    </div>
  )
}
