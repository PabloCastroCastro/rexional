import { useNavigate } from 'react-router'
import { useSesion } from '../auth/sesion'
import { Cargando } from '../componentes/Cargando'
import { useClubes, usePlantillas } from './datos'
import estilos from './PaginaElegirPlantilla.module.css'
import { SelectorPlantilla } from './SelectorPlantilla'

export function PaginaElegirPlantilla() {
  const navegar = useNavigate()
  const sesion = useSesion()
  const plantillas = usePlantillas()
  const clubes = useClubes()

  if (plantillas.isPending || clubes.isPending) return <Cargando />

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <img src="/logo.svg" alt="" width={48} height={48} className={estilos.logo} />
        <div>
          <h1>Elige la plantilla</h1>
          {sesion.data && <p className={estilos.usuario}>{sesion.data.user.name}</p>}
        </div>
      </header>
      <SelectorPlantilla alElegir={(id) => navegar(`/p/${id}/plantilla`)} />
    </main>
  )
}
