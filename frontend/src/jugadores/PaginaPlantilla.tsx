import { ChevronRight, Coins, RotateCcw, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { IconoEstado } from '../componentes/IconoEstado'
import { useResumenAsistencia } from '../entrenos/datos'
import { Porcentaje } from '../entrenos/Porcentaje'
import { euros, useDeudas } from '../multas/datos'
import estilosMultas from '../multas/Multas.module.css'
import { useEstadisticas } from '../partidos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { useBajaYReactivacion } from './acciones'
import { MarcaInvitado } from './BuscadorInvitables'
import {
  type JugadorPlantilla,
  nombreCompleto,
  POSICIONES,
  puedeGestionarJugadores,
  useJugadores,
} from './datos'
import { type Estado, estadoJugador } from './estado'
import { FormularioJugador, type ModoFormulario } from './FormularioJugador'
import estilos from './Jugadores.module.css'
import { type SancionesJugador, sancionesDe, useSanciones } from './Sanciones'

// Jugadores de la plantilla activa, por dorsal y nombre (la API ya los devuelve ordenados). Activos o
// bajas según ?ver=bajas, para que volver desde un jugador deje la misma vista. Entre los activos,
// los invitados van aparte, en un apartado plegado (GH-188).
export function PaginaPlantilla() {
  const plantilla = usePlantillaActiva()
  const [parametros, setParametros] = useSearchParams()
  const verBajas = parametros.get('ver') === 'bajas'
  const jugadores = useJugadores(plantilla.id, !verBajas)
  // Asistencia de cada jugador; al rol jugador solo le llega la suya
  const resumen = useResumenAsistencia(plantilla.id)
  const porcentajes = new Map(resumen.data?.map((r) => [r.jugadorId, r.porcentaje]))
  // Deuda de multas pendiente; al rol jugador solo le llega la suya
  const deudas = useDeudas(plantilla)
  // Partidos jugados con la plantilla, para los invitados
  const estadisticas = useEstadisticas(plantilla.id)
  const partidos = new Map(estadisticas.data?.jugadores.map((j) => [j.jugadorId, j.partidos]))
  // Sancionados y apercibidos (GH-231)
  const sanciones = useSanciones(plantilla.id)
  const gestiona = puedeGestionarJugadores(plantilla)
  const [abiertos, setAbiertos] = useState(false)
  const [formulario, setFormulario] = useState<ModoFormulario | null>(null)
  const { reactivar, pendiente } = useBajaYReactivacion({
    alDorsalOcupado: (jugador, mensaje) =>
      setFormulario({ tipo: 'editar', jugador, reactivar: true, errorDorsal: mensaje }),
  })

  const anadir = () => setFormulario({ tipo: 'alta' })

  return (
    <div className={estilos.pagina}>
      <div className={estilos.cabecera}>
        <h1>Plantilla</h1>
        {gestiona && (
          <Boton icono={<UserPlus aria-hidden size={18} />} onClick={anadir}>
            Añadir
          </Boton>
        )}
      </div>

      {/* Las bajas son cosa del cuerpo técnico: el rol jugador ve solo la plantilla activa */}
      {gestiona && (
        <fieldset className={estilos.segmentos}>
          <legend className="solo-lectores">Ver</legend>
          <button type="button" aria-pressed={!verBajas} onClick={() => setParametros({})}>
            Activos
          </button>
          <button
            type="button"
            aria-pressed={verBajas}
            onClick={() => setParametros({ ver: 'bajas' })}
          >
            Bajas
          </button>
        </fieldset>
      )}

      {jugadores.isPending ? (
        <Cargando />
      ) : jugadores.isError ? (
        <p className={estilos.error} role="alert">
          {jugadores.error.message}
        </p>
      ) : jugadores.data.length === 0 ? (
        verBajas ? (
          <EstadoVacio
            titulo="No hay bajas"
            descripcion="Los jugadores que des de baja aparecerán aquí y podrás reactivarlos."
          />
        ) : (
          <EstadoVacio
            icono={<Users size={32} />}
            titulo="Todavía no hay jugadores"
            descripcion={
              gestiona
                ? 'Añade a los jugadores de la plantilla: nuevos o del club, de otra categoría o temporada.'
                : 'Cuando el cuerpo técnico añada jugadores, aparecerán aquí.'
            }
            accion={
              gestiona && (
                <Boton icono={<UserPlus aria-hidden size={18} />} onClick={anadir}>
                  Añadir el primer jugador
                </Boton>
              )
            }
          />
        )
      ) : (
        <>
          {(() => {
            const propios = verBajas
              ? jugadores.data
              : jugadores.data.filter((j) => j.tipo === 'propia')
            const invitados = verBajas ? [] : jugadores.data.filter((j) => j.tipo === 'invitado')
            const lista = (filas: JugadorPlantilla[], etiqueta: string) => (
              <ul className={estilos.lista} aria-label={etiqueta}>
                {filas.map((j) => fila(j))}
              </ul>
            )
            return (
              <>
                {propios.length > 0 && lista(propios, verBajas ? 'Bajas' : 'Jugadores')}
                {invitados.length > 0 && (
                  <details
                    className={estilos.invitados}
                    open={abiertos}
                    onToggle={(e) => setAbiertos(e.currentTarget.open)}
                  >
                    <summary>Invitados · {invitados.length}</summary>
                    {lista(invitados, 'Invitados')}
                  </details>
                )}
              </>
            )
          })()}
        </>
      )}

      <FormularioJugador modo={formulario} alCerrar={() => setFormulario(null)} />
    </div>
  )

  function fila(j: JugadorPlantilla) {
    // El rol jugador solo abre su propia ficha (GH-52)
    const propio = j.jugadorId === plantilla.jugadorId
    return (
      <li key={j.jugadorId}>
        {gestiona || propio ? (
          <Link to={j.jugadorId} className={estilos.fila}>
            <Datos
              jugador={j}
              propio={propio}
              porcentaje={porcentajes.get(j.jugadorId)}
              deuda={deudas.get(j.jugadorId)}
              partidos={partidos.get(j.jugadorId)}
              sanciones={sancionesDe(sanciones.data, j.jugadorId)}
            />
            <ChevronRight aria-hidden size={20} className={estilos.flecha} />
          </Link>
        ) : (
          <div className={estilos.fila}>
            <Datos
              jugador={j}
              porcentaje={porcentajes.get(j.jugadorId)}
              deuda={deudas.get(j.jugadorId)}
              partidos={partidos.get(j.jugadorId)}
              sanciones={sancionesDe(sanciones.data, j.jugadorId)}
            />
          </div>
        )}
        {gestiona && verBajas && (
          <Boton
            variante="secundario"
            icono={<RotateCcw aria-hidden size={18} />}
            disabled={pendiente}
            onClick={() => reactivar(j)}
            aria-label={`Reactivar a ${nombreCompleto(j)}`}
          >
            Reactivar
          </Boton>
        )}
      </li>
    )
  }
}

// Dorsal con el color secundario del club y, si lo tiene, el estado del jugador como una señal en su
// esquina: cruz de lesión, tarjeta roja de sanción o amarilla de apercibido (GH-251)
export function Dorsal({ dorsal, estado }: { dorsal: number | null; estado?: Estado | null }) {
  return (
    <span className={estilos.dorsal}>
      <span aria-hidden="true">{dorsal ?? '–'}</span>
      <span className="solo-lectores">
        {dorsal === null ? 'Sin dorsal' : `Dorsal ${dorsal}`}
        {estado && `. ${estado.texto}`}
      </span>
      {estado && (
        <span className={estilos.senal} data-estado={estado.tipo}>
          <IconoEstado estado={estado.tipo} size={12} />
        </span>
      )}
    </span>
  )
}

function Datos({
  jugador,
  propio = false,
  porcentaje,
  deuda,
  partidos,
  sanciones,
}: {
  jugador: JugadorPlantilla
  propio?: boolean
  porcentaje: number | null | undefined
  deuda: number | undefined
  partidos: number | undefined
  sanciones?: SancionesJugador
}) {
  const invitado = jugador.tipo === 'invitado'
  // Debajo del nombre, solo la posición (o, en un invitado, de dónde viene y cuántos partidos lleva);
  // la lesión y la sanción van sobre el dorsal (GH-251)
  const detalle = invitado
    ? [jugador.procedencia, `${partidos ?? 0} ${partidos === 1 ? 'partido' : 'partidos'}`]
        .filter(Boolean)
        .join(' · ')
    : jugador.posicion
      ? POSICIONES[jugador.posicion]
      : null
  return (
    <>
      <Dorsal
        dorsal={jugador.dorsal}
        estado={estadoJugador({ lesion: jugador.lesion, sanciones })}
      />
      <span className={estilos.texto}>
        <strong>
          {nombreCompleto(jugador)}
          {invitado && <MarcaInvitado />}
        </strong>
        {(propio || detalle) && (
          <span className={`${estilos.secundario} ${estilos.unaLinea}`}>
            {propio && <span className={estilos.marcaPropia}>Tú</span>}
            {detalle}
          </span>
        )}
      </span>
      {deuda ? (
        <span className={estilosMultas.deuda}>
          <Coins aria-hidden size={14} />
          {euros(deuda)}
          <span className="solo-lectores"> de multas pendientes</span>
        </span>
      ) : null}
      <Porcentaje valor={porcentaje} />
    </>
  )
}
