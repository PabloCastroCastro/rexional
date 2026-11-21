import {
  Bus,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  CircleAlert,
  FileUp,
  House,
} from 'lucide-react'
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
  type TipoResultado,
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
  // En Pasados, primero los que no tienen resultado; después, del más reciente al más antiguo (GH-279)
  const faltaResultado = (p: ResumenPartido) => pasados && p.estado === 'programado'
  const lista = [
    ...(partidos.data ?? []).filter(faltaResultado),
    ...(partidos.data ?? []).filter((p) => !faltaResultado(p)),
  ]
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
        <>
          {pasados && <Racha partidos={partidos.data} />}
          <ul
            className={estilos.lista}
            aria-label={pasados ? 'Partidos pasados' : 'Próximos partidos'}
          >
            {lista.map((p) => (
              <li key={p.id}>
                <TarjetaPartido
                  partido={p}
                  conMiConvocatoria={!gestiona && !!plantilla.jugadorId}
                  habitual={habitual}
                  faltaResultado={faltaResultado(p)}
                />
              </li>
            ))}
          </ul>
        </>
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
  faltaResultado,
}: {
  partido: ResumenPartido
  conMiConvocatoria: boolean
  habitual: string | null
  // Ya pasó y no tiene resultado: lo que importa es eso, no la convocatoria (GH-279)
  faltaResultado: boolean
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
    faltaResultado ? 'falta el resultado' : convocatoria.toLowerCase(),
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
          {faltaResultado ? (
            <span className={estilos.faltaResultado}>
              <CircleAlert aria-hidden size={15} />
              Falta el resultado
            </span>
          ) : (
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
          )}
        </span>
      </span>
      {tipo ? (
        <span className={estilos.marcadorLista} data-resultado={tipo}>
          {p.golesFavor}–{p.golesContra}
        </span>
      ) : faltaResultado ? (
        // El hueco del marcador, por rellenar
        <span className={estilos.marcadorVacio} aria-hidden="true" />
      ) : (
        p.estado === 'aplazado' && <span className={estilos.aplazadoLista}>Aplazado</span>
      )}
      <ChevronRight aria-hidden size={20} className={estilos.flecha} />
    </Link>
  )
}

const LETRA: Record<TipoResultado, string> = { victoria: 'V', empate: 'E', derrota: 'D' }

const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

// «3 victorias, 1 empate y 1 derrota»: solo lo que haya
function enumerar(partes: string[]) {
  return partes.length < 2
    ? (partes[0] ?? '')
    : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
}

// Los últimos cinco resultados, del más antiguo al último, como bolas de color con su letra; debajo,
// el resumen y cuántos pasados faltan por resultado (GH-279). Sin partidos jugados, nada
function Racha({ partidos }: { partidos: ResumenPartido[] }) {
  // Llegan del más reciente al más antiguo
  const ultimos = partidos
    .filter((p) => p.estado === 'jugado')
    .map((p) => tipoResultado(p))
    .filter((t): t is TipoResultado => t !== null)
    .slice(0, 5)
    .reverse()
  if (ultimos.length === 0) return null
  const sinResultado = partidos.filter((p) => p.estado === 'programado').length
  const contar = (tipo: TipoResultado) => ultimos.filter((t) => t === tipo).length
  const resumen = enumerar(
    [
      [contar('victoria'), 'victoria', 'victorias'],
      [contar('empate'), 'empate', 'empates'],
      [contar('derrota'), 'derrota', 'derrotas'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, uno, varios]) => cuantos(n as number, uno as string, varios as string)),
  )
  const titulo = ultimos.length === 5 ? 'Últimos 5' : `Últimos ${ultimos.length}`
  return (
    <section className={estilos.racha} aria-labelledby="titulo-racha">
      <h2 id="titulo-racha">{titulo}</h2>
      <p className="solo-lectores">
        Del más antiguo al último: {ultimos.map((t) => TEXTO_RESULTADO[t].toLowerCase()).join(', ')}
        .
      </p>
      <ol className={estilos.bolas} aria-hidden="true">
        {ultimos.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: la posición en la racha es su identidad
          <li key={i} data-resultado={t}>
            {LETRA[t]}
          </li>
        ))}
      </ol>
      <p className={estilos.resumenRacha}>
        {resumen}
        {sinResultado > 0 &&
          ` · ${cuantos(sinResultado, 'partido sin resultado', 'partidos sin resultado')}`}
      </p>
    </section>
  )
}
