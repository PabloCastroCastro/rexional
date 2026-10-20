import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Coins, FileDown, HandCoins, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { nombreCompleto } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_MULTAS, euros, type ResumenMultas, useResumenMultas } from './datos'
import { ExportarMultas } from './ExportarMultas'
import { FormularioMulta } from './FormularioMulta'
import estilos from './Multas.module.css'

type Deuda = ResumenMultas['deudas'][number]

// Caja de la plantilla: lo pendiente, lo cobrado y quién debe, con la acción de saldar y la de
// exportar (PDF y mensaje para WhatsApp)
export function PaginaCaja() {
  const plantilla = usePlantillaActiva()
  const resumen = useResumenMultas(plantilla.id)
  const [poniendo, setPoniendo] = useState(false)
  const [exportando, setExportando] = useState(false)

  if (resumen.isPending) return <Cargando />
  if (resumen.isError) {
    return (
      <p className={estilos.error} role="alert">
        {resumen.error.message}
      </p>
    )
  }
  const { pendienteCentimos, cajaCentimos, deudas } = resumen.data

  return (
    <>
      <div className={estilos.totales}>
        <p className={estilos.total} data-tipo="pendiente">
          <span>Pendiente</span>
          <strong>{euros(pendienteCentimos)}</strong>
        </p>
        <p className={estilos.total} data-tipo="caja">
          <span>En caja</span>
          <strong>{euros(cajaCentimos)}</strong>
        </p>
      </div>

      <div className={estilos.botones}>
        <Boton icono={<Plus aria-hidden size={18} />} onClick={() => setPoniendo(true)}>
          Poner multa
        </Boton>
        <Boton
          variante="secundario"
          icono={<FileDown aria-hidden size={18} />}
          onClick={() => setExportando(true)}
        >
          Exportar
        </Boton>
      </div>

      <section className={estilos.seccion} aria-labelledby="deudas">
        <h2 id="deudas">Quién debe</h2>
        {deudas.length === 0 ? (
          <EstadoVacio
            icono={<Coins size={32} />}
            titulo="Nadie debe nada"
            descripcion="Las multas pendientes de cobro aparecen aquí, por jugador."
          />
        ) : (
          <ul className={estilos.lista} aria-label="Deudas">
            {deudas.map((d) => (
              <li key={d.jugadorId}>
                <FilaDeuda deuda={d} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormularioMulta abierta={poniendo} alCerrar={() => setPoniendo(false)} />
      <ExportarMultas abierta={exportando} alCerrar={() => setExportando(false)} />
    </>
  )
}

function FilaDeuda({ deuda }: { deuda: Deuda }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const nombre = nombreCompleto(deuda)
  const cuantas = `${deuda.multasPendientes} ${deuda.multasPendientes === 1 ? 'multa' : 'multas'}`

  const saldar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/jugadores/{jid}/saldar', {
          params: { path: { id: plantilla.id, jid: deuda.jugadorId } },
        }),
      ),
    onSuccess: async ({ cobradas, importeCentimos }) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_MULTAS })
      avisar({
        tipo: 'exito',
        mensaje: `${nombre}: ${cobradas} ${cobradas === 1 ? 'multa cobrada' : 'multas cobradas'}, ${euros(importeCentimos)}`,
      })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido saldar',
      }),
  })

  return (
    <div className={estilos.fila}>
      <Link
        to={`lista?jugador=${deuda.jugadorId}&estado=pendientes`}
        className={estilos.enlaceFila}
      >
        <Dorsal dorsal={deuda.dorsal} />
        <span className={estilos.texto}>
          <strong>{nombre}</strong>
          <span className={estilos.secundario}>
            {cuantas} · <span className={estilos.importe}>{euros(deuda.pendienteCentimos)}</span>
          </span>
        </span>
        <ChevronRight aria-hidden size={18} className={estilos.secundario} />
      </Link>
      <Boton
        variante="secundario"
        icono={<HandCoins aria-hidden size={18} />}
        cargando={saldar.isPending}
        aria-label={`Saldar las multas de ${nombre}`}
        onClick={async () => {
          const confirmado = await confirmar({
            titulo: `¿Saldar ${cuantas} de ${nombre} (${euros(deuda.pendienteCentimos)})?`,
            mensaje: 'Se marcan como cobradas con la fecha de hoy.',
            textoConfirmar: 'Saldar',
          })
          if (confirmado) saldar.mutate()
        }}
      >
        Saldar
      </Boton>
    </div>
  )
}
