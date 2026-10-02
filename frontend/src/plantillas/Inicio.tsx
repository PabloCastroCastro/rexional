import { Navigate } from 'react-router'
import { useSesion } from '../auth/sesion'
import { Cargando } from '../componentes/Cargando'
import { leerUltimaPlantilla, usePlantillas } from './datos'

// Tras el login: la última plantilla usada o, si solo hay una, esa; si no, el selector
export function Inicio() {
  const sesion = useSesion()
  const plantillas = usePlantillas()

  if (plantillas.isPending || !sesion.data) return <Cargando />
  const lista = plantillas.data ?? []
  const ultima = leerUltimaPlantilla(sesion.data.user.id)

  const destino = lista.find((p) => p.id === ultima) ?? (lista.length === 1 ? lista[0] : undefined)
  return <Navigate to={destino ? `/p/${destino.id}/plantilla` : '/plantillas'} replace />
}
