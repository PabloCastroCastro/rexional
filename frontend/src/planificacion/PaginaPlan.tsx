import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  CalendarClock,
  ChevronLeft,
  Copy,
  Image,
  LayoutTemplate,
  Plus,
  Save,
  Search,
  Smartphone,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { BotonCompartirPdf } from '../componentes/CompartirPdf'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { textoDetalles, useEjercicios } from '../ejercicios/datos'
import { CLAVE_ENTRENOS, textoFecha, textoHoras } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_MODELOS,
  type EjercicioPlan,
  type Plan,
  rutaCampo,
  rutaPlan,
  useModelos,
  usePlan,
} from './datos'
import estilos from './Planificacion.module.css'

// El plan de un entreno: objetivo, notas y ejercicios de la biblioteca en orden, con su duración e
// indicaciones; la duración total frente a la del entreno. El cuerpo técnico lo edita (y lo guarda
// entero al final), lo duplica en otra fecha y trabaja con los modelos del club. El resto lo consulta.

export function PaginaPlan() {
  const plantilla = usePlantillaActiva()
  const { entrenoId = '' } = useParams()
  const plan = usePlan(plantilla.id, entrenoId)
  const volver = (
    <Link to={`/plantillas/${plantilla.id}/entrenos/historial`} className={estilos.volver}>
      <ChevronLeft aria-hidden size={20} />
      Entrenos
    </Link>
  )
  if (plan.isPending) return <Cargando />
  if (plan.isError) {
    return (
      <div className={estilos.pagina}>
        {volver}
        <EstadoVacio titulo="No se encuentra el entreno" descripcion={plan.error.message} />
      </div>
    )
  }
  return puedeGestionarJugadores(plantilla) ? (
    // Se monta con el plan guardado: el editor empieza con sus datos
    <Editor key={plan.data.entrenoId} plan={plan.data} volver={volver} />
  ) : (
    <Lectura plan={plan.data} volver={volver} />
  )
}

const cabecera = (plan: Plan) => (
  <div>
    <h2 className={estilos.titulo}>{textoFecha(plan.fecha)}</h2>
    <p className={estilos.secundario}>{textoHoras(plan) ?? 'Sin hora'}</p>
  </div>
)

function Duracion({ total, prevista }: { total: number; prevista: number | null }) {
  const sobra = prevista !== null && total > prevista
  return (
    <p className={estilos.duracion} data-sobra={sobra || undefined} role="status">
      {sobra && <TriangleAlert aria-hidden size={18} />}
      <span>
        <strong>{total}'</strong> de ejercicios
        {prevista !== null && ` · el entreno dura ${prevista}'`}
        {sobra && ` (sobran ${total - prevista}')`}
      </span>
    </p>
  )
}

// El modo campo usa el plan guardado: con ejercicios, siempre a mano
function BotonCampo({ plan }: { plan: Plan }) {
  const plantilla = usePlantillaActiva()
  if (plan.ejercicios.length === 0) return null
  return (
    <Link to={rutaCampo(plantilla.id, plan.entrenoId)} className={estilos.botonCampo}>
      <Smartphone aria-hidden size={20} />
      Modo campo
    </Link>
  )
}

// El PDF sale del plan guardado: para imprimirlo o mandarlo por WhatsApp
function CompartirPlan({ plan, disabled }: { plan: Plan; disabled?: boolean }) {
  const plantilla = usePlantillaActiva()
  return (
    <BotonCompartirPdf
      url={`/api/plantillas/${plantilla.id}/entrenos/${plan.entrenoId}/plan.pdf`}
      nombre={`entreno-${plan.fecha}.pdf`}
      titulo="Sesión de entrenamiento"
      disabled={disabled}
    />
  )
}

const enlaceEjercicio = (plantillaId: string, id: string) =>
  `/plantillas/${plantillaId}/entrenos/ejercicios/${id}`

function Miniatura({ url }: { url: string | null }) {
  return url ? (
    <img src={url} alt="" className={estilos.miniatura} loading="lazy" />
  ) : (
    <span className={estilos.miniatura} aria-hidden="true">
      <Image size={18} />
    </span>
  )
}

function Lectura({ plan, volver }: { plan: Plan; volver: ReactNode }) {
  const plantilla = usePlantillaActiva()
  // Un ejercicio puede repetirse en el plan: la clave es su posición
  const ejercicios = plan.ejercicios.map((e, posicion) => ({ ...e, clave: String(posicion) }))
  return (
    <div className={estilos.pagina}>
      {volver}
      {cabecera(plan)}
      <BotonCampo plan={plan} />
      {!plan.objetivo && plan.ejercicios.length === 0 ? (
        <EstadoVacio titulo="Este entreno aún no tiene plan" />
      ) : (
        <>
          {plan.objetivo && (
            <p className={estilos.objetivo}>
              <span className={estilos.secundario}>Objetivo</span>
              {plan.objetivo}
            </p>
          )}
          {plan.notas && <p className={estilos.notas}>{plan.notas}</p>}
          <Duracion total={plan.duracionTotal} prevista={plan.duracionPrevista} />
          <ol className={estilos.lista} aria-label="Ejercicios del plan">
            {ejercicios.map((e) => (
              <li key={e.clave} className={estilos.paso}>
                <Miniatura url={e.urlMiniatura} />
                <span className={estilos.textoPaso}>
                  <Link to={enlaceEjercicio(plantilla.id, e.ejercicioId)}>{e.nombre}</Link>
                  {e.indicaciones && <span className={estilos.secundario}>{e.indicaciones}</span>}
                </span>
                {e.duracionMin && <span className={estilos.minutos}>{e.duracionMin}'</span>}
              </li>
            ))}
          </ol>
          <div className={estilos.acciones}>
            <CompartirPlan plan={plan} />
          </div>
        </>
      )}
    </div>
  )
}

type Paso = Pick<EjercicioPlan, 'ejercicioId' | 'nombre' | 'urlMiniatura' | 'archivado'> & {
  clave: number
  duracion: string
  indicaciones: string
}

const aPasos = (plan: Plan): Paso[] =>
  plan.ejercicios.map((e, clave) => ({
    clave,
    ejercicioId: e.ejercicioId,
    nombre: e.nombre,
    urlMiniatura: e.urlMiniatura,
    archivado: e.archivado,
    duracion: e.duracionMin ? String(e.duracionMin) : '',
    indicaciones: e.indicaciones ?? '',
  }))

function Editor({ plan, volver }: { plan: Plan; volver: ReactNode }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [objetivo, setObjetivo] = useState(plan.objetivo ?? '')
  const [notas, setNotas] = useState(plan.notas ?? '')
  const [pasos, setPasos] = useState<Paso[]>(() => aPasos(plan))
  const [siguiente, setSiguiente] = useState(plan.ejercicios.length)
  const [hoja, setHoja] = useState<
    null | 'ejercicio' | 'fecha' | 'duplicar' | 'modelo' | 'desde-modelo'
  >(null)
  const [error, setError] = useState<string | null>(null)

  const cuerpo = () => ({
    objetivo: objetivo.trim() || null,
    notas: notas.trim() || null,
    ejercicios: pasos.map((p) => ({
      ejercicioId: p.ejercicioId,
      duracionMin: p.duracion ? Number(p.duracion) : null,
      indicaciones: p.indicaciones.trim() || null,
    })),
  })
  const original = JSON.stringify({
    objetivo: plan.objetivo,
    notas: plan.notas,
    ejercicios: plan.ejercicios.map((e) => ({
      ejercicioId: e.ejercicioId,
      duracionMin: e.duracionMin,
      indicaciones: e.indicaciones,
    })),
  })
  const cambiado = JSON.stringify(cuerpo()) !== original
  const total = pasos.reduce((t, p) => t + (Number(p.duracion) || 0), 0)

  // Al salir con cambios sin guardar se pide confirmación, también al cerrar la página
  const bloqueo = useBlocker(
    ({ currentLocation, nextLocation }) =>
      cambiado && currentLocation.pathname !== nextLocation.pathname,
  )
  useEffect(() => {
    if (bloqueo.state !== 'blocked') return
    void confirmar({
      titulo: '¿Salir sin guardar el plan?',
      mensaje: 'Los cambios del plan se perderán.',
      textoConfirmar: 'Salir sin guardar',
      textoCancelar: 'Seguir editando',
      peligrosa: true,
    }).then((salir) => (salir ? bloqueo.proceed() : bloqueo.reset()))
  }, [bloqueo, confirmar])
  useEffect(() => {
    if (!cambiado) return
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [cambiado])

  const ruta = { id: plantilla.id, eid: plan.entrenoId }
  const alGuardar = async (guardado: Plan) => {
    cliente.setQueryData(['entrenos', plantilla.id, 'plan', guardado.entrenoId], guardado)
    await cliente.invalidateQueries({ queryKey: [...CLAVE_ENTRENOS, plantilla.id] })
  }
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PUT('/api/plantillas/{id}/entrenos/{eid}/plan', {
          params: { path: ruta },
          body: cuerpo(),
        }),
      ),
    onSuccess: async (guardado) => {
      await alGuardar(guardado)
      // Se reinicia con lo guardado (ya sin cambios pendientes)
      setPasos(aPasos(guardado))
      setSiguiente(guardado.ejercicios.length)
      avisar({ tipo: 'exito', mensaje: 'Plan guardado' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar el plan'),
  })

  const mover = (i: number, d: -1 | 1) =>
    setPasos((lista) => {
      const nueva = [...lista]
      ;[nueva[i], nueva[i + d]] = [nueva[i + d] as Paso, nueva[i] as Paso]
      return nueva
    })
  const cambiar = (clave: number, cambios: Partial<Paso>) =>
    setPasos((lista) => lista.map((p) => (p.clave === clave ? { ...p, ...cambios } : p)))

  return (
    <div className={estilos.pagina}>
      {volver}
      <div className={estilos.cabecera}>
        {cabecera(plan)}
        <Boton
          variante="texto"
          icono={<CalendarClock aria-hidden size={18} />}
          onClick={() => setHoja('fecha')}
        >
          Fecha y hora
        </Boton>
      </div>
      <BotonCampo plan={plan} />

      <Campo
        etiqueta="Objetivo"
        placeholder="Salida de balón ante presión alta"
        value={objetivo}
        maxLength={300}
        onChange={(e) => setObjetivo(e.target.value)}
      />
      <label className={estilos.areaTexto}>
        <span>Notas</span>
        <textarea
          rows={3}
          maxLength={2000}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Material, organización, recordatorios…"
        />
      </label>

      <section className={estilos.seccion} aria-labelledby="ejercicios-plan">
        <div className={estilos.cabecera}>
          <h3 id="ejercicios-plan">Ejercicios</h3>
          <Boton
            variante="secundario"
            icono={<Plus aria-hidden size={18} />}
            onClick={() => setHoja('ejercicio')}
          >
            Añadir
          </Boton>
        </div>
        <Duracion total={total} prevista={plan.duracionPrevista} />
        {pasos.length === 0 ? (
          <p className={estilos.secundario}>
            Añade ejercicios de la biblioteca del club, o crea el plan desde un modelo.
          </p>
        ) : (
          <ol className={estilos.lista} aria-label="Ejercicios del plan">
            {pasos.map((p, i) => (
              <li key={p.clave} className={estilos.pasoEditable}>
                <div className={estilos.paso}>
                  <span className={estilos.numero}>{i + 1}</span>
                  <Miniatura url={p.urlMiniatura} />
                  <span className={estilos.textoPaso}>
                    <Link to={enlaceEjercicio(plantilla.id, p.ejercicioId)}>{p.nombre}</Link>
                    {p.archivado && <span className={estilos.secundario}>archivado</span>}
                  </span>
                </div>
                <div className={estilos.detallesPaso}>
                  <label className={estilos.minutosEditable}>
                    <input
                      aria-label={`Minutos de ${p.nombre}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={240}
                      value={p.duracion}
                      onChange={(e) => cambiar(p.clave, { duracion: e.target.value })}
                    />
                    <span aria-hidden="true">min</span>
                  </label>
                  <input
                    className={estilos.indicaciones}
                    aria-label={`Indicaciones para ${p.nombre}`}
                    placeholder="Indicaciones para hoy"
                    maxLength={1000}
                    value={p.indicaciones}
                    onChange={(e) => cambiar(p.clave, { indicaciones: e.target.value })}
                  />
                  <span className={estilos.botonesPaso}>
                    <button
                      type="button"
                      aria-label={`Subir ${p.nombre}`}
                      disabled={i === 0}
                      onClick={() => mover(i, -1)}
                    >
                      <ArrowUp aria-hidden size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Bajar ${p.nombre}`}
                      disabled={i === pasos.length - 1}
                      onClick={() => mover(i, 1)}
                    >
                      <ArrowDown aria-hidden size={18} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Quitar ${p.nombre}`}
                      onClick={() => setPasos((l) => l.filter((x) => x.clave !== p.clave))}
                    >
                      <Trash2 aria-hidden size={18} />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className={estilos.acciones}>
        <CompartirPlan
          plan={plan}
          disabled={cambiado || (!plan.objetivo && plan.ejercicios.length === 0)}
        />
        <Boton
          variante="secundario"
          icono={<Copy aria-hidden size={18} />}
          disabled={cambiado || (!plan.objetivo && plan.ejercicios.length === 0)}
          onClick={() => setHoja('duplicar')}
        >
          Duplicar
        </Boton>
        <Boton
          variante="secundario"
          icono={<BookmarkPlus aria-hidden size={18} />}
          disabled={cambiado || pasos.length === 0}
          onClick={() => setHoja('modelo')}
        >
          Guardar como modelo
        </Boton>
        <Boton
          variante="secundario"
          icono={<LayoutTemplate aria-hidden size={18} />}
          onClick={() => setHoja('desde-modelo')}
        >
          Desde un modelo
        </Boton>
      </div>
      {cambiado && (
        <p className={estilos.secundario}>
          Guarda el plan para compartirlo, duplicarlo o guardarlo como modelo.
        </p>
      )}

      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.pieFijo}>
        <Boton
          icono={<Save aria-hidden size={18} />}
          cargando={guardar.isPending}
          disabled={!cambiado}
          onClick={() => {
            setError(null)
            guardar.mutate()
          }}
        >
          Guardar plan
        </Boton>
      </div>

      <HojaInferior
        abierta={hoja === 'ejercicio'}
        alCerrar={() => setHoja(null)}
        titulo="Añadir ejercicio"
      >
        {hoja === 'ejercicio' && (
          <ElegirEjercicio
            alElegir={(e) => {
              setPasos((l) => [
                ...l,
                {
                  clave: siguiente,
                  ejercicioId: e.id,
                  nombre: e.nombre,
                  urlMiniatura: e.urlMiniatura,
                  archivado: false,
                  duracion: e.duracionMin ? String(e.duracionMin) : '',
                  indicaciones: '',
                },
              ])
              setSiguiente((n) => n + 1)
              setHoja(null)
            }}
          />
        )}
      </HojaInferior>
      <HojaInferior abierta={hoja === 'fecha'} alCerrar={() => setHoja(null)} titulo="Fecha y hora">
        {hoja === 'fecha' && (
          <FechaHora plan={plan} alCerrar={() => setHoja(null)} alGuardar={alGuardar} />
        )}
      </HojaInferior>
      <HojaInferior
        abierta={hoja === 'duplicar'}
        alCerrar={() => setHoja(null)}
        titulo="Duplicar en otra fecha"
      >
        {hoja === 'duplicar' && <Duplicar plan={plan} alCerrar={() => setHoja(null)} />}
      </HojaInferior>
      <HojaInferior
        abierta={hoja === 'modelo'}
        alCerrar={() => setHoja(null)}
        titulo="Guardar como modelo"
      >
        {hoja === 'modelo' && <GuardarModelo plan={plan} alCerrar={() => setHoja(null)} />}
      </HojaInferior>
      <HojaInferior
        abierta={hoja === 'desde-modelo'}
        alCerrar={() => setHoja(null)}
        titulo="Crear desde un modelo"
      >
        {hoja === 'desde-modelo' && (
          <DesdeModelo
            plan={plan}
            alCerrar={() => setHoja(null)}
            alAplicar={async (nuevo) => {
              await alGuardar(nuevo)
              setObjetivo(nuevo.objetivo ?? '')
              setNotas(nuevo.notas ?? '')
              setPasos(aPasos(nuevo))
              setSiguiente(nuevo.ejercicios.length)
            }}
          />
        )}
      </HojaInferior>
    </div>
  )
}

function ElegirEjercicio({
  alElegir,
}: {
  alElegir: (e: {
    id: string
    nombre: string
    urlMiniatura: string | null
    duracionMin: number | null
  }) => void
}) {
  const plantilla = usePlantillaActiva()
  const [q, setQ] = useState('')
  const [busqueda, setBusqueda] = useState('')
  useEffect(() => {
    const espera = setTimeout(() => setBusqueda(q.trim()), 300)
    return () => clearTimeout(espera)
  }, [q])
  const ejercicios = useEjercicios(plantilla.clubId, { q: busqueda || undefined })
  return (
    <div className={estilos.elegir}>
      <div className={estilos.buscador}>
        <Search aria-hidden size={18} />
        <input
          type="search"
          aria-label="Buscar en la biblioteca"
          placeholder="Buscar en la biblioteca…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {ejercicios.isPending ? (
        <Cargando />
      ) : (ejercicios.data?.length ?? 0) === 0 ? (
        <p className={estilos.secundario}>
          {busqueda
            ? 'Ningún ejercicio con esa búsqueda.'
            : 'La biblioteca está vacía: crea ejercicios en la pestaña Ejercicios.'}
        </p>
      ) : (
        <ul className={estilos.lista} aria-label="Biblioteca">
          {ejercicios.data?.map((e) => (
            <li key={e.id}>
              <button type="button" className={estilos.opcionEjercicio} onClick={() => alElegir(e)}>
                <Miniatura url={e.urlMiniatura} />
                <span className={estilos.textoPaso}>
                  <strong>{e.nombre}</strong>
                  <span className={estilos.secundario}>{textoDetalles(e)}</span>
                </span>
                <Plus aria-hidden size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FechaHora({
  plan,
  alCerrar,
  alGuardar,
}: {
  plan: Plan
  alCerrar: () => void
  alGuardar: (p: Plan) => Promise<void>
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const [fecha, setFecha] = useState(plan.fecha)
  const [hora, setHora] = useState(plan.hora ?? '')
  const [horaFin, setHoraFin] = useState(plan.horaFin ?? '')
  const [error, setError] = useState<string | null>(null)
  const cambiar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/plantillas/{id}/entrenos/{eid}', {
          params: { path: { id: plantilla.id, eid: plan.entrenoId } },
          body: { fecha, hora: hora || null, horaFin: horaFin || null },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: [...CLAVE_ENTRENOS, plantilla.id] })
      await alGuardar({ ...plan, fecha, hora: hora || null, horaFin: horaFin || null })
      alCerrar()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido cambiar'),
  })
  return (
    <form
      className={estilos.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (horaFin && (!hora || horaFin <= hora))
          return setError('La hora de fin debe ser posterior a la de inicio')
        cambiar.mutate()
      }}
    >
      <Campo
        etiqueta="Fecha"
        type="date"
        required
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
      />
      <div className={estilos.columnas}>
        <Campo
          etiqueta="Inicio"
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
        />
        <Campo
          etiqueta="Fin"
          type="time"
          value={horaFin}
          onChange={(e) => setHoraFin(e.target.value)}
        />
      </div>
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={cambiar.isPending}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}

function Duplicar({ plan, alCerrar }: { plan: Plan; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const [fecha, setFecha] = useState('')
  const [error, setError] = useState<string | null>(null)
  const duplicar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/entrenos/{eid}/plan/duplicar', {
          params: { path: { id: plantilla.id, eid: plan.entrenoId } },
          body: { fecha },
        }),
      ),
    onSuccess: async (copia) => {
      await cliente.invalidateQueries({ queryKey: [...CLAVE_ENTRENOS, plantilla.id] })
      avisar({ tipo: 'exito', mensaje: `Plan copiado al ${textoFecha(copia.fecha)}` })
      alCerrar()
      navegar(rutaPlan(plantilla.id, copia.entrenoId))
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido duplicar'),
  })
  return (
    <form
      className={estilos.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (!fecha) return setError('Elige la fecha')
        duplicar.mutate()
      }}
    >
      <Campo
        etiqueta="Fecha"
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        ayuda="Va al entreno de ese día que no tenga plan; si no hay ninguno, se crea con las mismas horas."
        error={error ?? undefined}
      />
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={duplicar.isPending}>
          Duplicar
        </Boton>
      </div>
    </form>
  )
}

function GuardarModelo({ plan, alCerrar }: { plan: Plan; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [nombre, setNombre] = useState(plan.objetivo ?? '')
  const [error, setError] = useState<string | null>(null)
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/plantillas/{id}/entrenos/{eid}/plan/guardar-modelo', {
          params: { path: { id: plantilla.id, eid: plan.entrenoId } },
          body: { nombre: nombre.trim() },
        }),
      ),
    onSuccess: async (modelo) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_MODELOS })
      avisar({ tipo: 'exito', mensaje: `Modelo «${modelo.nombre}» guardado` })
      alCerrar()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar'),
  })
  return (
    <form
      className={estilos.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        if (!nombre.trim()) return setError('Ponle un nombre al modelo')
        guardar.mutate()
      }}
    >
      <Campo
        etiqueta="Nombre del modelo"
        value={nombre}
        maxLength={80}
        onChange={(e) => setNombre(e.target.value)}
        ayuda="Los modelos son del club: sirven para cualquier plantilla y temporada."
        error={error ?? undefined}
      />
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar modelo
        </Boton>
      </div>
    </form>
  )
}

function DesdeModelo({
  plan,
  alCerrar,
  alAplicar,
}: {
  plan: Plan
  alCerrar: () => void
  alAplicar: (plan: Plan) => Promise<void>
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const modelos = useModelos(plantilla.clubId)
  const aplicar = useMutation({
    mutationFn: (mid: string) =>
      datos(
        api.POST('/api/plantillas/{id}/entrenos/{eid}/plan/desde-modelo/{mid}', {
          params: { path: { id: plantilla.id, eid: plan.entrenoId, mid } },
        }),
      ),
    onSuccess: async (nuevo) => {
      await alAplicar(nuevo)
      avisar({ tipo: 'exito', mensaje: 'Plan creado desde el modelo' })
      alCerrar()
    },
    onError: (e) =>
      avisar({
        tipo: 'error',
        mensaje: e instanceof Error ? e.message : 'No se ha podido aplicar',
      }),
  })
  if (modelos.isPending) return <Cargando />
  if ((modelos.data?.length ?? 0) === 0) {
    return (
      <p className={estilos.secundario}>
        Todavía no hay modelos: guarda un plan como modelo para reutilizarlo.
      </p>
    )
  }
  return (
    <ul className={estilos.lista} aria-label="Modelos del club">
      {modelos.data?.map((m) => (
        <li key={m.id}>
          <button
            type="button"
            className={estilos.opcionEjercicio}
            disabled={aplicar.isPending}
            onClick={async () => {
              const conPlan = plan.objetivo || plan.ejercicios.length > 0
              const si =
                !conPlan ||
                (await confirmar({
                  titulo: `¿Sustituir el plan por «${m.nombre}»?`,
                  mensaje: 'El plan actual de este entreno se sustituye por el del modelo.',
                  textoConfirmar: 'Sustituir',
                }))
              if (si) aplicar.mutate(m.id)
            }}
          >
            <span className={estilos.textoPaso}>
              <strong>{m.nombre}</strong>
              <span className={estilos.secundario}>
                {[
                  m.objetivo,
                  `${m.ejercicios} ejercicios`,
                  m.duracionTotal ? `${m.duracionTotal}'` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
