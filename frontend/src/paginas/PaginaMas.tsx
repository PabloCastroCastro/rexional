import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { api, datos } from '../api/cliente'
import estilos from './PaginaMas.module.css'

export function PaginaMas() {
  const salud = useQuery({ queryKey: ['salud'], queryFn: () => datos(api.GET('/api/health')) })

  const estadoServidor = salud.isPending
    ? 'Comprobando…'
    : salud.data?.estado === 'ok'
      ? 'Disponible'
      : 'No responde'

  return (
    <div className={estilos.mas}>
      <h1>Más</h1>
      <p className={estilos.nota}>
        Configuración, estadísticas, cambio de plantilla y cerrar sesión llegarán con las próximas
        versiones.
      </p>

      <dl className={estilos.datos}>
        <dt>Servidor</dt>
        <dd data-estado={salud.data?.estado ?? (salud.isError ? 'error' : undefined)}>
          {estadoServidor}
        </dd>
        <dt>Versión</dt>
        <dd>{__VERSION__}</dd>
      </dl>

      {import.meta.env.DEV && (
        <p>
          <Link to="/componentes">Componentes (solo en desarrollo)</Link>
        </p>
      )}
    </div>
  )
}
