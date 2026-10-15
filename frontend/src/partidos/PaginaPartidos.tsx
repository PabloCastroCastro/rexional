import { CalendarDays, CalendarPlus, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { textoFecha } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { type ResumenPartido, textoLocal, textoResultado, usePartidos } from './datos'
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
  const [creando, setCreando] = useState(false)

  const nuevo = (
    <Boton icono={<CalendarPlus aria-hidden size={18} />} onClick={() => setCreando(true)}>
      Nuevo partido
    </Boton>
  )

  return (
    <div className={estilos.pagina}>
      <div className={estilos.cabecera}>
        <h1>Partidos</h1>
        {gestiona && nuevo}
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
            accion={gestiona && nuevo}
          />
        )
      ) : (
        <ul
          className={estilos.lista}
          aria-label={pasados ? 'Partidos pasados' : 'Próximos partidos'}
        >
          {partidos.data.map((p) => (
            <li key={p.id}>
              <TarjetaPartido partido={p} />
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

function TarjetaPartido({ partido: p }: { partido: ResumenPartido }) {
  const lugar = textoLocal(p.local)
  return (
    <Link to={p.id} className={estilos.tarjeta}>
      <span className={estilos.texto}>
        <span className={estilos.cuando}>
          {textoFecha(p.fecha)}
          {p.hora && ` · ${p.hora}`}
        </span>
        <strong>
          {p.local === false ? 'en ' : 'vs '}
          {p.rival}
        </strong>
        {p.estado !== 'programado' && (
          <span className={estilos.resultadoLista} data-estado={p.estado}>
            {p.estado === 'jugado' ? textoResultado(p) : 'Aplazado'}
          </span>
        )}
        <span className={estilos.detalles}>
          {lugar && <span className={estilos.etiqueta}>{lugar}</span>}
          {p.competicion && <span>{p.competicion}</span>}
          {p.convocados > 0 ? (
            <span>
              {p.convocados} {p.convocados === 1 ? 'convocado' : 'convocados'}
            </span>
          ) : (
            <span className={estilos.pendiente}>Sin convocatoria</span>
          )}
        </span>
      </span>
      <ChevronRight aria-hidden size={20} className={estilos.flecha} />
    </Link>
  )
}
