import { Check, ChevronRight, ClipboardCheck, FileText, X } from 'lucide-react'
import { Link } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { type ResumenEntreno, textoFecha, textoMes, useHistorial } from './datos'
import estilos from './Entrenos.module.css'

// Entrenos de la plantilla por mes, el más reciente primero (la API ya los ordena). Cada uno abre
// ese día en pasar lista para corregirlo.
export function PaginaHistorial() {
  const plantilla = usePlantillaActiva()
  const historial = useHistorial(plantilla.id)
  const pasarLista = `/plantillas/${plantilla.id}/entrenos`

  if (historial.isPending) return <Cargando />
  if (historial.isError) {
    return (
      <p className={estilos.error} role="alert">
        {historial.error.message}
      </p>
    )
  }
  if (historial.data.length === 0) {
    return (
      <EstadoVacio
        icono={<ClipboardCheck size={32} />}
        titulo="Todavía no hay entrenos"
        descripcion="Cada día en que se pasa lista aparece aquí con su asistencia."
        accion={puedeGestionarJugadores(plantilla) && <Link to={pasarLista}>Pasar lista hoy</Link>}
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
      {meses.map(({ mes, entrenos }) => (
        <section key={mes} aria-label={mes}>
          <h2 className={estilos.mes}>{mes}</h2>
          <ul className={estilos.lista}>
            {entrenos.map((e) => (
              <li key={e.id}>
                <Link to={`${pasarLista}?fecha=${e.fecha}`} className={estilos.entreno}>
                  <span className={estilos.nombre}>
                    {textoFecha(e.fecha)}
                    {e.hora && ` · ${e.hora}`}
                  </span>
                  <Recuento icono={Check} clase={estilos.asiste} n={e.asiste} texto="asisten" />
                  <Recuento
                    icono={FileText}
                    clase={estilos.justificada}
                    n={e.justificada}
                    texto="justificadas"
                  />
                  <Recuento icono={X} clase={estilos.falta} n={e.falta} texto="faltan" />
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
