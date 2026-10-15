import { ChevronRight, RotateCcw, UserPlus, Users } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { useResumenAsistencia } from '../entrenos/datos'
import { Porcentaje } from '../entrenos/Porcentaje'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { useBajaYReactivacion } from './acciones'
import { type JugadorPlantilla, POSICIONES, puedeGestionarJugadores, useJugadores } from './datos'
import { FormularioJugador, type ModoFormulario } from './FormularioJugador'
import estilos from './Jugadores.module.css'

// Jugadores de la plantilla activa, por dorsal y nombre (la API ya los devuelve ordenados). Activos o
// bajas según ?ver=bajas, para que volver desde un jugador deje la misma vista.
export function PaginaPlantilla() {
  const plantilla = usePlantillaActiva()
  const [parametros, setParametros] = useSearchParams()
  const verBajas = parametros.get('ver') === 'bajas'
  const jugadores = useJugadores(plantilla.id, !verBajas)
  // Asistencia de cada jugador; al rol jugador solo le llega la suya
  const resumen = useResumenAsistencia(plantilla.id)
  const porcentajes = new Map(resumen.data?.map((r) => [r.jugadorId, r.porcentaje]))
  const gestiona = puedeGestionarJugadores(plantilla)
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
        <ul className={estilos.lista} aria-label={verBajas ? 'Bajas' : 'Jugadores'}>
          {jugadores.data.map((j) => (
            <li key={j.jugadorId}>
              {gestiona ? (
                <Link to={j.jugadorId} className={estilos.fila}>
                  <Datos jugador={j} porcentaje={porcentajes.get(j.jugadorId)} />
                  <ChevronRight aria-hidden size={20} className={estilos.flecha} />
                </Link>
              ) : (
                <div className={estilos.fila}>
                  <Datos jugador={j} porcentaje={porcentajes.get(j.jugadorId)} />
                </div>
              )}
              {gestiona && verBajas && (
                <Boton
                  variante="secundario"
                  icono={<RotateCcw aria-hidden size={18} />}
                  disabled={pendiente}
                  onClick={() => reactivar(j)}
                  aria-label={`Reactivar a ${j.nombre}`}
                >
                  Reactivar
                </Boton>
              )}
            </li>
          ))}
        </ul>
      )}

      <FormularioJugador modo={formulario} alCerrar={() => setFormulario(null)} />
    </div>
  )
}

export function Dorsal({ dorsal }: { dorsal: number | null }) {
  return (
    <span className={estilos.dorsal}>
      <span aria-hidden="true">{dorsal ?? '–'}</span>
      <span className="solo-lectores">{dorsal === null ? 'Sin dorsal' : `Dorsal ${dorsal}`}</span>
    </span>
  )
}

function Datos({
  jugador,
  porcentaje,
}: {
  jugador: JugadorPlantilla
  porcentaje: number | null | undefined
}) {
  return (
    <>
      <Dorsal dorsal={jugador.dorsal} />
      <span className={estilos.texto}>
        <strong>{jugador.nombre}</strong>
        <span className={estilos.secundario}>
          {jugador.posicion ? POSICIONES[jugador.posicion] : 'Sin posición'}
        </span>
      </span>
      <Porcentaje valor={porcentaje} />
    </>
  )
}
