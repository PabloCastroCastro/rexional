import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, RotateCcw, Save } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { Selector } from '../componentes/Selector'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_MULTAS,
  centimosDe,
  euros,
  type MotivoMulta,
  type TipoTarjeta,
  textoImporte,
  useCatalogo,
} from './datos'
import estilos from './Multas.module.css'

const TARJETAS: Record<TipoTarjeta, string> = { amarilla: 'Amarilla', roja: 'Roja' }

// Catálogo de motivos de la plantilla: lo ve cualquier miembro y lo edita delegado o superior
export function PaginaCatalogo() {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [verDesactivados, setVerDesactivados] = useState(false)
  const catalogo = useCatalogo(plantilla.id, verDesactivados)
  // undefined: hoja cerrada; null: motivo nuevo
  const [editando, setEditando] = useState<MotivoMulta | null | undefined>(undefined)

  return (
    <>
      {gestiona && (
        <div className={estilos.filtros}>
          <label className={estilos.interruptor}>
            <input
              type="checkbox"
              checked={verDesactivados}
              onChange={(e) => setVerDesactivados(e.target.checked)}
            />
            Ver desactivados
          </label>
          <Boton icono={<Plus aria-hidden size={18} />} onClick={() => setEditando(null)}>
            Añadir motivo
          </Boton>
        </div>
      )}

      {catalogo.isPending ? (
        <Cargando />
      ) : catalogo.isError ? (
        <p className={estilos.error} role="alert">
          {catalogo.error.message}
        </p>
      ) : (
        <ul className={estilos.lista} aria-label="Catálogo">
          {catalogo.data.map((m) => (
            <li key={m.id}>
              <div className={estilos.fila} data-activo={m.activo}>
                <span className={estilos.texto}>
                  <strong>{m.descripcion}</strong>
                  <span className={estilos.secundario}>
                    {[
                      m.tipoTarjeta && `Tarjeta ${TARJETAS[m.tipoTarjeta].toLowerCase()}`,
                      !m.activo && 'Desactivado',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {m.tipoTarjeta && (
                  <span
                    className={estilos.tarjeta}
                    data-tarjeta={m.tipoTarjeta}
                    aria-hidden="true"
                  />
                )}
                <span className={estilos.importe}>{euros(m.importeCentimos)}</span>
                {gestiona && (
                  <button
                    type="button"
                    className={estilos.iconoAccion}
                    aria-label={`Editar ${m.descripcion}`}
                    onClick={() => setEditando(m)}
                  >
                    <Pencil aria-hidden size={18} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <HojaInferior
        abierta={editando !== undefined}
        alCerrar={() => setEditando(undefined)}
        titulo={editando ? `Editar ${editando.descripcion}` : 'Añadir motivo'}
      >
        {editando !== undefined && (
          <FormularioMotivo motivo={editando} alCerrar={() => setEditando(undefined)} />
        )}
      </HojaInferior>
    </>
  )
}

function FormularioMotivo({
  motivo,
  alCerrar,
}: {
  motivo: MotivoMulta | null
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [descripcion, setDescripcion] = useState(motivo?.descripcion ?? '')
  const [importe, setImporte] = useState(motivo ? textoImporte(motivo.importeCentimos) : '')
  const [tarjeta, setTarjeta] = useState<TipoTarjeta | ''>(motivo?.tipoTarjeta ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const alFallar = (error: unknown) => {
    const porCampo = erroresPorCampo(error)
    setErrores(
      Object.keys(porCampo).length > 0
        ? porCampo
        : { general: error instanceof Error ? error.message : 'No se ha podido guardar' },
    )
  }

  const guardar = useMutation({
    mutationFn: (importeCentimos: number) => {
      const cuerpo = {
        descripcion: descripcion.trim(),
        importeCentimos,
        tipoTarjeta: tarjeta || null,
      }
      return motivo
        ? datos(
            api.PATCH('/api/plantillas/{id}/motivos-multa/{mid}', {
              params: { path: { id: plantilla.id, mid: motivo.id } },
              body: cuerpo,
            }),
          )
        : datos(
            api.POST('/api/plantillas/{id}/motivos-multa', {
              params: { path: { id: plantilla.id } },
              body: cuerpo,
            }),
          )
    },
    onSuccess: async (guardado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_MULTAS })
      avisar({
        tipo: 'exito',
        mensaje: motivo ? 'Motivo guardado' : `Motivo añadido: ${guardado.descripcion}`,
      })
      alCerrar()
    },
    onError: alFallar,
  })

  const cambiarActivo = useMutation({
    mutationFn: (activo: boolean) =>
      datos(
        api.PATCH('/api/plantillas/{id}/motivos-multa/{mid}', {
          params: { path: { id: plantilla.id, mid: motivo?.id ?? '' } },
          body: { activo },
        }),
      ),
    onSuccess: async (actualizado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_MULTAS })
      avisar({
        tipo: 'exito',
        mensaje: actualizado.activo
          ? `${actualizado.descripcion} vuelve al catálogo`
          : `${actualizado.descripcion} desactivado`,
      })
      alCerrar()
    },
    onError: alFallar,
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    const centimos = centimosDe(importe)
    const nuevos: Record<string, string> = {}
    if (!descripcion.trim()) nuevos.descripcion = 'La descripción es obligatoria'
    if (centimos === null) nuevos.importeCentimos = 'Indica el importe, p. ej. 5 o 2,50'
    setErrores(nuevos)
    if (Object.keys(nuevos).length === 0 && centimos !== null) guardar.mutate(centimos)
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      <Campo
        etiqueta="Descripción"
        required
        autoComplete="off"
        value={descripcion}
        onChange={(e) => setDescripcion(e.target.value)}
        error={errores.descripcion}
      />
      <div className={estilos.columnas}>
        <Campo
          etiqueta="Importe (€)"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0,00"
          value={importe}
          onChange={(e) => setImporte(e.target.value)}
          error={errores.importeCentimos}
        />
        <Selector
          etiqueta="Tarjeta"
          value={tarjeta}
          onChange={(e) => setTarjeta(e.target.value as TipoTarjeta | '')}
        >
          <option value="">Ninguna</option>
          <option value="amarilla">Amarilla</option>
          <option value="roja">Roja</option>
        </Selector>
      </div>
      <p className={estilos.secundario}>
        La tarjeta sirve para proponer este motivo al apuntar una tarjeta en un partido. Cambiar el
        motivo no altera las multas ya puestas.
      </p>

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        {motivo &&
          (motivo.activo ? (
            <Boton
              variante="texto"
              cargando={cambiarActivo.isPending}
              onClick={async () => {
                const confirmado = await confirmar({
                  titulo: `¿Desactivar «${motivo.descripcion}»?`,
                  mensaje: `Dejará de salir al poner multas.${
                    motivo.multas > 0
                      ? ` Las ${motivo.multas} multas ya puestas con este motivo no cambian.`
                      : ''
                  }`,
                  textoConfirmar: 'Desactivar',
                })
                if (confirmado) cambiarActivo.mutate(false)
              }}
            >
              Desactivar
            </Boton>
          ) : (
            <Boton
              variante="texto"
              icono={<RotateCcw aria-hidden size={18} />}
              cargando={cambiarActivo.isPending}
              onClick={() => cambiarActivo.mutate(true)}
            >
              Reactivar
            </Boton>
          ))}
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending} icono={<Save aria-hidden size={18} />}>
          {motivo ? 'Guardar' : 'Añadir'}
        </Boton>
      </div>
    </form>
  )
}
