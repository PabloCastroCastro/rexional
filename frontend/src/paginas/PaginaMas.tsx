import { useQuery, useQueryClient } from '@tanstack/react-query'
import { LogOut } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { api, datos } from '../api/cliente'
import { cerrarSesion, useSesion } from '../auth/sesion'
import { Boton } from '../componentes/Boton'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import estilos from './PaginaMas.module.css'

const ROLES = {
  admin: 'Administrador',
  entrenador: 'Entrenador',
  delegado: 'Delegado',
  jugador: 'Jugador',
}

export function PaginaMas() {
  const sesion = useSesion()
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const [saliendo, setSaliendo] = useState(false)
  const salud = useQuery({ queryKey: ['salud'], queryFn: () => datos(api.GET('/api/health')) })

  const estadoServidor = salud.isPending
    ? 'Comprobando…'
    : salud.data?.estado === 'ok'
      ? 'Disponible'
      : 'No responde'

  async function salir() {
    setSaliendo(true)
    try {
      await cerrarSesion()
    } finally {
      // Sin datos de la sesión anterior en la caché, aunque el servidor no respondiera
      cliente.clear()
      navegar('/login', { replace: true })
    }
  }

  return (
    <div className={estilos.mas}>
      <h1>Más</h1>

      <dl className={estilos.datos}>
        <dt>Usuario</dt>
        <dd>
          {sesion.data?.user.name}
          <span className={estilos.secundario}>{sesion.data?.user.email}</span>
        </dd>
        <dt>Plantilla</dt>
        <dd>
          {plantilla.nombre} · {plantilla.temporada}
          <span className={estilos.secundario}>
            {plantilla.club.nombre} · {ROLES[plantilla.rol]}
            {plantilla.esAdminClub ? ' del club' : ''}
          </span>
        </dd>
        <dt>Servidor</dt>
        <dd data-estado={salud.data?.estado ?? (salud.isError ? 'error' : undefined)}>
          {estadoServidor}
        </dd>
        <dt>Versión</dt>
        <dd>{__VERSION__}</dd>
      </dl>

      <p className={estilos.nota}>
        La configuración de la plantilla y del club llega con la próxima versión; las estadísticas,
        en el ciclo 6.
      </p>

      <Boton
        variante="secundario"
        anchoCompleto
        cargando={saliendo}
        icono={<LogOut aria-hidden size={18} />}
        onClick={salir}
      >
        Cerrar sesión
      </Boton>

      {import.meta.env.DEV && (
        <p>
          <Link to="/componentes">Componentes (solo en desarrollo)</Link>
        </p>
      )}
    </div>
  )
}
