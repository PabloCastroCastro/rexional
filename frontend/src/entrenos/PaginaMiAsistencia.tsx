import { Check, ChevronRight, ClipboardCheck, FileText, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { SinFicha } from '../jugadores/SinFicha'
import { resumenPlan, rutaPlan } from '../planificacion/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  type EntrenoListado,
  type Estado,
  type ResumenEntreno,
  textoFecha,
  textoHoras,
  textoMes,
  useHistorial,
  useProximos,
  useResumenAsistencia,
} from './datos'
import estilos from './Entrenos.module.css'
import { Porcentaje } from './Porcentaje'
import { MiRespuesta, RecuentoRespuestas } from './Respuestas'

const ESTADOS: Record<Estado, { texto: string; icono: typeof Check; clase?: string }> = {
  asiste: { texto: 'Asististe', icono: Check, clase: estilos.asiste },
  justificada: { texto: 'Justificada', icono: FileText, clase: estilos.justificada },
  falta: { texto: 'Faltaste', icono: X, clase: estilos.falta },
}

// Pestaña Entrenos del rol jugador (GH-52): su porcentaje y recuento, los próximos entrenos con su
// respuesta a si va (GH-204) y, por mes, su estado en cada entreno pasado. Pasar lista es cosa del
// cuerpo técnico.
export function PaginaMiAsistencia() {
  const plantilla = usePlantillaActiva()
  const resumen = useResumenAsistencia(plantilla.id)
  const historial = useHistorial(plantilla.id)
  const proximos = useProximos(plantilla.id)

  if (!plantilla.jugadorId) return <SinFicha que="tu asistencia" />
  if (historial.isPending || proximos.isPending || resumen.isPending) return <Cargando />
  if (historial.isError || proximos.isError || resumen.isError) {
    return (
      <p className={estilos.error} role="alert">
        {(historial.error ?? proximos.error ?? resumen.error)?.message}
      </p>
    )
  }

  const mia = resumen.data.find((r) => r.jugadorId === plantilla.jugadorId)
  const meses: { mes: string; entrenos: EntrenoListado[] }[] = []
  for (const e of historial.data) {
    const mes = textoMes(e.fecha)
    if (meses.at(-1)?.mes !== mes) meses.push({ mes, entrenos: [] })
    meses.at(-1)?.entrenos.push(e)
  }

  return (
    <div className={estilos.meses}>
      <section aria-label="Mi asistencia" className={estilos.miResumen}>
        <Porcentaje valor={mia?.porcentaje ?? null} />
        <span className={estilos.recuentos}>
          {mia
            ? `${mia.asiste} ${mia.asiste === 1 ? 'asistencia' : 'asistencias'} · ${mia.justificada} ${mia.justificada === 1 ? 'justificada' : 'justificadas'} · ${mia.falta} ${mia.falta === 1 ? 'falta' : 'faltas'}`
            : 'Todavía no tienes asistencia registrada'}
        </span>
      </section>

      {proximos.data.length > 0 && (
        <section aria-label="Próximos">
          <h2 className={estilos.mes}>Próximos</h2>
          <ul className={estilos.lista}>
            {proximos.data.map((e) => (
              <li key={e.id}>
                <Fila entreno={e} enlace={rutaPlan(plantilla.id, e.id)}>
                  <span className={estilos.planResumen}>{resumenPlan(e) ?? 'Sin plan'}</span>
                  <RecuentoRespuestas respuestas={e.respuestas} />
                </Fila>
                <MiRespuesta entreno={e} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {meses.length === 0 && proximos.data.length === 0 && (
        <EstadoVacio
          icono={<ClipboardCheck size={32} />}
          titulo="Todavía no hay entrenos"
          descripcion="Cuando el cuerpo técnico fije el horario, verás aquí los entrenos y tu asistencia."
        />
      )}

      {meses.map(({ mes, entrenos }) => (
        <section key={mes} aria-label={mes}>
          <h2 className={estilos.mes}>{mes}</h2>
          <ul className={estilos.lista}>
            {entrenos.map((e) => (
              <li key={e.id}>
                {/* Un entreno pasado solo se abre si tiene plan: su lista no es cosa del jugador */}
                <Fila
                  entreno={e}
                  enlace={e.ejerciciosPlan > 0 ? rutaPlan(plantilla.id, e.id) : undefined}
                  derecha={<MiEstado entreno={e} />}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Fila({
  entreno,
  enlace,
  derecha,
  children,
}: {
  entreno: ResumenEntreno
  enlace?: string
  derecha?: ReactNode
  children?: ReactNode
}) {
  const horas = textoHoras(entreno)
  const contenido = (
    <>
      <span className={estilos.nombre}>
        <span>{textoFecha(entreno.fecha)}</span>
        {horas && <span className={estilos.horas}>{horas}</span>}
        {children}
      </span>
      {derecha}
      {enlace && <ChevronRight aria-hidden size={20} className={estilos.secundario} />}
    </>
  )
  return enlace ? (
    <Link to={enlace} className={estilos.entreno}>
      {contenido}
    </Link>
  ) : (
    <div className={estilos.entreno}>{contenido}</div>
  )
}

// Su estado en el entreno; si aún no se pasó lista, se dice; si se pasó sin él, "Sin registrar"
function MiEstado({ entreno }: { entreno: EntrenoListado }) {
  if (entreno.miEstado) {
    const { texto, icono: Icono, clase } = ESTADOS[entreno.miEstado]
    return (
      <span className={`${estilos.recuento} ${clase ?? ''}`}>
        <Icono aria-hidden size={16} />
        {texto}
      </span>
    )
  }
  if (entreno.asiste + entreno.justificada + entreno.falta === 0) {
    return <span className={estilos.sinLista}>Sin pasar lista</span>
  }
  return <span className={estilos.recuento}>Sin registrar</span>
}
