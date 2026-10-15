import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, Save } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { HojaInferior } from '../componentes/HojaInferior'
import { hoy } from '../entrenos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, sugerencias, usePartidos } from './datos'
import estilos from './Partidos.module.css'

// Crear o editar un partido, en hoja inferior. Al crear se abre su ficha.
export function FormularioPartido({
  abierta,
  partido,
  alCerrar,
  alGuardar,
}: {
  abierta: boolean
  // Sin partido, se crea uno nuevo
  partido?: Partido
  alCerrar: () => void
  alGuardar?: (partido: Partido) => void
}) {
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={partido ? `Editar partido contra ${partido.rival}` : 'Nuevo partido'}
    >
      {/* Se monta al abrir: cada vez empieza con los datos del partido o vacío */}
      {abierta && <Contenido partido={partido} alCerrar={alCerrar} alGuardar={alGuardar} />}
    </HojaInferior>
  )
}

const OPCIONES_LOCAL = [
  { valor: true, texto: 'Casa' },
  { valor: false, texto: 'Fuera' },
  { valor: null, texto: 'Sin decidir' },
] as const

function Contenido({
  partido,
  alCerrar,
  alGuardar,
}: {
  partido?: Partido
  alCerrar: () => void
  alGuardar?: (partido: Partido) => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const idCompeticiones = useId()
  const proximos = usePartidos(plantilla.id, 'proximos')
  const pasados = usePartidos(plantilla.id, 'pasados')
  const { competiciones, campoEnCasa } = sugerencias([
    ...(proximos.data ?? []),
    ...(pasados.data ?? []),
  ])

  const [rival, setRival] = useState(partido?.rival ?? '')
  const [competicion, setCompeticion] = useState(partido?.competicion ?? '')
  const [fecha, setFecha] = useState(partido?.fecha ?? hoy())
  const [hora, setHora] = useState(partido?.hora ?? '')
  const [horaCitacion, setHoraCitacion] = useState(partido?.horaCitacion ?? '')
  const [local, setLocal] = useState<boolean | null>(partido?.local ?? null)
  const [lugar, setLugar] = useState(partido?.lugar ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const guardar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        rival: rival.trim(),
        fecha,
        competicion: competicion.trim() || null,
        hora: hora || null,
        horaCitacion: horaCitacion || null,
        lugar: lugar.trim() || null,
        local,
      }
      return partido
        ? datos(
            api.PATCH('/api/plantillas/{id}/partidos/{pid}', {
              params: { path: { id: plantilla.id, pid: partido.id } },
              body: cuerpo,
            }),
          )
        : datos(
            api.POST('/api/plantillas/{id}/partidos', {
              params: { path: { id: plantilla.id } },
              body: cuerpo,
            }),
          )
    },
    onSuccess: async (guardado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
      avisar({
        tipo: 'exito',
        mensaje: partido ? 'Partido guardado' : `Partido contra ${guardado.rival} creado`,
      })
      alGuardar?.(guardado)
      alCerrar()
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      setErrores(
        Object.keys(porCampo).length > 0
          ? porCampo
          : { general: error instanceof Error ? error.message : 'No se ha podido guardar' },
      )
    },
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    if (!rival.trim()) return setErrores({ rival: 'El rival es obligatorio' })
    if (!fecha) return setErrores({ fecha: 'La fecha es obligatoria' })
    guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      <Campo
        etiqueta="Rival"
        required
        autoComplete="off"
        value={rival}
        onChange={(e) => setRival(e.target.value)}
        error={errores.rival}
      />
      <Campo
        etiqueta="Competición"
        autoComplete="off"
        list={idCompeticiones}
        value={competicion}
        onChange={(e) => setCompeticion(e.target.value)}
        error={errores.competicion}
        ayuda="Opcional: liga, copa, amistoso…"
      />
      <datalist id={idCompeticiones}>
        {competiciones.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <div className={estilos.columnas}>
        <Campo
          etiqueta="Fecha"
          type="date"
          required
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          error={errores.fecha}
        />
        <Campo
          etiqueta="Hora"
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          error={errores.hora}
        />
        <Campo
          etiqueta="Citación"
          type="time"
          value={horaCitacion}
          onChange={(e) => setHoraCitacion(e.target.value)}
          error={errores.horaCitacion}
        />
      </div>

      <fieldset className={estilos.grupo}>
        <legend>¿Dónde se juega?</legend>
        <div className={estilos.segmentos}>
          {OPCIONES_LOCAL.map((o) => (
            <button
              key={o.texto}
              type="button"
              aria-pressed={local === o.valor}
              onClick={() => {
                setLocal(o.valor)
                // En casa se propone el campo del último partido en casa
                if (o.valor === true && !lugar.trim() && campoEnCasa) setLugar(campoEnCasa)
              }}
            >
              {o.texto}
            </button>
          ))}
        </div>
      </fieldset>

      <Campo
        etiqueta="Lugar"
        autoComplete="off"
        value={lugar}
        onChange={(e) => setLugar(e.target.value)}
        error={errores.lugar}
        ayuda="Opcional: el campo donde se juega"
      />

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton
          type="submit"
          cargando={guardar.isPending}
          icono={partido ? <Save aria-hidden size={18} /> : <CalendarPlus aria-hidden size={18} />}
        >
          {partido ? 'Guardar' : 'Crear partido'}
        </Boton>
      </div>
    </form>
  )
}
