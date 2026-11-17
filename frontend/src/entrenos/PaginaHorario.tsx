import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, CalendarX, Pencil, Save } from 'lucide-react'
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
  type SimulacionHorario,
  sumarDias,
  textoDiaMes,
  textoFecha,
  textoHoras,
  useCifrasHorario,
  useHorario,
  useSiguienteEntreno,
  useSimulacionHorario,
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
  const franja = (s: Horario['sesiones'][number]) =>
    s.horaFin ? `de ${s.hora} a ${s.horaFin}` : `a las ${s.hora}`
  const horas = new Set(ordenadas.map(franja))
  const nombre = (dia: number) => DIAS.find((d) => d.dia === dia)?.nombre ?? ''
  const unir = (partes: string[]) =>
    partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}` : (partes[0] ?? '')
  if (horas.size === 1) return `${unir(ordenadas.map((s) => nombre(s.dia)))} ${[...horas][0]}`
  return unir(ordenadas.map((s) => `${nombre(s.dia)} ${franja(s)}`))
}

// El horario en una forma comparable: sesiones por día y hora, y sin fin como null
const normalizar = (h: Horario) =>
  JSON.stringify({
    desde: h.desde,
    hasta: h.hasta,
    sesiones: [...h.sesiones]
      .map((s) => ({ dia: s.dia, hora: s.hora, horaFin: s.horaFin || null }))
      .sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora)),
  })

// «los miércoles», «los sábados»
const plural = (dia: number) => {
  const nombre = DIAS.find((d) => d.dia === dia)?.nombre ?? ''
  return nombre.endsWith('s') ? nombre : `${nombre}s`
}

// Lo que cambia al guardar respecto al horario guardado (GH-269), una línea por día de la semana. La
// franja solo se dice si el mismo día sale más de una vez
function AvisoCambios({ simulacion }: { simulacion: SimulacionHorario }) {
  const { anadidos, quitados, cambios } = simulacion
  const entrenos = (n: number) => `${n} ${n === 1 ? 'entreno' : 'entrenos'}`
  const repetido = (lista: { dia: number }[], dia: number) =>
    lista.filter((x) => x.dia === dia).length > 1
  const lineas = [
    ...anadidos.map(
      (a) =>
        `+ Se ${a.cuantos === 1 ? 'añade' : 'añaden'} ${entrenos(a.cuantos)} ${
          a.cuantos === 1 ? 'el' : 'los'
        } ${a.cuantos === 1 ? DIAS.find((d) => d.dia === a.dia)?.nombre : plural(a.dia)}${
          repetido(anadidos, a.dia) ? ` a las ${a.franja}` : ''
        }`,
    ),
    ...quitados.map(
      (q) =>
        `− Se ${q.cuantos === 1 ? 'quita' : 'quitan'} ${entrenos(q.cuantos)} ${
          q.cuantos === 1 ? 'del' : 'de los'
        } ${q.cuantos === 1 ? DIAS.find((d) => d.dia === q.dia)?.nombre : plural(q.dia)}${
          repetido(quitados, q.dia) ? ` de las ${q.franja}` : ''
        }`,
    ),
    ...cambios.map(
      (c) =>
        `↻ Cambia la hora de ${entrenos(c.cuantos)} ${c.cuantos === 1 ? 'del' : 'de los'} ${
          c.cuantos === 1 ? DIAS.find((d) => d.dia === c.dia)?.nombre : plural(c.dia)
        }: de ${c.de} a ${c.a}`,
    ),
  ]
  return (
    <div className={estilos.aviso} role="status">
      {lineas.length === 0 ? (
        <p>No cambia ningún entreno.</p>
      ) : (
        <ul className={estilos.listaCambios}>
          {lineas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <p className={estilos.secundario}>
        Los entrenos sueltos y los que ya tienen la lista pasada, plan o respuestas no se tocan.
      </p>
    </div>
  )
}

// Horario semanal de entrenos de la plantilla: al guardarlo se crean sus entrenos. Guardado, se ve
// como un resumen de solo lectura; el cuerpo técnico lo cambia con «Editar horario» (GH-268)
export function PaginaHorario() {
  const plantilla = usePlantillaActiva()
  const horario = useHorario(plantilla.id)
  const gestiona = puedeGestionarJugadores(plantilla)
  const [editando, setEditando] = useState(false)

  if (horario.isPending) return <Cargando />
  if (horario.isError) {
    return (
      <p className={estilos.error} role="alert">
        {horario.error.message}
      </p>
    )
  }
  if (!horario.data) {
    // Sin horario, el cuerpo técnico va directo al formulario
    return gestiona ? (
      <FormularioHorario guardado={null} />
    ) : (
      <EstadoVacio
        icono={<CalendarClock size={32} />}
        titulo="Sin horario de entrenos"
        descripcion="El cuerpo técnico aún no ha fijado los días de entreno."
      />
    )
  }
  if (gestiona && editando) {
    // Se monta con los datos guardados: el formulario empieza con ellos
    return <FormularioHorario guardado={horario.data} alTerminar={() => setEditando(false)} />
  }
  return (
    <ResumenHorario horario={horario.data} gestiona={gestiona} alEditar={() => setEditando(true)} />
  )
}

const formatoTemporada = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// «1 sept»
const diaMesCorto = (fecha: string) =>
  formatoTemporada.format(new Date(`${fecha}T12:00:00Z`)).replace('.', '')

// Los días agrupados por su franja: [«Martes y jueves», «20:00–21:30»], en el orden de la semana
function gruposDeHoras(sesiones: Horario['sesiones']) {
  const grupos = new Map<string, number[]>()
  for (const s of [...sesiones].sort((a, b) => a.dia - b.dia)) {
    const franja = s.horaFin ? `${s.hora}–${s.horaFin}` : s.hora
    grupos.set(franja, [...(grupos.get(franja) ?? []), s.dia])
  }
  const nombre = (dia: number) => DIAS.find((d) => d.dia === dia)?.nombre ?? ''
  return [...grupos].map(([franja, dias]) => {
    const nombres = dias.map(nombre)
    const texto =
      nombres.length > 1 ? `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}` : nombres[0]
    return { dias: mayuscula(texto ?? ''), franja }
  })
}

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// Resumen de solo lectura del horario guardado: la semana con los días de entreno, las horas
// agrupadas y la temporada. El cuerpo técnico ve además cuántos entrenos lleva y le quedan, y el botón
// para editarlo; el jugador, su próximo entreno
function ResumenHorario({
  horario,
  gestiona,
  alEditar,
}: {
  horario: Horario
  gestiona: boolean
  alEditar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const dias = new Set(horario.sesiones.map((s) => s.dia))
  return (
    <section className={estilos.resumenHorario} aria-label="Horario de entrenos">
      <ol className={estilos.semana} aria-hidden="true">
        {DIAS.map((d) => (
          <li
            key={d.dia}
            className={estilos.diaHorario}
            data-entreno={dias.has(d.dia) || undefined}
          >
            {d.corto}
          </li>
        ))}
      </ol>
      <ul className={estilos.gruposHoras}>
        {gruposDeHoras(horario.sesiones).map(({ dias: texto, franja }) => (
          <li key={franja}>
            <strong>{texto}</strong> · {franja}
          </li>
        ))}
      </ul>
      <p className={estilos.secundario}>
        Del {diaMesCorto(horario.desde)} al {diaMesCorto(horario.hasta)}
      </p>
      {gestiona ? (
        <>
          <CifrasHorario horario={horario} />
          <Boton variante="secundario" icono={<Pencil aria-hidden size={18} />} onClick={alEditar}>
            Editar horario
          </Boton>
        </>
      ) : (
        <ProximoEntreno plantillaId={plantilla.id} />
      )}
    </section>
  )
}

function CifrasHorario({ horario }: { horario: Horario }) {
  const plantilla = usePlantillaActiva()
  const cifras = useCifrasHorario(plantilla.id, horario)
  if (!cifras.data) return null
  const { hechos, porVenir } = cifras.data
  return (
    <dl className={estilos.cifrasHorario}>
      <div>
        <dt>{hechos === 1 ? 'Entreno hecho' : 'Entrenos hechos'}</dt>
        <dd>{hechos}</dd>
      </div>
      <div>
        <dt>Por venir</dt>
        <dd>{porVenir}</dd>
      </div>
    </dl>
  )
}

function ProximoEntreno({ plantillaId }: { plantillaId: string }) {
  // El primero desde hoy: el de hoy también cuenta
  const siguiente = useSiguienteEntreno(plantillaId, sumarDias(hoy(), -1))
  if (!siguiente.data) return null
  const horas = textoHoras(siguiente.data)
  return (
    <p>
      <strong>Próximo entreno:</strong> {mayuscula(textoFecha(siguiente.data.fecha))}
      {horas && ` · ${horas}`}
    </p>
  )
}

function FormularioHorario({
  guardado,
  alTerminar,
}: {
  guardado: Horario | null
  // Con horario guardado: vuelve al resumen al cancelar o al guardar
  alTerminar?: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const actual = hoy()
  const [horas, setHoras] = useState<Record<number, { hora: string; horaFin: string }>>(() =>
    Object.fromEntries(
      (guardado?.sesiones ?? []).map((s) => [s.dia, { hora: s.hora, horaFin: s.horaFin ?? '' }]),
    ),
  )
  const [desde, setDesde] = useState(guardado?.desde ?? actual)
  const [hasta, setHasta] = useState(guardado?.hasta ?? finDeTemporada(plantilla.temporada))
  const [errores, setErrores] = useState<Record<string, string>>({})

  const sesiones = Object.entries(horas)
    .map(([dia, h]) => ({ dia: Number(dia), hora: h.hora, horaFin: h.horaFin || null }))
    .sort((a, b) => a.dia - b.dia)
  const fechasValidas = desde !== '' && hasta !== '' && hasta >= desde
  const aCrear = fechasValidas ? entrenosDelHorario({ desde, hasta, sesiones }, actual) : 0
  const inicio = desde > actual ? desde : actual
  // Con horario guardado, el aviso dice lo que cambia (GH-269): se simula en el servidor cuando el
  // formulario es válido
  const horasValidas = sesiones.every((s) => s.hora && (!s.horaFin || s.horaFin > s.hora))
  const valido = sesiones.length > 0 && fechasValidas && horasValidas
  const sinCambios =
    guardado !== null && normalizar(guardado) === normalizar({ desde, hasta, sesiones })
  // Sin cambios no hay nada que simular
  const simulacion = useSimulacionHorario(
    plantilla.id,
    guardado && valido && !sinCambios ? { desde, hasta, sesiones } : null,
  )

  function alternar(dia: number) {
    const nuevas = { ...horas }
    if (dia in nuevas) delete nuevas[dia]
    else {
      const ultima = sesiones.at(-1)
      nuevas[dia] = { hora: ultima?.hora ?? HORA_POR_DEFECTO, horaFin: ultima?.horaFin ?? '' }
    }
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
      alTerminar?.()
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
    const malFin = sesiones.find((s) => s.horaFin && s.horaFin <= s.hora)
    if (malFin) {
      return setErrores({
        [`fin${malFin.dia}`]: 'La hora de fin debe ser posterior a la de inicio',
      })
    }
    guardar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={enviarFormulario} noValidate>
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
          {sesiones.map((s) => {
            const nombre = DIAS.find((d) => d.dia === s.dia)?.nombre
            const cambiar = (cambios: Partial<{ hora: string; horaFin: string }>) =>
              setHoras({
                ...horas,
                [s.dia]: { hora: s.hora, horaFin: s.horaFin ?? '', ...cambios },
              })
            return (
              <div key={s.dia} className={estilos.franja}>
                <Campo
                  etiqueta={`Inicio del ${nombre}`}
                  type="time"
                  value={s.hora}
                  onChange={(e) => cambiar({ hora: e.target.value })}
                />
                <Campo
                  etiqueta={`Fin del ${nombre}`}
                  type="time"
                  value={s.horaFin ?? ''}
                  onChange={(e) => cambiar({ horaFin: e.target.value })}
                  error={errores[`fin${s.dia}`]}
                  ayuda="Opcional"
                />
              </div>
            )
          })}
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

      {!guardado && sesiones.length > 0 && fechasValidas && (
        <p className={estilos.aviso} role="status">
          {aCrear === 0
            ? 'Con estas fechas no se crea ningún entreno.'
            : `Se crean ${aCrear} ${aCrear === 1 ? 'entreno' : 'entrenos'}: los ${textoSesiones(sesiones)}, del ${textoDiaMes(inicio)} al ${textoDiaMes(hasta)}.`}
        </p>
      )}
      {guardado &&
        (sinCambios ? (
          <p className={estilos.aviso} role="status">
            Sin cambios respecto al horario guardado.
          </p>
        ) : (
          valido && simulacion.data && <AvisoCambios simulacion={simulacion.data} />
        ))}

      {errores.general && (
        <p className={estilos.error} role="alert">
          {errores.general}
        </p>
      )}

      <div className={estilos.acciones}>
        <Boton
          type="submit"
          cargando={guardar.isPending}
          disabled={sinCambios}
          icono={<Save aria-hidden size={18} />}
        >
          Guardar horario
        </Boton>
        {alTerminar && (
          <Boton variante="secundario" onClick={alTerminar}>
            Cancelar
          </Boton>
        )}
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
