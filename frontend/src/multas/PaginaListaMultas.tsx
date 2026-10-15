import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Coins, Plus, Trash2, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, datos, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { Selector } from '../componentes/Selector'
import { hoy, textoFecha } from '../entrenos/datos'
import { nombreCompleto, puedeGestionarJugadores, useJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_MULTAS, type EstadoMulta, euros, type Multa, useMultas } from './datos'
import { FormularioMulta } from './FormularioMulta'
import estilos from './Multas.module.css'

const FILTROS: { estado: EstadoMulta | undefined; texto: string }[] = [
  { estado: 'pendientes', texto: 'Pendientes' },
  { estado: 'cobradas', texto: 'Cobradas' },
  { estado: undefined, texto: 'Todas' },
]

// Multas de la plantilla con filtros (?estado=pendientes|cobradas|todas&jugador=id). El rol jugador
// solo recibe las suyas, sin acciones.
export function PaginaListaMultas() {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [parametros, setParametros] = useSearchParams()
  const pedido = parametros.get('estado')
  const estado: EstadoMulta | undefined =
    pedido === 'cobradas' ? 'cobradas' : pedido === 'todas' ? undefined : 'pendientes'
  const jugador = parametros.get('jugador') ?? undefined
  const multas = useMultas(plantilla.id, { estado, jugador: gestiona ? jugador : undefined })
  const jugadores = useJugadores(plantilla.id, true)
  const [poniendo, setPoniendo] = useState(false)

  const filtrar = (cambios: Record<string, string | undefined>) => {
    const nuevos = new URLSearchParams(parametros)
    for (const [clave, valor] of Object.entries(cambios)) {
      if (valor) nuevos.set(clave, valor)
      else nuevos.delete(clave)
    }
    setParametros(nuevos)
  }

  const total = (multas.data ?? []).reduce((suma, m) => suma + m.importeCentimos, 0)

  return (
    <>
      <fieldset className={estilos.segmentos}>
        <legend className="solo-lectores">Estado</legend>
        {FILTROS.map((f) => (
          <button
            key={f.texto}
            type="button"
            aria-pressed={estado === f.estado}
            onClick={() => filtrar({ estado: f.estado ?? 'todas' })}
          >
            {f.texto}
          </button>
        ))}
      </fieldset>

      {gestiona && (
        <div className={estilos.filtros}>
          <Selector
            etiqueta="Jugador"
            value={jugador ?? ''}
            onChange={(e) => filtrar({ jugador: e.target.value || undefined })}
          >
            <option value="">Todos los jugadores</option>
            {jugadores.data?.map((j) => (
              <option key={j.jugadorId} value={j.jugadorId}>
                {nombreCompleto(j)}
              </option>
            ))}
          </Selector>
          <Boton icono={<Plus aria-hidden size={18} />} onClick={() => setPoniendo(true)}>
            Poner multa
          </Boton>
        </div>
      )}

      {multas.isPending ? (
        <Cargando />
      ) : multas.isError ? (
        <p className={estilos.error} role="alert">
          {multas.error.message}
        </p>
      ) : multas.data.length === 0 ? (
        <EstadoVacio
          icono={<Coins size={32} />}
          titulo={
            estado === 'pendientes'
              ? 'No hay multas pendientes'
              : estado === 'cobradas'
                ? 'No hay multas cobradas'
                : 'No hay multas'
          }
        />
      ) : (
        <>
          <p className={estilos.secundario}>
            {multas.data.length} {multas.data.length === 1 ? 'multa' : 'multas'} · {euros(total)}
          </p>
          <ul className={estilos.lista} aria-label="Multas">
            {multas.data.map((m) => (
              <li key={m.id}>
                <FilaMulta multa={m} gestiona={gestiona} />
              </li>
            ))}
          </ul>
        </>
      )}

      <FormularioMulta
        abierta={poniendo}
        alCerrar={() => setPoniendo(false)}
        jugadorInicial={jugador}
      />
    </>
  )
}

function FilaMulta({ multa, gestiona }: { multa: Multa; gestiona: boolean }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const nombre = nombreCompleto(multa)
  const cobrada = multa.fechaPago !== null

  const refrescar = () => cliente.invalidateQueries({ queryKey: CLAVE_MULTAS })
  const fallo = (error: unknown) =>
    avisar({ tipo: 'error', mensaje: error instanceof Error ? error.message : 'No se ha podido' })

  const cobrar = useMutation({
    mutationFn: (fechaPago: string | null) =>
      datos(
        api.PATCH('/api/plantillas/{id}/multas/{mid}', {
          params: { path: { id: plantilla.id, mid: multa.id } },
          body: { fechaPago },
        }),
      ),
    onSuccess: async (actualizada) => {
      await refrescar()
      avisar({
        tipo: 'exito',
        mensaje: actualizada.fechaPago
          ? `Cobrada: ${nombre}, ${euros(actualizada.importeCentimos)}`
          : `Cobro deshecho: ${nombre}`,
      })
    },
    onError: fallo,
  })

  const borrar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/plantillas/{id}/multas/{mid}', {
          params: { path: { id: plantilla.id, mid: multa.id } },
        }),
      ),
    onSuccess: async () => {
      await refrescar()
      avisar({ tipo: 'exito', mensaje: 'Multa borrada' })
    },
    onError: fallo,
  })

  return (
    <div className={estilos.fila} data-cobrada={cobrada}>
      <span className={estilos.texto}>
        <strong>{nombre}</strong>
        <span>{multa.motivo}</span>
        <span className={estilos.secundario}>
          {textoFecha(multa.fecha)}
          {cobrada && multa.fechaPago && ` · cobrada ${textoFecha(multa.fechaPago).toLowerCase()}`}
        </span>
      </span>
      <span className={estilos.importe}>{euros(multa.importeCentimos)}</span>
      {gestiona && (
        <span className={estilos.botonesFila}>
          {cobrada ? (
            <button
              type="button"
              className={estilos.iconoAccion}
              aria-label={`Deshacer el cobro de ${nombre}: ${multa.motivo}`}
              title="Deshacer el cobro"
              disabled={cobrar.isPending}
              onClick={() => cobrar.mutate(null)}
            >
              <Undo2 aria-hidden size={18} />
            </button>
          ) : (
            <button
              type="button"
              className={`${estilos.iconoAccion} ${estilos.cobrar}`}
              aria-label={`Cobrar a ${nombre}: ${multa.motivo}`}
              title="Cobrar"
              disabled={cobrar.isPending}
              onClick={() => cobrar.mutate(multa.fecha > hoy() ? multa.fecha : hoy())}
            >
              <Check aria-hidden size={18} />
            </button>
          )}
          <button
            type="button"
            className={`${estilos.iconoAccion} ${estilos.peligro}`}
            aria-label={`Borrar la multa de ${nombre}: ${multa.motivo}`}
            title="Borrar"
            disabled={borrar.isPending}
            onClick={async () => {
              const confirmado = await confirmar({
                titulo: `¿Borrar la multa de ${nombre}?`,
                mensaje: `${multa.motivo}, ${euros(multa.importeCentimos)}. No se puede deshacer.`,
                textoConfirmar: 'Borrar multa',
                peligrosa: true,
              })
              if (confirmado) borrar.mutate()
            }}
          >
            <Trash2 aria-hidden size={18} />
          </button>
        </span>
      )}
    </div>
  )
}
