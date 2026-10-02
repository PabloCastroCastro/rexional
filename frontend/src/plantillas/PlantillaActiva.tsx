import { ShieldAlert } from 'lucide-react'
import { createContext, useContext, useEffect } from 'react'
import { Link, Outlet, useParams } from 'react-router'
import { useSesion } from '../auth/sesion'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { guardarUltimaPlantilla, type Plantilla, usePlantillas } from './datos'

const Contexto = createContext<Plantilla | null>(null)

// Plantilla activa (la de la URL /p/:plantillaId/...), con su club y el rol del usuario
export function usePlantillaActiva() {
  const plantilla = useContext(Contexto)
  if (!plantilla) throw new Error('usePlantillaActiva solo funciona dentro de /p/:plantillaId')
  return plantilla
}

export function PlantillaActiva() {
  const { plantillaId } = useParams()
  const sesion = useSesion()
  const plantillas = usePlantillas()
  const plantilla = plantillas.data?.find((p) => p.id === plantillaId)
  const usuarioId = sesion.data?.user.id

  useEffect(() => {
    if (plantilla && usuarioId) guardarUltimaPlantilla(usuarioId, plantilla.id)
  }, [plantilla, usuarioId])

  if (plantillas.isPending) return <Cargando />
  if (!plantilla) {
    return (
      <main>
        <EstadoVacio
          icono={<ShieldAlert size={32} />}
          titulo="No tienes acceso a esta plantilla"
          descripcion="Puede que se haya borrado o que el enlace sea de otra persona."
          accion={<Link to="/plantillas">Elegir otra plantilla</Link>}
        />
      </main>
    )
  }

  return (
    <Contexto.Provider value={plantilla}>
      <Outlet />
    </Contexto.Provider>
  )
}
