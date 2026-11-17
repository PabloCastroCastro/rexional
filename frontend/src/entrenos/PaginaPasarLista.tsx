import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  CalendarPlus,
  CalendarX,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  Clock,
  Cloud,
  CloudCheck,
  Ellipsis,
  Hand,
  LoaderCircle,
  Plus,
  Share2,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { api, datos, ErrorApi, enviar, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { MarcaInvitado } from '../jugadores/BuscadorInvitables'
import { nombreCompleto, nombresCortos, puedeGestionarJugadores } from '../jugadores/datos'
import { estadoJugador } from '../jugadores/estado'
import { textoVuelta } from '../jugadores/Lesiones'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { resumenPlan, rutaPlan } from '../planificacion/datos'
import { EnlacePlanificar, TarjetaPlan } from '../planificacion/TarjetaPlan'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_ENTRENOS,
  type Entreno,
  type EntrenoListado,
  type Estado,
  esFechaValida,
  hoy,
  type ResumenEntreno,
  sumarDias,
  textoFecha,
  textoHoras,
  useEntreno,
  useEntrenosDelDia,
  useSiguienteEntreno,
} from './datos'
import estilos from './Entrenos.module.css'
import { type Asistencia, type EstadoGuardado, useGuardadoAutomatico } from './guardado'
import { HojaRespuestas, PistaRespuesta, RespuestasDeHoy, RespuestasEntreno } from './Respuestas'

const ESTADOS: { estado: Estado; texto: string; icono: typeof Check }[] = [
  { estado: 'asiste', texto: 'Asiste', icono: Check },
  // La mano levantada: avisó de que no venía (GH-256)
  { estado: 'justificada', texto: 'Justificada', icono: Hand },
  { estado: 'falta', texto: 'Falta', icono: X },
]

// Pasar lista de un día (?fecha=AAAA-MM-DD, hoy por defecto) y de una de sus sesiones
// (?entreno=id; la primera por defecto). Se puede ir a cualquier día para crear o cancelar entrenos,
// pero solo se pasa lista de los que ya han llegado.
export function PaginaPasarLista() {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [parametros, setParametros] = useSearchParams()
  const actual = hoy()
  const pedida = parametros.get('fecha')
  const fecha = esFechaValida(pedida) ? pedida : actual
  const delDia = useEntrenosDelDia(plantilla.id, fecha)
  const sesiones = delDia.data ?? []
  const elegida = sesiones.find((e) => e.id === parametros.get('entreno')) ?? sesiones[0]
  const futuro = elegida !== undefined && elegida.fecha > actual
  const entreno = useEntreno(plantilla.id, elegida && !futuro ? elegida.id : undefined)
  const [creando, setCreando] = useState(false)
  const [cambiandoHora, setCambiandoHora] = useState(false)
  const [opciones, setOpciones] = useState(false)
  const [compartiendo, setCompartiendo] = useState(false)

  const irA = (nueva: string) => setParametros(nueva === actual ? {} : { fecha: nueva })
  const elegir = (id: string) =>
    setParametros(fecha === actual ? { entreno: id } : { fecha, entreno: id })

  return (
    <div className={`${estilos.pagina} ${estilos.compacta}`}>
      <nav className={estilos.fecha} aria-label="Fecha del entreno">
        <button
          type="button"
          className={estilos.flecha}
          onClick={() => irA(sumarDias(fecha, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft aria-hidden size={24} />
        </button>
        <label className={estilos.dia}>
          <span>{textoFecha(fecha)}</span>
          <input
            type="date"
            aria-label="Elegir fecha"
            value={fecha}
            onClick={(e) => e.currentTarget.showPicker?.()}
            onChange={(e) => {
              if (esFechaValida(e.target.value)) irA(e.target.value)
            }}
          />
        </label>
        <button
          type="button"
          className={estilos.flecha}
          onClick={() => irA(sumarDias(fecha, 1))}
          aria-label="Día siguiente"
        >
          <ChevronRight aria-hidden size={24} />
        </button>
      </nav>

      {sesiones.length > 0 && (
        <div className={estilos.filaSesiones}>
          <fieldset className={estilos.sesiones}>
            <legend className="solo-lectores">Sesiones del día</legend>
            {sesiones.map((s) => (
              <span key={s.id} className={estilos.sesion}>
                <button
                  type="button"
                  aria-pressed={s.id === elegida?.id}
                  onClick={() => elegir(s.id)}
                >
                  <Clock aria-hidden size={16} />
                  {textoHoras(s) ?? 'Sin hora'}
                </button>
                {/* Las opciones de la sesión elegida, pegadas a su pastilla (GH-261) */}
                {gestiona && s.id === elegida?.id && (
                  <button
                    type="button"
                    className={estilos.opcionesSesion}
                    aria-label="Opciones del entreno"
                    title="Opciones del entreno"
                    onClick={() => setOpciones(true)}
                  >
                    <Ellipsis aria-hidden size={20} />
                  </button>
                )}
              </span>
            ))}
            {gestiona && (
              <button
                type="button"
                className={estilos.anadirSesion}
                onClick={() => setCreando(true)}
                aria-label="Añadir sesión"
                title="Añadir sesión"
              >
                <Plus aria-hidden size={18} />
              </button>
            )}
          </fieldset>
          {elegida && <EnlacePlanificar entreno={elegida} />}
        </div>
      )}

      {elegida && <TarjetaPlan entreno={elegida} />}

      {delDia.isPending ? (
        <Cargando />
      ) : delDia.isError ? (
        <p className={estilos.error} role="alert">
          {delDia.error.message}
        </p>
      ) : !elegida ? (
        <SinEntreno fecha={fecha} gestiona={gestiona} alCrear={() => setCreando(true)} />
      ) : futuro ? (
        <>
          <p className={estilos.aviso}>
            Este entreno aún no ha llegado: la lista se pasa el mismo día.
          </p>
          {gestiona && <RespuestasEntreno entreno={elegida} />}
        </>
      ) : entreno.isPending ? (
        <Cargando />
      ) : entreno.isError ? (
        <p className={estilos.error} role="alert">
          {entreno.error.message}
        </p>
      ) : gestiona ? (
        <>
          {/* Antes de pasar lista, quién dijo que iba (GH-215) */}
          {elegida.asiste + elegida.justificada + elegida.falta === 0 && (
            <RespuestasDeHoy entreno={elegida} />
          )}
          {/* Cada entreno empieza con su propio estado local y su propio guardado */}
          <Lista key={entreno.data.id} entreno={entreno.data} />
        </>
      ) : (
        <SoloLectura entreno={entreno.data} />
      )}

      <CrearEntreno
        abierta={creando}
        fecha={fecha}
        alCerrar={() => setCreando(false)}
        alCrear={(id) => {
          setCreando(false)
          elegir(id)
        }}
      />
      {elegida && (
        <>
          <CrearEntreno
            abierta={cambiandoHora}
            fecha={fecha}
            entreno={elegida}
            alCerrar={() => setCambiandoHora(false)}
            alCrear={() => setCambiandoHora(false)}
          />
          <OpcionesEntreno
            entreno={elegida}
            abierta={opciones}
            // El resumen para WhatsApp, mientras se muestra «¿Quién va?»: antes de pasar lista
            conResumen={futuro || elegida.asiste + elegida.justificada + elegida.falta === 0}
            alCerrar={() => setOpciones(false)}
            alCambiarHora={() => {
              setOpciones(false)
              setCambiandoHora(true)
            }}
            alCompartir={() => {
              setOpciones(false)
              setCompartiendo(true)
            }}
          />
          <HojaRespuestas
            entreno={elegida}
            abierta={compartiendo}
            alCerrar={() => setCompartiendo(false)}
          />
        </>
      )}
    </div>
  )
}

// Hoja para crear un entreno suelto en el día (el primero o una sesión más: doble sesión) o, con
// entreno, para cambiar su hora de inicio y de fin
function CrearEntreno({
  abierta,
  fecha,
  entreno,
  alCerrar,
  alCrear,
}: {
  abierta: boolean
  fecha: string
  entreno?: ResumenEntreno
  alCerrar: () => void
  alCrear: (id: string) => void
}) {
  return (
    <HojaInferior
      abierta={abierta}
      alCerrar={alCerrar}
      titulo={entreno ? 'Cambiar la hora' : 'Crear entreno'}
    >
      {abierta && (
        <FormularioCrear fecha={fecha} entreno={entreno} alCerrar={alCerrar} alCrear={alCrear} />
      )}
    </HojaInferior>
  )
}

// Día sin entreno: el siguiente, a un toque, y crear uno ese día como acción secundaria (GH-263). Sin
// ninguno por delante, el estado vacío de siempre
function SinEntreno({
  fecha,
  gestiona,
  alCrear,
}: {
  fecha: string
  gestiona: boolean
  alCrear: () => void
}) {
  const plantilla = usePlantillaActiva()
  const siguiente = useSiguienteEntreno(plantilla.id, fecha)
  const textoCrear = fecha === hoy() ? 'Crear un entreno hoy' : 'Crear un entreno este día'
  const proximo = siguiente.data

  if (proximo) {
    const horas = textoHoras(proximo)
    return (
      <EstadoVacio
        titulo="No hay entreno este día"
        accion={
          <div className={estilos.sinEntreno}>
            <Link
              to={{ search: proximo.fecha === hoy() ? '' : `?fecha=${proximo.fecha}` }}
              className={estilos.tarjetaProximo}
            >
              <CalendarClock aria-hidden size={22} />
              <span className={estilos.textoProximo}>
                <strong>Próximo entreno</strong>
                <span className={estilos.cuandoProximo}>
                  {mayuscula(textoFecha(proximo.fecha))}
                  {horas && ` · ${horas}`}
                </span>
              </span>
              <ChevronRight aria-hidden size={20} />
            </Link>
            {gestiona && (
              <Boton
                variante="secundario"
                icono={<CalendarPlus aria-hidden size={18} />}
                onClick={alCrear}
              >
                {textoCrear}
              </Boton>
            )}
          </div>
        }
      />
    )
  }

  return (
    <EstadoVacio
      icono={<CalendarPlus size={32} />}
      titulo="No hay entreno este día"
      descripcion={
        gestiona
          ? 'Crea un entreno para pasar lista o planificarlo. Los entrenos habituales se crean con el horario.'
          : 'Solo se pasa lista de los entrenos del calendario de la plantilla.'
      }
      accion={
        // Mientras se busca el siguiente, sin acción: así no cambia de botón al llegar
        gestiona &&
        !siguiente.isPending && (
          <Boton icono={<CalendarPlus aria-hidden size={18} />} onClick={alCrear}>
            Crear entreno
          </Boton>
        )
      }
    />
  )
}

// Opciones de la sesión elegida, desde el «⋯» de su pastilla (GH-261): el día y la hora, y las
// acciones; cancelar va al final, en rojo y con confirmación
function OpcionesEntreno({
  entreno,
  abierta,
  conResumen,
  alCerrar,
  alCambiarHora,
  alCompartir,
}: {
  entreno: EntrenoListado
  abierta: boolean
  conResumen: boolean
  alCerrar: () => void
  alCambiarHora: () => void
  alCompartir: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cancelar = useCancelarEntreno(entreno)
  const horas = textoHoras(entreno)
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Opciones del entreno">
      {abierta && (
        <>
          <p className={estilos.cuandoEntreno}>
            {mayuscula(textoFecha(entreno.fecha))}
            {horas && ` · ${horas}`}
          </p>
          <ul className={estilos.opciones}>
            <li>
              <button type="button" onClick={alCambiarHora}>
                <Clock aria-hidden size={20} />
                Cambiar la hora
              </button>
            </li>
            <li>
              <Link to={rutaPlan(plantilla.id, entreno.id)}>
                <ClipboardList aria-hidden size={20} />
                {resumenPlan(entreno) ? 'Ver el plan del entreno' : 'Planificar el entreno'}
              </Link>
            </li>
            {conResumen && (
              <li>
                <button type="button" onClick={alCompartir}>
                  <Share2 aria-hidden size={20} />
                  Resumen para WhatsApp
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                className={estilos.opcionPeligrosa}
                disabled={cancelar.pendiente}
                onClick={() => {
                  alCerrar()
                  void cancelar.pedir()
                }}
              >
                <CalendarX aria-hidden size={20} />
                Cancelar entreno
              </button>
            </li>
          </ul>
        </>
      )}
    </HojaInferior>
  )
}

function FormularioCrear({
  fecha,
  entreno,
  alCerrar,
  alCrear,
}: {
  fecha: string
  entreno?: ResumenEntreno
  alCerrar: () => void
  alCrear: (id: string) => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [hora, setHora] = useState(entreno?.hora ?? '')
  const [horaFin, setHoraFin] = useState(entreno?.horaFin ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const crear = useMutation({
    mutationFn: () => {
      const horas = { hora: hora || null, horaFin: horaFin || null }
      return entreno
        ? datos(
            api.PATCH('/api/plantillas/{id}/entrenos/{eid}', {
              params: { path: { id: plantilla.id, eid: entreno.id } },
              body: horas,
            }),
          )
        : datos(
            api.POST('/api/plantillas/{id}/entrenos', {
              params: { path: { id: plantilla.id } },
              body: { fecha, ...horas },
            }),
          )
    },
    onSuccess: async (guardado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS })
      avisar({
        tipo: 'exito',
        mensaje: `${entreno ? 'Hora cambiada' : 'Entreno creado'}: ${textoFecha(fecha)}${
          textoHoras(guardado) ? ` · ${textoHoras(guardado)}` : ''
        }`,
      })
      alCrear(guardado.id)
    },
    onError: (error) => {
      const porCampo = erroresPorCampo(error)
      setErrores(
        error instanceof ErrorApi && error.codigo === 'entreno_duplicado'
          ? { hora: error.message }
          : Object.keys(porCampo).length > 0
            ? porCampo
            : { general: error instanceof Error ? error.message : 'No se ha podido crear' },
      )
    },
  })

  return (
    <form
      className={estilos.formulario}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setErrores({})
        if (horaFin && !hora) return setErrores({ horaFin: 'Indica también la hora de inicio' })
        if (horaFin && horaFin <= hora) {
          return setErrores({ horaFin: 'La hora de fin debe ser posterior a la de inicio' })
        }
        crear.mutate()
      }}
    >
      <p className={estilos.secundario}>{textoFecha(fecha)}</p>
      <Campo
        etiqueta="Hora"
        type="time"
        value={hora}
        onChange={(e) => setHora(e.target.value)}
        error={errores.hora}
        ayuda={
          entreno ? 'Opcional.' : 'Opcional. Para una segunda sesión el mismo día, indica su hora.'
        }
      />
      <Campo
        etiqueta="Hora de fin"
        type="time"
        value={horaFin}
        onChange={(e) => setHoraFin(e.target.value)}
        error={errores.horaFin}
        ayuda="Opcional."
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
          cargando={crear.isPending}
          icono={entreno ? <Check aria-hidden size={18} /> : <CalendarPlus aria-hidden size={18} />}
        >
          {entreno ? 'Guardar' : 'Crear entreno'}
        </Boton>
      </div>
    </form>
  )
}

// Cancelar el entreno elegido: lo borra con su asistencia, si la tiene, tras confirmarlo. Devuelve la
// acción para el menú de opciones (GH-261)
function useCancelarEntreno(entreno: ResumenEntreno) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [, setParametros] = useSearchParams()
  const conAsistencia = entreno.asiste + entreno.justificada + entreno.falta > 0
  const horas = textoHoras(entreno)
  const cuando = `${textoFecha(entreno.fecha)}${horas ? ` · ${horas}` : ''}`

  const cancelar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/plantillas/{id}/entrenos/{eid}', {
          params: { path: { id: plantilla.id, eid: entreno.id } },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS })
      avisar({ tipo: 'exito', mensaje: `Entreno cancelado: ${cuando}` })
      setParametros(entreno.fecha === hoy() ? {} : { fecha: entreno.fecha })
    },
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido cancelar',
      }),
  })

  const pedir = async () => {
    const confirmado = await confirmar({
      titulo: `¿Cancelar el entreno del ${cuando}?`,
      mensaje: [
        conAsistencia
          ? 'Ya tiene la lista pasada: se borrará también su asistencia.'
          : 'Desaparece del calendario. Si sale del horario, al cambiar el horario puede volver a crearse.',
        resumenPlan(entreno) && 'También se pierde su plan.',
      ]
        .filter(Boolean)
        .join(' '),
      textoConfirmar: 'Cancelar entreno',
      textoCancelar: 'Volver',
      peligrosa: true,
    })
    if (confirmado) cancelar.mutate()
  }

  return { pedir, pendiente: cancelar.isPending }
}

type Marca = { estado: Estado | null; motivo: string }

const MOTIVO_LESION = 'Lesión'

// Motivos frecuentes de una falta justificada, a un toque (GH-262); cualquier otro va en «Otro»
const MOTIVOS = [MOTIVO_LESION, 'Trabajo', 'Estudios', 'Enfermo']

// Chips con los motivos frecuentes: tocar uno lo guarda y tocarlo otra vez lo quita. «Otro» abre un
// campo con etiqueta; un motivo guardado que no es de la lista sale ahí
function MotivoJustificada({
  nombre,
  motivo,
  alCambiar,
}: {
  nombre: string
  motivo: string
  alCambiar: (motivo: string) => void
}) {
  const [otro, setOtro] = useState(motivo.trim() !== '' && !MOTIVOS.includes(motivo))
  const idCampo = useId()
  const campo = useRef<HTMLInputElement>(null)
  // El campo recibe el foco al abrirlo, no al pintar la lista con un motivo ya guardado
  const enfocar = useRef(false)
  useEffect(() => {
    if (otro && enfocar.current) campo.current?.focus()
    enfocar.current = false
  }, [otro])

  return (
    <fieldset className={estilos.motivos}>
      <legend className="solo-lectores">Motivo de {nombre}</legend>
      <div className={estilos.chips}>
        {MOTIVOS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={!otro && motivo === m}
            onClick={() => {
              setOtro(false)
              alCambiar(!otro && motivo === m ? '' : m)
            }}
          >
            <span className={estilos.chip}>{m}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={otro}
          onClick={() => {
            enfocar.current = !otro
            setOtro(!otro)
            alCambiar('')
          }}
        >
          <span className={estilos.chip}>Otro</span>
        </button>
      </div>
      {otro && (
        <div className={estilos.otroMotivo}>
          <label htmlFor={idCampo}>Otro motivo</label>
          <input
            ref={campo}
            id={idCampo}
            maxLength={200}
            value={motivo}
            onChange={(e) => alCambiar(e.target.value)}
          />
        </div>
      )}
    </fieldset>
  )
}

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

function Lista({ entreno }: { entreno: Entreno }) {
  const plantilla = usePlantillaActiva()
  const guardado = useGuardadoAutomatico(
    plantilla.id,
    entreno.id,
    entreno.jugadores.some((j) => j.estado !== null),
  )
  // El lesionado ese día sale ya como justificada por lesión (GH-230): se guarda con el resto de la
  // lista y se puede cambiar. Si nadie pasa lista, no se guarda nada y el indicador dice «Sin guardar»
  const [marcas, setMarcas] = useState<Record<string, Marca>>(() =>
    Object.fromEntries(
      entreno.jugadores.map((j) => [
        j.jugadorId,
        j.estado === null && j.lesion
          ? { estado: 'justificada' as const, motivo: MOTIVO_LESION }
          : { estado: j.estado, motivo: j.motivo ?? '' },
      ]),
    ),
  )

  function cambiar(nuevas: Record<string, Marca>) {
    setMarcas(nuevas)
    const lista: Asistencia[] = []
    for (const [jugadorId, { estado, motivo }] of Object.entries(nuevas)) {
      if (!estado) continue
      lista.push(
        estado === 'justificada'
          ? { jugadorId, estado, motivo: motivo.trim() || null }
          : { jugadorId, estado },
      )
    }
    guardado.programar(lista)
  }

  const marcar = (jugadorId: string, estado: Estado) => {
    const anterior = marcas[jugadorId] ?? { estado: null, motivo: '' }
    // Tocar el estado activo lo desmarca
    cambiar({
      ...marcas,
      [jugadorId]: { ...anterior, estado: anterior.estado === estado ? null : estado },
    })
  }

  const sinMarcar = entreno.jugadores.filter((j) => j.activo && !marcas[j.jugadorId]?.estado)
  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const m of Object.values(marcas)) if (m.estado) recuentos[m.estado] += 1
  // Nombre y primer apellido, para que no se corten; la leyenda de cada fila lleva el completo (GH-257)
  const nombres = nombresCortos(entreno.jugadores)

  if (entreno.jugadores.length === 0) {
    return (
      <EstadoVacio
        titulo="No hay jugadores en la plantilla"
        descripcion="Añádelos desde la pestaña Plantilla para poder pasar lista."
      />
    )
  }

  return (
    <>
      <ul className={estilos.lista} aria-label="Jugadores">
        {entreno.jugadores.map((j) => {
          const marca = marcas[j.jugadorId] ?? { estado: null, motivo: '' }
          return (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} estado={estadoJugador({ lesion: j.lesion })} />
                <span className={`${estilos.nombre} ${estilos.entero}`}>
                  {nombres.get(j.jugadorId)}
                  {j.tipo === 'invitado' && <MarcaInvitado />}
                  {!j.activo && <span className={estilos.baja}> baja</span>}
                  {/* La lesión va sobre el dorsal; debajo, solo cuándo vuelve (GH-251) */}
                  {j.lesion && (
                    <span className={estilos.lesion}>
                      {mayuscula(textoVuelta(j.lesion.vueltaPrevista))}
                    </span>
                  )}
                  <PistaRespuesta jugador={j} />
                </span>
                <fieldset className={estilos.estados}>
                  <legend className="solo-lectores">Asistencia de {nombreCompleto(j)}</legend>
                  {ESTADOS.map(({ estado, texto, icono: Icono }) => (
                    <button
                      key={estado}
                      type="button"
                      className={estilos[estado]}
                      aria-pressed={marca.estado === estado}
                      aria-label={texto}
                      title={texto}
                      onClick={() => marcar(j.jugadorId, estado)}
                    >
                      <Icono aria-hidden size={22} />
                    </button>
                  ))}
                </fieldset>
              </div>
              {marca.estado === 'justificada' && (
                <MotivoJustificada
                  nombre={nombreCompleto(j)}
                  motivo={marca.motivo}
                  alCambiar={(motivo) =>
                    cambiar({ ...marcas, [j.jugadorId]: { ...marca, motivo } })
                  }
                />
              )}
            </li>
          )
        })}
      </ul>

      <PieLista
        recuentos={recuentos}
        sinMarcar={sinMarcar.length}
        guardado={guardado}
        alMarcarResto={() => {
          const nuevas = { ...marcas }
          for (const j of sinMarcar) nuevas[j.jugadorId] = { estado: 'asiste', motivo: '' }
          cambiar(nuevas)
        }}
      />
    </>
  )
}

const partesRecuento = (recuentos: Entreno['recuentos']) => [
  `${recuentos.asiste} ${recuentos.asiste === 1 ? 'asiste' : 'asisten'}`,
  `${recuentos.justificada} ${recuentos.justificada === 1 ? 'justificada' : 'justificadas'}`,
  `${recuentos.falta} ${recuentos.falta === 1 ? 'falta' : 'faltan'}`,
]

function Recuentos({ recuentos }: { recuentos: Entreno['recuentos'] }) {
  return <p className={estilos.recuentos}>{partesRecuento(recuentos).join(' · ')}</p>
}

// Siempre a mano encima de la navegación (GH-259): el progreso de la lista con los colores de cada
// estado, el guardado y marcar como asiste a los que quedan
function PieLista({
  recuentos,
  sinMarcar,
  guardado,
  alMarcarResto,
}: {
  recuentos: Entreno['recuentos']
  sinMarcar: number
  guardado: { estado: EstadoGuardado; reintentar: () => void }
  alMarcarResto: () => void
}) {
  const marcados = recuentos.asiste + recuentos.justificada + recuentos.falta
  const total = marcados + sinMarcar
  const ancho = (n: number) => `${total ? (n / total) * 100 : 0}%`
  return (
    <div className={estilos.pieLista}>
      <div className={estilos.progreso} aria-hidden="true">
        <span className={estilos.asiste} style={{ width: ancho(recuentos.asiste) }} />
        <span className={estilos.justificada} style={{ width: ancho(recuentos.justificada) }} />
        <span className={estilos.falta} style={{ width: ancho(recuentos.falta) }} />
      </div>
      {/* En una sola fila, para que quepan más jugadores encima (GH-258) */}
      <div className={estilos.pieFila}>
        <div className={estilos.pieTexto}>
          <p className={estilos.recuentos}>
            <strong>
              {marcados} de {total} marcados
            </strong>
            {marcados > 0 && (
              <span className="solo-lectores">: {partesRecuento(recuentos).join(', ')}</span>
            )}
          </p>
          <IndicadorGuardado estado={guardado.estado} alReintentar={guardado.reintentar} />
        </div>
        {sinMarcar > 0 ? (
          <Boton icono={<Check aria-hidden size={18} />} onClick={alMarcarResto}>
            El resto asiste ({sinMarcar})
          </Boton>
        ) : (
          <p className={estilos.listaCompleta}>
            <Check aria-hidden size={18} />
            Lista completa
          </p>
        )}
      </div>
    </div>
  )
}

const TEXTOS_GUARDADO: Record<EstadoGuardado, string> = {
  sinGuardar: 'Sin guardar',
  guardado: 'Guardado',
  pendiente: 'Guardando…',
  guardando: 'Guardando…',
  error: 'No se ha guardado',
}

const ICONOS_GUARDADO: Record<EstadoGuardado, typeof Cloud> = {
  sinGuardar: Cloud,
  guardado: CloudCheck,
  pendiente: LoaderCircle,
  guardando: LoaderCircle,
  error: CircleAlert,
}

function IndicadorGuardado({
  estado,
  alReintentar,
}: {
  estado: EstadoGuardado
  alReintentar: () => void
}) {
  const Icono = ICONOS_GUARDADO[estado]
  return (
    <div className={estilos.guardado} data-estado={estado} role="status">
      <Icono aria-hidden size={16} className={estado === 'guardando' ? estilos.girando : ''} />
      <span>{TEXTOS_GUARDADO[estado]}</span>
      {estado === 'error' && (
        <button type="button" className={estilos.reintentar} onClick={alReintentar}>
          Reintentar
        </button>
      )}
    </div>
  )
}

// Rol sin permiso para pasar lista: los recuentos del día y, como mucho, su propia fila
function SoloLectura({ entreno }: { entreno: Entreno }) {
  const textos = Object.fromEntries(ESTADOS.map((e) => [e.estado, e.texto]))
  return (
    <>
      {entreno.recuentos.asiste + entreno.recuentos.justificada + entreno.recuentos.falta > 0 ? (
        <Recuentos recuentos={entreno.recuentos} />
      ) : (
        <p className={estilos.recuentos}>Aún no se ha pasado lista de este entreno.</p>
      )}
      {entreno.jugadores.length > 0 && (
        <ul className={estilos.lista} aria-label="Mi asistencia">
          {entreno.jugadores.map((j) => (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} />
                <span className={estilos.nombre}>{nombreCompleto(j)}</span>
                <span className={estilos.secundario}>
                  {j.estado ? textos[j.estado] : 'Sin registrar'}
                  {j.motivo && ` · ${j.motivo}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={estilos.secundario}>Pasar lista es cosa del cuerpo técnico.</p>
    </>
  )
}
