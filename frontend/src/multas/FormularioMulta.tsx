import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Plus } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { Selector } from '../componentes/Selector'
import { hoy } from '../entrenos/datos'
import { nombreCompleto, useJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_MULTAS, centimosDe, euros, type Multa, textoImporte, useCatalogo } from './datos'
import estilos from './Multas.module.css'

const OTRO = 'otro'

// Poner multas, en hoja inferior. Tras poner una, se puede poner otra seguida (después de un
// entreno suelen ir varias) o cerrar.
export function FormularioMulta({
  abierta,
  alCerrar,
  jugadorInicial,
}: {
  abierta: boolean
  alCerrar: () => void
  jugadorInicial?: string
}) {
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Poner multa">
      {abierta && <Contenido alCerrar={alCerrar} jugadorInicial={jugadorInicial} />}
    </HojaInferior>
  )
}

function Contenido({
  alCerrar,
  jugadorInicial,
}: {
  alCerrar: () => void
  jugadorInicial?: string
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const jugadores = useJugadores(plantilla.id, true)
  const catalogo = useCatalogo(plantilla.id)
  const [puesta, setPuesta] = useState<Multa | null>(null)
  const [jugadorId, setJugadorId] = useState(jugadorInicial ?? '')
  const [motivoId, setMotivoId] = useState('')
  const [motivoLibre, setMotivoLibre] = useState('')
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(hoy())
  const [errores, setErrores] = useState<Record<string, string>>({})

  function elegirMotivo(id: string) {
    setMotivoId(id)
    // El importe se rellena con el del catálogo; se puede cambiar
    const delCatalogo = catalogo.data?.find((m) => m.id === id)
    if (delCatalogo) setImporte(textoImporte(delCatalogo.importeCentimos))
    else if (id === OTRO) setImporte('')
  }

  const poner = useMutation({
    mutationFn: (importeCentimos: number) =>
      datos(
        api.POST('/api/plantillas/{id}/multas', {
          params: { path: { id: plantilla.id } },
          body:
            motivoId === OTRO
              ? { jugadorId, motivo: motivoLibre.trim(), importeCentimos, fecha }
              : { jugadorId, motivoId, importeCentimos, fecha },
        }),
      ),
    onSuccess: async (multa) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_MULTAS })
      setPuesta(multa)
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: error instanceof Error ? error.message : 'No se ha podido poner' },
      )
    },
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    const nuevos: Record<string, string> = {}
    if (!jugadorId) nuevos.jugadorId = 'Elige el jugador'
    if (!motivoId) nuevos.motivoId = 'Elige el motivo'
    if (motivoId === OTRO && !motivoLibre.trim()) nuevos.motivo = 'Escribe el motivo'
    const centimos = centimosDe(importe)
    if (!centimos) nuevos.importeCentimos = 'Indica un importe mayor que 0, p. ej. 5 o 2,50'
    setErrores(nuevos)
    if (Object.keys(nuevos).length === 0 && centimos) poner.mutate(centimos)
  }

  function otra() {
    // Se mantiene la fecha: las multas de un mismo entreno van juntas
    setPuesta(null)
    setJugadorId('')
    setMotivoId('')
    setMotivoLibre('')
    setImporte('')
    setErrores({})
  }

  if (puesta) {
    return (
      <div className={estilos.formulario}>
        <p className={estilos.puesta} role="status">
          <CircleCheck aria-hidden size={22} />
          <span>
            Multa puesta a <strong>{nombreCompleto(puesta)}</strong>: {puesta.motivo},{' '}
            {euros(puesta.importeCentimos)}
          </span>
        </p>
        <div className={estilos.acciones}>
          <Boton variante="secundario" onClick={alCerrar}>
            Hecho
          </Boton>
          <Boton icono={<Plus aria-hidden size={18} />} onClick={otra}>
            Poner otra
          </Boton>
        </div>
      </div>
    )
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      <Selector
        etiqueta="Jugador"
        value={jugadorId}
        onChange={(e) => setJugadorId(e.target.value)}
        error={errores.jugadorId}
      >
        <option value="">Elige el jugador</option>
        {jugadores.data?.map((j) => (
          <option key={j.jugadorId} value={j.jugadorId}>
            {j.dorsal === null ? '–' : j.dorsal} · {nombreCompleto(j)}
          </option>
        ))}
      </Selector>

      <Selector
        etiqueta="Motivo"
        value={motivoId}
        onChange={(e) => elegirMotivo(e.target.value)}
        error={errores.motivoId}
      >
        <option value="">Elige el motivo</option>
        {catalogo.data?.map((m) => (
          <option key={m.id} value={m.id}>
            {m.descripcion} ({euros(m.importeCentimos)})
          </option>
        ))}
        <option value={OTRO}>Otro…</option>
      </Selector>

      {motivoId === OTRO && (
        <Campo
          etiqueta="¿Por qué?"
          autoComplete="off"
          value={motivoLibre}
          onChange={(e) => setMotivoLibre(e.target.value)}
          error={errores.motivo}
        />
      )}

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
        <Campo
          etiqueta="Fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          error={errores.fecha}
        />
      </div>

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={poner.isPending}>
          Poner multa
        </Boton>
      </div>
    </form>
  )
}
