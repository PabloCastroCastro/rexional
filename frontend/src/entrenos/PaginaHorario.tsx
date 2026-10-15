import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarX, Save } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_ENTRENOS,
  entrenosDelHorario,
  finDeTemporada,
  type Horario,
  hoy,
  textoDiaMes,
  useHorario,
} from './datos'
import estilos from './Entrenos.module.css'

const DIAS = [
  { dia: 1, corto: 'L', nombre: 'lunes' },
  { dia: 2, corto: 'M', nombre: 'martes' },
  { dia: 3, corto: 'X', nombre: 'miércoles' },
  { dia: 4, corto: 'J', nombre: 'jueves' },
  { dia: 5, corto: 'V', nombre: 'viernes' },
  { dia: 6, corto: 'S', nombre: 'sábado' },
  { dia: 7, corto: 'D', nombre: 'domingo' },
]

const HORA_POR_DEFECTO = '20:00'

// "martes y jueves a las 20:00", "lunes a las 19:00 y miércoles a las 20:30"
function textoSesiones(sesiones: Horario['sesiones']) {
  const ordenadas = [...sesiones].sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora))
  const horas = new Set(ordenadas.map((s) => s.hora))
  const nombre = (dia: number) => DIAS.find((d) => d.dia === dia)?.nombre ?? ''
  const unir = (partes: string[]) =>
    partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : (partes[0] ?? '')
  if (horas.size === 1) return `${unir(ordenadas.map((s) => nombre(s.dia)))} a las ${[...horas][0]}`
  return unir(ordenadas.map((s) => `${nombre(s.dia)} a las ${s.hora}`))
}

// Horario semanal de entrenos de la plantilla: al guardarlo se crean sus entrenos
export function PaginaHorario() {
  const plantilla = usePlantillaActiva()
  const horario = useHorario(plantilla.id)

  if (horario.isPending) return <Cargando />
  if (horario.isError) {
    return (
      <p className={estilos.error} role="alert">
        {horario.error.message}
      </p>
    )
  }
  if (!puedeGestionarJugadores(plantilla)) {
    return horario.data ? (
      <p className={estilos.aviso}>
        Entrenos los {textoSesiones(horario.data.sesiones)}, del {textoDiaMes(horario.data.desde)}{' '}
        al {textoDiaMes(horario.data.hasta)}.
      </p>
    ) : (
      <EstadoVacio
        icono={<CalendarClock size={32} />}
        titulo="Sin horario de entrenos"
        descripcion="El cuerpo técnico aún no ha fijado los días de entreno."
      />
    )
  }
  // Se monta con los datos guardados: el formulario empieza con ellos
  return <FormularioHorario guardado={horario.data} />
}

function FormularioHorario({ guardado }: { guardado: Horario | null }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const actual = hoy()
  const [horas, setHoras] = useState<Record<number, string>>(() =>
    Object.fromEntries((guardado?.sesiones ?? []).map((s) => [s.dia, s.hora])),
  )
  const [desde, setDesde] = useState(guardado?.desde ?? actual)
  const [hasta, setHasta] = useState(guardado?.hasta ?? finDeTemporada(plantilla.temporada))
  const [errores, setErrores] = useState<Record<string, string>>({})

  const sesiones = Object.entries(horas)
    .map(([dia, hora]) => ({ dia: Number(dia), hora }))
    .sort((a, b) => a.dia - b.dia)
  const fechasValidas = desde !== '' && hasta !== '' && hasta >= desde
  const aCrear = fechasValidas ? entrenosDelHorario({ desde, hasta, sesiones }, actual) : 0
  const inicio = desde > actual ? desde : actual

  function alternar(dia: number) {
    const nuevas = { ...horas }
    if (dia in nuevas) delete nuevas[dia]
    else nuevas[dia] = sesiones.at(-1)?.hora ?? HORA_POR_DEFECTO
    setHoras(nuevas)
  }

  const refrescar = () => cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS })

  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/plantillas/{id}/horario', {
          params: { path: { id: plantilla.id } },
          body: { desde, hasta, sesiones },
        }),
      ),
    onSuccess: async ({ creados, borrados }) => {
      await refrescar()
      avisar({
        tipo: 'exito',
        mensaje: `Horario guardado: ${creados} ${creados === 1 ? 'entreno creado' : 'entrenos creados'}${
          borrados ? ` y ${borrados} rehechos` : ''
        }`,
      })
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

  const quitar = useMutation({
    mutationFn: () =>
      datos(api.DELETE('/api/plantillas/{id}/horario', { params: { path: { id: plantilla.id } } })),
    onSuccess: async ({ borrados }) => {
      await refrescar()
      setHoras({})
      avisar({ tipo: 'exito', mensaje: `Horario quitado: ${borrados} entrenos futuros borrados` })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido quitar',
      }),
  })

  function enviarFormulario(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    if (sesiones.length === 0) return setErrores({ sesiones: 'Marca al menos un día de entreno' })
    if (!fechasValidas) return setErrores({ hasta: 'Debe ser posterior a «desde»' })
    guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
      <p className={estilos.secundario}>
        Al guardar se crean los entrenos de esos días. Los entrenos sueltos y los que ya tienen la
        lista pasada no se tocan.
      </p>

      <fieldset className={estilos.diasSemana}>
        <legend>Días de entreno</legend>
        <div className={estilos.botonesDias}>
          {DIAS.map((d) => (
            <button
              key={d.dia}
              type="button"
              aria-pressed={d.dia in horas}
              aria-label={d.nombre}
              title={d.nombre}
              onClick={() => alternar(d.dia)}
            >
              {d.corto}
            </button>
          ))}
        </div>
        {errores.sesiones && (
          <p className={estilos.errorCampo} role="alert">
            {errores.sesiones}
          </p>
        )}
      </fieldset>

      {sesiones.length > 0 && (
        <div className={estilos.horasDias}>
          {sesiones.map((s) => (
            <Campo
              key={s.dia}
              etiqueta={`Hora del ${DIAS.find((d) => d.dia === s.dia)?.nombre}`}
              type="time"
              value={s.hora}
              onChange={(e) => setHoras({ ...horas, [s.dia]: e.target.value })}
            />
          ))}
        </div>
      )}

      <div className={estilos.horasDias}>
        <Campo
          etiqueta="Desde"
          type="date"
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          error={errores.desde}
        />
        <Campo
          etiqueta="Hasta"
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => setHasta(e.target.value)}
          error={errores.hasta}
          ayuda="El último día con entrenos: 25 de mayo, 15 de junio…"
        />
      </div>

      {sesiones.length > 0 && fechasValidas && (
        <p className={estilos.aviso} role="status">
          {aCrear === 0
            ? 'Con estas fechas no se crea ningún entreno.'
            : `Se crearán ${aCrear} ${aCrear === 1 ? 'entreno' : 'entrenos'}: los ${textoSesiones(sesiones)}, del ${textoDiaMes(inicio)} al ${textoDiaMes(hasta)}.`}
          {guardado && ' Los entrenos futuros del horario que aún no tienen asistencia se rehacen.'}
        </p>
      )}

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        <Boton type="submit" cargando={guardar.isPending} icono={<Save aria-hidden size={18} />}>
          Guardar horario
        </Boton>
        {guardado && (
          <Boton
            variante="texto"
            icono={<CalendarX aria-hidden size={18} />}
            cargando={quitar.isPending}
            onClick={async () => {
              const confirmado = await confirmar({
                titulo: '¿Quitar el horario?',
                mensaje:
                  'Se borran los entrenos futuros del horario que no tienen asistencia. Los pasados y los sueltos se conservan.',
                textoConfirmar: 'Quitar horario',
                textoCancelar: 'Volver',
                peligrosa: true,
              })
              if (confirmado) quitar.mutate()
            }}
          >
            Quitar horario
          </Boton>
        )}
      </div>
    </form>
  )
}
