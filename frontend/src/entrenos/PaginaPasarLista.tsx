import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CalendarPlus,
  CalendarX,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  CloudCheck,
  FileText,
  LoaderCircle,
  Plus,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { api, datos, ErrorApi, enviar, erroresPorCampo } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_ENTRENOS,
  type Entreno,
  type Estado,
  esFechaValida,
  hoy,
  type ResumenEntreno,
  sumarDias,
  textoFecha,
  useEntreno,
  useEntrenosDelDia,
} from './datos'
import estilos from './Entrenos.module.css'
import { type Asistencia, type EstadoGuardado, useGuardadoAutomatico } from './guardado'

const ESTADOS: { estado: Estado; texto: string; icono: typeof Check }[] = [
  { estado: 'asiste', texto: 'Asiste', icono: Check },
  { estado: 'justificada', texto: 'Justificada', icono: FileText },
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

  const irA = (nueva: string) => setParametros(nueva === actual ? {} : { fecha: nueva })
  const elegir = (id: string) =>
    setParametros(fecha === actual ? { entreno: id } : { fecha, entreno: id })

  return (
    <div className={estilos.pagina}>
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
        <fieldset className={estilos.sesiones}>
          <legend className="solo-lectores">Sesiones del día</legend>
          {sesiones.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === elegida?.id}
              onClick={() => elegir(s.id)}
            >
              <Clock aria-hidden size={16} />
              {s.hora ?? 'Sin hora'}
            </button>
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
      )}

      {delDia.isPending ? (
        <Cargando />
      ) : delDia.isError ? (
        <p className={estilos.error} role="alert">
          {delDia.error.message}
        </p>
      ) : !elegida ? (
        <EstadoVacio
          icono={<CalendarPlus size={32} />}
          titulo="No hay entreno este día"
          descripcion={
            gestiona
              ? 'Crea un entreno para pasar lista o planificarlo. Los entrenos habituales se crean con el horario.'
              : 'Solo se pasa lista de los entrenos del calendario de la plantilla.'
          }
          accion={
            gestiona && (
              <Boton
                icono={<CalendarPlus aria-hidden size={18} />}
                onClick={() => setCreando(true)}
              >
                Crear entreno
              </Boton>
            )
          }
        />
      ) : futuro ? (
        <>
          <p className={estilos.aviso}>
            Este entreno aún no ha llegado: la lista se pasa el mismo día.
          </p>
          {gestiona && <CancelarEntreno entreno={elegida} />}
        </>
      ) : entreno.isPending ? (
        <Cargando />
      ) : entreno.isError ? (
        <p className={estilos.error} role="alert">
          {entreno.error.message}
        </p>
      ) : gestiona ? (
        <>
          {/* Cada entreno empieza con su propio estado local y su propio guardado */}
          <Lista key={entreno.data.id} entreno={entreno.data} />
          <CancelarEntreno entreno={elegida} />
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
    </div>
  )
}

// Hoja para crear un entreno suelto en el día: el primero o una sesión más (doble sesión)
function CrearEntreno({
  abierta,
  fecha,
  alCerrar,
  alCrear,
}: {
  abierta: boolean
  fecha: string
  alCerrar: () => void
  alCrear: (id: string) => void
}) {
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Crear entreno">
      {abierta && <FormularioCrear fecha={fecha} alCerrar={alCerrar} alCrear={alCrear} />}
    </HojaInferior>
  )
}

function FormularioCrear({
  fecha,
  alCerrar,
  alCrear,
}: {
  fecha: string
  alCerrar: () => void
  alCrear: (id: string) => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [hora, setHora] = useState('')
  const [errores, setErrores] = useState<Record<string, string>>({})

  const crear = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/entrenos', {
          params: { path: { id: plantilla.id } },
          body: { fecha, hora: hora || null },
        }),
      ),
    onSuccess: async (entreno) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS })
      avisar({
        tipo: 'exito',
        mensaje: `Entreno creado: ${textoFecha(fecha)}${hora ? ` · ${hora}` : ''}`,
      })
      alCrear(entreno.id)
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
        ayuda="Opcional. Para una segunda sesión el mismo día, indica su hora."
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
          icono={<CalendarPlus aria-hidden size={18} />}
        >
          Crear entreno
        </Boton>
      </div>
    </form>
  )
}

// Cancelar el entreno elegido: lo borra con su asistencia, si la tiene, tras confirmarlo
function CancelarEntreno({ entreno }: { entreno: ResumenEntreno }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [, setParametros] = useSearchParams()
  const conAsistencia = entreno.asiste + entreno.justificada + entreno.falta > 0
  const cuando = `${textoFecha(entreno.fecha)}${entreno.hora ? ` · ${entreno.hora}` : ''}`

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

  return (
    <Boton
      variante="texto"
      icono={<CalendarX aria-hidden size={18} />}
      cargando={cancelar.isPending}
      onClick={async () => {
        const confirmado = await confirmar({
          titulo: `¿Cancelar el entreno del ${cuando}?`,
          mensaje: conAsistencia
            ? 'Ya tiene la lista pasada: se borrará también su asistencia.'
            : 'Desaparece del calendario. Si sale del horario, al cambiar el horario puede volver a crearse.',
          textoConfirmar: 'Cancelar entreno',
          textoCancelar: 'Volver',
          peligrosa: true,
        })
        if (confirmado) cancelar.mutate()
      }}
    >
      Cancelar entreno
    </Boton>
  )
}

type Marca = { estado: Estado | null; motivo: string }

function Lista({ entreno }: { entreno: Entreno }) {
  const plantilla = usePlantillaActiva()
  const guardado = useGuardadoAutomatico(plantilla.id, entreno.id)
  const [marcas, setMarcas] = useState<Record<string, Marca>>(() =>
    Object.fromEntries(
      entreno.jugadores.map((j) => [j.jugadorId, { estado: j.estado, motivo: j.motivo ?? '' }]),
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
      <div className={estilos.barra}>
        <Recuentos recuentos={recuentos} sinMarcar={sinMarcar.length} />
        <IndicadorGuardado estado={guardado.estado} alReintentar={guardado.reintentar} />
      </div>

      <ul className={estilos.lista} aria-label="Jugadores">
        {entreno.jugadores.map((j) => {
          const marca = marcas[j.jugadorId] ?? { estado: null, motivo: '' }
          return (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} />
                <span className={estilos.nombre}>
                  {j.nombre}
                  {!j.activo && <span className={estilos.baja}> baja</span>}
                </span>
                <fieldset className={estilos.estados}>
                  <legend className="solo-lectores">Asistencia de {j.nombre}</legend>
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
                <input
                  className={estilos.motivo}
                  aria-label={`Motivo de ${j.nombre}`}
                  placeholder="Motivo (opcional)"
                  maxLength={200}
                  value={marca.motivo}
                  onChange={(e) =>
                    cambiar({ ...marcas, [j.jugadorId]: { ...marca, motivo: e.target.value } })
                  }
                />
              )}
            </li>
          )
        })}
      </ul>

      {sinMarcar.length > 0 && (
        <Boton
          variante="secundario"
          anchoCompleto
          icono={<Check aria-hidden size={18} />}
          onClick={() => {
            const nuevas = { ...marcas }
            for (const j of sinMarcar) nuevas[j.jugadorId] = { estado: 'asiste', motivo: '' }
            cambiar(nuevas)
          }}
        >
          Marcar el resto como asiste ({sinMarcar.length})
        </Boton>
      )}
    </>
  )
}

function Recuentos({
  recuentos,
  sinMarcar,
}: {
  recuentos: Entreno['recuentos']
  sinMarcar?: number
}) {
  const partes = [
    `${recuentos.asiste} ${recuentos.asiste === 1 ? 'asiste' : 'asisten'}`,
    `${recuentos.justificada} ${recuentos.justificada === 1 ? 'justificada' : 'justificadas'}`,
    `${recuentos.falta} ${recuentos.falta === 1 ? 'falta' : 'faltan'}`,
  ]
  if (sinMarcar) partes.push(`${sinMarcar} sin marcar`)
  return <p className={estilos.recuentos}>{partes.join(' · ')}</p>
}

const TEXTOS_GUARDADO: Record<EstadoGuardado, string> = {
  guardado: 'Guardado',
  pendiente: 'Guardando…',
  guardando: 'Guardando…',
  error: 'No se ha guardado',
}

function IndicadorGuardado({
  estado,
  alReintentar,
}: {
  estado: EstadoGuardado
  alReintentar: () => void
}) {
  const Icono = estado === 'error' ? CircleAlert : estado === 'guardado' ? CloudCheck : LoaderCircle
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
                <span className={estilos.nombre}>{j.nombre}</span>
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
