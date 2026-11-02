import { useState } from 'react'
import { Campo } from '../componentes/Campo'
import { BotonesPdf } from '../componentes/CompartirPdf'
import { HojaInferior } from '../componentes/HojaInferior'
import { MensajeCompartible } from '../componentes/MensajeCompartible'
import { hoy } from '../entrenos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { useMensajeMultas } from './datos'
import estilos from './Multas.module.css'

// Exportar la caja (GH-132): el informe en PDF, con rango de fechas y detalle opcionales, y el mensaje
// de quién debe para pegarlo en el grupo de WhatsApp
export function ExportarMultas({ abierta, alCerrar }: { abierta: boolean; alCerrar: () => void }) {
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Exportar multas">
      {/* Se monta al abrir: cada vez empieza sin fechas y con el mensaje al día */}
      {abierta && <Contenido />}
    </HojaInferior>
  )
}

function Contenido() {
  const plantilla = usePlantillaActiva()
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [detalle, setDetalle] = useState(false)
  const mensaje = useMensajeMultas(plantilla.id, true)

  const rangoInvalido = Boolean(desde && hasta && desde > hasta)
  const consulta = new URLSearchParams({
    ...(desde && { desde }),
    ...(hasta && { hasta }),
    ...(detalle && { detalle: 'true' }),
  }).toString()

  return (
    <div className={estilos.exportar}>
      <section className={estilos.seccion} aria-labelledby="exportar-pdf">
        <h3 id="exportar-pdf">Informe en PDF</h3>
        <p className={estilos.secundario}>
          Lo puesto, lo pagado y lo pendiente de cada jugador. Sin fechas, toda la temporada.
        </p>
        <div className={estilos.fechas}>
          <Campo
            etiqueta="Desde"
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => setDesde(e.target.value)}
          />
          <Campo
            etiqueta="Hasta"
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => setHasta(e.target.value)}
            error={rangoInvalido ? 'No puede ser anterior a «Desde»' : undefined}
          />
        </div>
        <label className={estilos.interruptor}>
          <input type="checkbox" checked={detalle} onChange={(e) => setDetalle(e.target.checked)} />
          Con el detalle de cada multa
        </label>
        <div className={estilos.botones}>
          <BotonesPdf
            url={`/api/plantillas/${plantilla.id}/multas/informe.pdf${consulta ? `?${consulta}` : ''}`}
            nombre={`multas-${hoy()}.pdf`}
            titulo={`Multas · ${plantilla.nombre}`}
            disabled={rangoInvalido}
          />
        </div>
      </section>

      <section className={estilos.seccion} aria-labelledby="exportar-mensaje">
        <h3 id="exportar-mensaje">Mensaje para WhatsApp</h3>
        {mensaje.isPending ? (
          <p className={estilos.secundario}>Preparando el mensaje…</p>
        ) : mensaje.isError ? (
          <p className={estilos.error} role="alert">
            {mensaje.error.message}
          </p>
        ) : (
          <MensajeCompartible {...mensaje.data} />
        )}
      </section>
    </div>
  )
}
