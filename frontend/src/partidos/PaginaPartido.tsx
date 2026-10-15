import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Clock, MapPin, Pencil, Trash2, Trophy, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { hoy, textoFecha } from '../entrenos/datos'
import { nombreCompleto, puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, textoLocal, usePartido } from './datos'
import { FormularioPartido } from './FormularioPartido'
import estilos from './Partidos.module.css'

// Ficha de un partido: sus datos, editar y borrar, y la convocatoria
export function PaginaPartido() {
  const plantilla = usePlantillaActiva()
  const { partidoId = '' } = useParams()
  const partido = usePartido(plantilla.id, partidoId)
  const [editando, setEditando] = useState(false)
  const lista = `/plantillas/${plantilla.id}/partidos`
  const volverA = partido.data && partido.data.fecha < hoy() ? `${lista}?ver=pasados` : lista

  const volver = (
    <Link to={volverA} className={estilos.volver}>
      <ChevronLeft aria-hidden size={20} />
      Partidos
    </Link>
  )

  if (partido.isPending) return <Cargando />
  if (partido.isError) {
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio titulo="No se encuentra el partido" descripcion={partido.error.message} />
      </div>
    )
  }

  const p = partido.data
  const gestiona = puedeGestionarJugadores(plantilla)
  const convocados = p.jugadores.filter((j) => j.convocado)
  const lugar = textoLocal(p.local)

  return (
    <div className={estilos.pagina}>
      {volver}

      <header className={estilos.ficha}>
        <span className={estilos.cuando}>{textoFecha(p.fecha)}</span>
        <h1>
          {p.local === false ? 'en ' : 'vs '}
          {p.rival}
        </h1>
        <ul className={estilos.datos}>
          {p.competicion && (
            <li>
              <Trophy aria-hidden size={18} />
              {p.competicion}
            </li>
          )}
          {(p.hora || p.horaCitacion) && (
            <li>
              <Clock aria-hidden size={18} />
              {[p.horaCitacion && `Citación ${p.horaCitacion}`, p.hora && `Partido ${p.hora}`]
                .filter(Boolean)
                .join(' · ')}
            </li>
          )}
          {(p.lugar || lugar) && (
            <li>
              <MapPin aria-hidden size={18} />
              {[p.lugar, lugar && (p.lugar ? `(${lugar.toLowerCase()})` : lugar)]
                .filter(Boolean)
                .join(' ')}
            </li>
          )}
        </ul>
      </header>

      {gestiona && (
        <div className={estilos.acciones}>
          <Boton
            variante="secundario"
            icono={<Pencil aria-hidden size={18} />}
            onClick={() => setEditando(true)}
          >
            Editar
          </Boton>
          <BorrarPartido partido={p} alBorrar={volverA} />
        </div>
      )}

      <section className={estilos.seccion} aria-labelledby="convocatoria">
        <h2 id="convocatoria">
          <Users aria-hidden size={20} />
          Convocatoria
          {convocados.length > 0 && <span className={estilos.contador}>{convocados.length}</span>}
        </h2>
        {convocados.length === 0 ? (
          <p className={estilos.secundario}>Todavía no hay convocatoria.</p>
        ) : (
          <ul className={estilos.convocados}>
            {convocados.map((j) => (
              <li key={j.jugadorId}>
                <Dorsal dorsal={j.dorsal} />
                <span>
                  {nombreCompleto(j)}
                  {!j.activo && <span className={estilos.secundario}> · baja</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormularioPartido abierta={editando} partido={p} alCerrar={() => setEditando(false)} />
    </div>
  )
}

function BorrarPartido({ partido, alBorrar }: { partido: Partido; alBorrar: string }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const conConvocatoria = partido.jugadores.some((j) => j.convocado)

  const borrar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/plantillas/{id}/partidos/{pid}', {
          params: { path: { id: plantilla.id, pid: partido.id } },
        }),
      ),
    onSuccess: async () => {
      navegar(alBorrar, { replace: true })
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      avisar({ tipo: 'exito', mensaje: `Partido contra ${partido.rival} borrado` })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido borrar',
      }),
  })

  return (
    <Boton
      variante="peligro"
      icono={<Trash2 aria-hidden size={18} />}
      cargando={borrar.isPending}
      onClick={async () => {
        const confirmado = await confirmar({
          titulo: `¿Borrar el partido contra ${partido.rival}?`,
          mensaje: conConvocatoria
            ? 'Ya tiene convocatoria: se borrará también. No se puede deshacer.'
            : 'No se puede deshacer.',
          textoConfirmar: 'Borrar partido',
          peligrosa: true,
        })
        if (confirmado) borrar.mutate()
      }}
    >
      Borrar
    </Boton>
  )
}
