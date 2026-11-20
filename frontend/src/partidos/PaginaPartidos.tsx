import { Bus, CalendarDays, CalendarPlus, ChevronRight, FileUp, House } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  competicionHabitual,
  nombreCompeticion,
  type ResumenPartido,
  TEXTO_RESULTADO,
  tipoResultado,
  usePartidos,
} from './datos'
import { Estadisticas } from './Estadisticas'
import { FormularioPartido } from './FormularioPartido'
import estilos from './Partidos.module.css'

// Partidos de la plantilla: próximos (por defecto) o pasados (?ver=pasados)
export function PaginaPartidos() {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const navegar = useNavigate()
  const [parametros, setParametros] = useSearchParams()
  const ver = parametros.get('ver')
  const pasados = ver === 'pasados'
  const enEstadisticas = ver === 'estadisticas'
  const partidos = usePartidos(plantilla.id, pasados ? 'pasados' : 'proximos')
  // La competición habitual, con los partidos de toda la temporada: los próximos y los pasados
  const otros = usePartidos(plantilla.id, pasados ? 'proximos' : 'pasados')
  const habitual = competicionHabitual([...(partidos.data ?? []), ...(otros.data ?? [])])
  const [creando, setCreando] = useState(false)

  const nuevo = (
    <Boton icono={<CalendarPlus aria-hidden size={18} />} onClick={() => setCreando(true)}>
      Nuevo partido
    </Boton>
  )

  const importar = (
    <Link
      to="calendario"
      className={estilos.enlaceCalendario}
      aria-label="Importar calendario"
      title="Importar el calendario de la competición"
    >
      <FileUp aria-hidden size={18} />
      <span aria-hidden>Importar calendario</span>
    </Link>
  )

  return (
    <div className={estilos.pagina}>
      <div className={estilos.cabecera}>
        <h1>Partidos</h1>
        {gestiona && (
          <div className={estilos.acciones}>
            {importar}
            {nuevo}
          </div>
        )}
      </div>

      <fieldset className={estilos.segmentos}>
        <legend className="solo-lectores">Ver</legend>
        <button
          type="button"
          aria-pressed={!pasados && !enEstadisticas}
          onClick={() => setParametros({})}
        >
          Próximos
        </button>
        <button
          type="button"
          aria-pressed={pasados}
          onClick={() => setParametros({ ver: 'pasados' })}
        >
          Pasados
        </button>
        <button
          type="button"
          aria-pressed={enEstadisticas}
          onClick={() => setParametros({ ver: 'estadisticas' })}
        >
          Estadísticas
        </button>
      </fieldset>

      {enEstadisticas ? (
        <Estadisticas />
      ) : partidos.isPending ? (
        <Cargando />
      ) : partidos.isError ? (
        <p className={estilos.error} role="alert">
          {partidos.error.message}
        </p>
      ) : partidos.data.length === 0 ? (
        pasados ? (
          <EstadoVacio
            titulo="Todavía no hay partidos jugados"
            descripcion="Los partidos aparecen aquí cuando pasa su fecha."
          />
        ) : (
          <EstadoVacio
            icono={<CalendarDays size={32} />}
            titulo="No hay partidos próximos"
            descripcion={
              gestiona
                ? 'Crea el próximo partido para preparar la convocatoria.'
                : 'Cuando el cuerpo técnico cree el próximo partido, aparecerá aquí.'
            }
            accion={
              gestiona && (
                <div className={estilos.acciones}>
                  {nuevo}
                  {importar}
                </div>
              )
            }
          />
        )
      ) : (
        <ul
          className={estilos.lista}
          aria-label={pasados ? 'Partidos pasados' : 'Próximos partidos'}
        >
          {partidos.data.map((p) => (
            <li key={p.id}>
              <TarjetaPartido
                partido={p}
                conMiConvocatoria={!gestiona && !!plantilla.jugadorId}
                habitual={habitual}
              />
            </li>
          ))}
        </ul>
      )}

      <FormularioPartido
        abierta={creando}
        alCerrar={() => setCreando(false)}
        alGuardar={(p) => navegar(p.id)}
      />
    </div>
  )
}

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// Una fila de la lista (GH-278): cuándo, el rival y casa o fuera (una sola vez, con icono), la
// competición si no es la habitual y la convocatoria; el marcador, a la derecha y en su color. Todas
// las filas tienen la misma altura, tengan o no resultado. Al rol jugador con ficha se le dice si está
// convocado, en vez de cuántos (GH-52)
function TarjetaPartido({
  partido: p,
  conMiConvocatoria,
  habitual,
}: {
  partido: ResumenPartido
  conMiConvocatoria: boolean
  habitual: string | null
}) {
  const cuando = mayuscula(textoFecha(p.fecha))
  const competicion =
    p.competicion && p.competicion !== habitual ? nombreCompeticion(p.competicion) : null
  const tipo = p.estado === 'jugado' ? tipoResultado(p) : null
  const convocatoria =
    p.convocados > 0 && conMiConvocatoria
      ? p.meConvocan
        ? 'Convocado'
        : 'No convocado'
      : p.convocados > 0
        ? `${p.convocados} ${p.convocados === 1 ? 'convocado' : 'convocados'}`
        : 'Sin convocatoria'
  // El partido entero, de una vez: «Domingo, 11 oct, 17:00, Silva SD, en casa, 3 a 2, victoria»
  const leido = [
    cuando.replace(' · ', ', '),
    p.hora,
    p.rival,
    p.local === true ? 'en casa' : p.local === false ? 'fuera' : null,
    competicion,
    tipo && `${p.golesFavor} a ${p.golesContra}, ${TEXTO_RESULTADO[tipo].toLowerCase()}`,
    p.estado === 'aplazado' && 'aplazado',
    convocatoria.toLowerCase(),
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <Link to={p.id} className={estilos.tarjeta} aria-label={leido}>
      <span className={estilos.texto}>
        <span className={estilos.cuando}>
          {cuando}
          {p.hora && ` · ${p.hora}`}
        </span>
        <strong>{p.rival}</strong>
        <span className={estilos.detalles}>
          {p.local !== null && (
            <span className={estilos.lado}>
              {p.local ? <House aria-hidden size={15} /> : <Bus aria-hidden size={15} />}
              {p.local ? 'En casa' : 'Fuera'}
            </span>
          )}
          {competicion && <span className={estilos.competicion}>{competicion}</span>}
          <span
            className={
              p.convocados > 0 && conMiConvocatoria && p.meConvocan
                ? estilos.meConvocan
                : p.convocados === 0
                  ? estilos.pendiente
                  : undefined
            }
          >
            {convocatoria}
          </span>
        </span>
      </span>
      {tipo ? (
        <span className={estilos.marcadorLista} data-resultado={tipo}>
          {p.golesFavor}–{p.golesContra}
        </span>
      ) : (
        p.estado === 'aplazado' && <span className={estilos.aplazadoLista}>Aplazado</span>
      )}
      <ChevronRight aria-hidden size={20} className={estilos.flecha} />
    </Link>
  )
}
