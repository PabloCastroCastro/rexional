import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Hand,
  X,
} from 'lucide-react'
import { useId, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { resumenPlan } from '../planificacion/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  type EntrenoListado,
  hoy,
  type ResumenEntreno,
  textoFecha,
  textoHoras,
  textoMes,
  useHistorial,
  useProximos,
} from './datos'
import estilos from './Entrenos.module.css'
import { Porcentaje } from './Porcentaje'

// Próximos entrenos y, debajo, los pasados por mes, el más reciente primero (la API ya los ordena).
// Cada uno abre ese día y esa sesión en pasar lista, para pasarla o corregirla.
export function PaginaHistorial() {
  const plantilla = usePlantillaActiva()
  const historial = useHistorial(plantilla.id)
  const proximos = useProximos(plantilla.id)
  const base = `/plantillas/${plantilla.id}/entrenos`
  const enlace = (e: ResumenEntreno) => `${base}?fecha=${e.fecha}&entreno=${e.id}`

  // El rol jugador ve su asistencia en el índice de la pestaña (GH-52)
  if (!puedeGestionarJugadores(plantilla)) return <Navigate to={base} replace />
  if (historial.isPending || proximos.isPending) return <Cargando />
  if (historial.isError || proximos.isError) {
    return (
      <p className={estilos.error} role="alert">
        {(historial.error ?? proximos.error)?.message}
      </p>
    )
  }
  if (historial.data.length === 0 && proximos.data.length === 0) {
    return (
      <EstadoVacio
        icono={<ClipboardCheck size={32} />}
        titulo="Todavía no hay entrenos"
        descripcion="Con el horario de la plantilla se crean los entrenos de la temporada; también se pueden crear sueltos desde Pasar lista."
        accion={
          puedeGestionarJugadores(plantilla) && <Link to={`${base}/horario`}>Fijar el horario</Link>
        }
      />
    )
  }

  // Los de hoy sin lista pasada aún son próximos, con el recuento de respuestas (GH-215)
  const deHoy = historial.data
    .filter((e) => e.fecha === hoy() && e.asiste + e.justificada + e.falta === 0)
    .sort((a, b) => (a.hora ?? '').localeCompare(b.hora ?? ''))
  const siguientes = [...deHoy, ...proximos.data]
  const meses: { mes: string; entrenos: ResumenEntreno[] }[] = []
  for (const e of historial.data.filter((e) => !deHoy.includes(e))) {
    const mes = textoMes(e.fecha)
    if (meses.at(-1)?.mes !== mes) meses.push({ mes, entrenos: [] })
    meses.at(-1)?.entrenos.push(e)
  }

  // El historial empieza por el pasado: arriba solo el próximo, en una línea, y el resto plegado
  // (GH-264)
  const [proximo, ...masProximos] = siguientes
  const filaProximo = (e: EntrenoListado) => (
    <li key={e.id}>
      {/* Un entreno futuro se abre en su día: el plan y quién va (GH-204) */}
      <Link to={enlace(e)} className={estilos.entreno}>
        <span className={estilos.nombre}>
          <span>
            {textoFecha(e.fecha)}
            {textoHoras(e) && ` · ${textoHoras(e)}`}
          </span>
          <span className={estilos.recuentoRespuestas}>{textoRespuestas(e.respuestas)}</span>
        </span>
        {resumenPlan(e) && (
          <ClipboardList
            className={estilos.conPlan}
            size={18}
            role="img"
            aria-label={`Con plan: ${resumenPlan(e)}`}
          >
            <title>{`Con plan: ${resumenPlan(e)}`}</title>
          </ClipboardList>
        )}
        <ChevronRight aria-hidden size={20} className={estilos.secundario} />
      </Link>
    </li>
  )

  return (
    <div className={estilos.meses}>
      {proximo && (
        <section aria-label="Próximos">
          <h2 className={estilos.mes}>Próximo</h2>
          <ul className={estilos.lista}>{filaProximo(proximo)}</ul>
          {masProximos.length > 0 && (
            <details className={estilos.masProximos}>
              <summary>
                {masProximos.length} {masProximos.length === 1 ? 'próximo más' : 'próximos más'}
              </summary>
              <ul className={estilos.lista}>{masProximos.map(filaProximo)}</ul>
            </details>
          )}
        </section>
      )}
      {meses.map(({ mes, entrenos }) => (
        <MesHistorial
          key={mes}
          mes={mes}
          entrenos={entrenos}
          // El mes en curso y el anterior, abiertos; los más antiguos, plegados (GH-266)
          abiertoAlEmpezar={entrenos[0] !== undefined && entrenos[0].fecha >= inicioMesAnterior()}
          enlace={enlace}
        />
      ))}
    </div>
  )
}

// Primer día del mes anterior al de hoy, «AAAA-MM-01»
const inicioMesAnterior = () => {
  const [anio, mes] = hoy().split('-').map(Number) as [number, number]
  return mes === 1 ? `${anio - 1}-12-01` : `${anio}-${String(mes - 1).padStart(2, '0')}-01`
}

// «10 entrenos · 72 % asistencia · 6 sin lista» (GH-266): la media es asisten entre marcados, solo de
// los entrenos con lista
const resumenMes = (entrenos: ResumenEntreno[]) => {
  const conLista = entrenos.filter((e) => e.asiste + e.justificada + e.falta > 0)
  const cuantos = `${entrenos.length} ${entrenos.length === 1 ? 'entreno' : 'entrenos'}`
  if (conLista.length === 0) return `${cuantos} · ninguna lista pasada`
  const asisten = conLista.reduce((s, e) => s + e.asiste, 0)
  const marcados = conLista.reduce((s, e) => s + e.asiste + e.justificada + e.falta, 0)
  const sinLista = entrenos.length - conLista.length
  return [
    cuantos,
    `${Math.round((asisten / marcados) * 100)} % asistencia`,
    sinLista > 0 && `${sinLista} sin lista`,
  ]
    .filter(Boolean)
    .join(' · ')
}

// Un mes del historial: la cabecera con su resumen, fija arriba mientras se baja por el mes, que lo
// abre y lo cierra
function MesHistorial({
  mes,
  entrenos,
  abiertoAlEmpezar,
  enlace,
}: {
  mes: string
  entrenos: ResumenEntreno[]
  abiertoAlEmpezar: boolean
  enlace: (e: ResumenEntreno) => string
}) {
  const [abierto, setAbierto] = useState(abiertoAlEmpezar)
  const idLista = useId()
  return (
    <section aria-label={mes}>
      <h2 className={estilos.cabeceraMes}>
        <button
          type="button"
          aria-expanded={abierto}
          aria-controls={idLista}
          className={estilos.botonMes}
          onClick={() => setAbierto(!abierto)}
        >
          <ChevronDown aria-hidden size={18} className={estilos.flechaMes} />
          <span>
            <span className={estilos.nombreMes}>{mayuscula(mes)}</span> · {resumenMes(entrenos)}
          </span>
        </button>
      </h2>
      <ul id={idLista} className={estilos.lista} hidden={!abierto}>
        {abierto &&
          porDia(entrenos).map((sesiones) =>
            sesiones.length === 1 ? (
              <li key={sesiones[0]?.id}>
                {sesiones[0] && <FilaPasado entreno={sesiones[0]} enlace={enlace(sesiones[0])} />}
              </li>
            ) : (
              // Varias sesiones el mismo día: una fila con el día y, debajo, cada sesión (GH-267)
              <li key={sesiones[0]?.fecha} className={estilos.diaConSesiones}>
                <p className={estilos.cabeceraDia}>
                  <span>{mayuscula(textoFecha(sesiones[0]?.fecha ?? ''))}</span>
                  <span className={estilos.horas}>{sesiones.length} sesiones</span>
                </p>
                <ul className={estilos.sesionesDia}>
                  {sesiones.map((e) => (
                    <li key={e.id}>
                      <FilaPasado entreno={e} enlace={enlace(e)} sesion />
                    </li>
                  ))}
                </ul>
              </li>
            ),
          )}
      </ul>
    </section>
  )
}

// Las respuestas de un próximo entreno, sin ceros ni los que no han respondido: «10 van · 2 dudan»
const textoRespuestas = (r: EntrenoListado['respuestas']) =>
  [
    r.voy && `${r.voy} ${r.voy === 1 ? 'va' : 'van'}`,
    r.duda && `${r.duda} ${r.duda === 1 ? 'duda' : 'dudan'}`,
    r.noVoy && `${r.noVoy} no ${r.noVoy === 1 ? 'va' : 'van'}`,
  ]
    .filter(Boolean)
    .join(' · ') || 'Sin respuestas'

// Asistencia de un entreno: asisten entre marcados, redondeado; null si no tiene lista
const porcentajeEntreno = (e: ResumenEntreno) => {
  const marcados = e.asiste + e.justificada + e.falta
  return marcados ? Math.round((e.asiste / marcados) * 100) : null
}

// Un entreno pasado (GH-265): el día y, debajo, la hora y los recuentos; a la derecha, el porcentaje
// con su color y una barra con la proporción de cada estado. El lector de pantalla lo lee entero
function FilaPasado({
  entreno: e,
  enlace,
  sesion = false,
}: {
  entreno: ResumenEntreno
  enlace: string
  sesion?: boolean
}) {
  const horas = textoHoras(e)
  const porcentaje = porcentajeEntreno(e)
  const dia = mayuscula(textoFecha(e.fecha))
  const recuentos = [
    {
      n: e.asiste,
      icono: Check,
      clase: estilos.asiste,
      texto: e.asiste === 1 ? 'asiste' : 'asisten',
    },
    {
      n: e.justificada,
      icono: Hand,
      clase: estilos.justificada,
      texto: e.justificada === 1 ? 'justificada' : 'justificadas',
    },
    { n: e.falta, icono: X, clase: estilos.falta, texto: e.falta === 1 ? 'falta' : 'faltan' },
  ]
  const etiqueta =
    porcentaje === null
      ? `${dia}${horas ? `, ${horas}` : ''}: sin pasar lista`
      : `${dia}${horas ? `, ${horas}` : ''}: ${porcentaje} % de asistencia, ${recuentos
          .map((r) => `${r.n} ${r.texto}`)
          .join(', ')}`
  const total = e.asiste + e.justificada + e.falta
  const ancho = (n: number) => `${(n / total) * 100}%`

  return (
    <Link to={enlace} className={estilos.entreno} aria-label={etiqueta}>
      <span className={estilos.nombre}>
        {/* Una sesión de un día con varias: el día ya va en su grupo, arriba la hora (GH-267) */}
        <span>{sesion ? (horas ?? 'Sin hora') : dia}</span>
        <span className={estilos.lineaPasado}>
          {horas && !sesion && <span className={estilos.horas}>{horas}</span>}
          {porcentaje !== null &&
            recuentos.map(({ n, icono: Icono, clase }) => (
              // Los ceros, en gris: solo lo que hay lleva color
              <span key={clase} className={`${estilos.recuento} ${n ? clase : ''}`}>
                <Icono aria-hidden size={14} />
                {n}
              </span>
            ))}
        </span>
      </span>
      {porcentaje === null ? (
        <span className={estilos.sinLista}>Sin pasar lista</span>
      ) : (
        <span className={estilos.asistenciaEntreno}>
          <Porcentaje valor={porcentaje} />
          <span className={estilos.progreso}>
            <span className={estilos.asiste} style={{ width: ancho(e.asiste) }} />
            <span className={estilos.justificada} style={{ width: ancho(e.justificada) }} />
            <span className={estilos.falta} style={{ width: ancho(e.falta) }} />
          </span>
        </span>
      )}
      <ChevronRight aria-hidden size={20} className={estilos.secundario} />
    </Link>
  )
}

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// Los entrenos de un mes por día, en el orden de la API (del más reciente al más antiguo y, en un
// mismo día, por hora)
const porDia = (entrenos: ResumenEntreno[]) => {
  const dias: ResumenEntreno[][] = []
  for (const e of entrenos) {
    const ultimo = dias.at(-1)
    if (ultimo?.[0]?.fecha === e.fecha) ultimo.push(e)
    else dias.push([e])
  }
  return dias
}
