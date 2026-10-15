import { Check, ChevronRight, ClipboardCheck, FileText, X } from 'lucide-react'
import { Link } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { type ResumenEntreno, textoFecha, textoMes, useHistorial, useProximos } from './datos'
import estilos from './Entrenos.module.css'

// Próximos entrenos y, debajo, los pasados por mes, el más reciente primero (la API ya los ordena).
// Cada uno abre ese día y esa sesión en pasar lista, para pasarla o corregirla.
export function PaginaHistorial() {
  const plantilla = usePlantillaActiva()
  const historial = useHistorial(plantilla.id)
  const proximos = useProximos(plantilla.id)
  const base = `/plantillas/${plantilla.id}/entrenos`
  const enlace = (e: ResumenEntreno) => `${base}?fecha=${e.fecha}&entreno=${e.id}`

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

  const meses: { mes: string; entrenos: ResumenEntreno[] }[] = []
  for (const e of historial.data) {
    const mes = textoMes(e.fecha)
    if (meses.at(-1)?.mes !== mes) meses.push({ mes, entrenos: [] })
    meses.at(-1)?.entrenos.push(e)
  }

  return (
    <div className={estilos.meses}>
      {proximos.data.length > 0 && (
        <section aria-label="Próximos">
          <h2 className={estilos.mes}>Próximos</h2>
          <ul className={estilos.lista}>
            {proximos.data.map((e) => (
              <li key={e.id}>
                <Link to={enlace(e)} className={estilos.entreno}>
                  <span className={estilos.nombre}>{cuando(e)}</span>
                  <ChevronRight aria-hidden size={20} className={estilos.secundario} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {meses.map(({ mes, entrenos }) => (
        <section key={mes} aria-label={mes}>
          <h2 className={estilos.mes}>{mes}</h2>
          <ul className={estilos.lista}>
            {entrenos.map((e) => (
              <li key={e.id}>
                <Link to={enlace(e)} className={estilos.entreno}>
                  <span className={estilos.nombre}>{cuando(e)}</span>
                  {e.asiste + e.justificada + e.falta === 0 ? (
                    <span className={estilos.sinLista}>Sin pasar lista</span>
                  ) : (
                    <>
                      <Recuento icono={Check} clase={estilos.asiste} n={e.asiste} texto="asisten" />
                      <Recuento
                        icono={FileText}
                        clase={estilos.justificada}
                        n={e.justificada}
                        texto="justificadas"
                      />
                      <Recuento icono={X} clase={estilos.falta} n={e.falta} texto="faltan" />
                    </>
                  )}
                  <ChevronRight aria-hidden size={20} className={estilos.secundario} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

// "Ayer · martes, 13 oct · 20:00"
const cuando = (e: ResumenEntreno) => `${textoFecha(e.fecha)}${e.hora ? ` · ${e.hora}` : ''}`

function Recuento({
  icono: Icono,
  clase,
  n,
  texto,
}: {
  icono: typeof Check
  clase?: string
  n: number
  texto: string
}) {
  return (
    <span className={`${estilos.recuento} ${clase ?? ''}`}>
      <Icono aria-hidden size={16} />
      {n}
      <span className="solo-lectores"> {texto}</span>
    </span>
  )
}
