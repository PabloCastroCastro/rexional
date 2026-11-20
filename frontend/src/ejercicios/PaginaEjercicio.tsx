import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  CircleAlert,
  Copy,
  Ellipsis,
  ExternalLink,
  ImagePlus,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { type CSSProperties, type FormEvent, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, datos, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { type Cifra, Cifras } from '../componentes/Cifras'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { textoFecha } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CATEGORIAS,
  CLAVE_EJERCICIOS,
  claveEjercicio,
  colorCategoria,
  dominio,
  type Ejercicio,
  type Medio,
  subirMedio,
  textoMb,
  useEjercicio,
  useLimites,
} from './datos'
import estilos from './Ejercicios.module.css'
import { FormularioEjercicio } from './FormularioEjercicio'
import { IconoCategoria } from './MiniaturaEjercicio'

// Ficha de un ejercicio: explicación, fotos, vídeos y enlaces. El cuerpo técnico sube fotos y vídeos
// (desde la galería o la cámara del móvil), añade enlaces, ordena, edita pies, duplica y archiva.

export function PaginaEjercicio() {
  const plantilla = usePlantillaActiva()
  const { ejercicioId = '' } = useParams()
  const ejercicio = useEjercicio(plantilla.clubId, ejercicioId, plantilla.id)
  const biblioteca = `/plantillas/${plantilla.id}/entrenos/ejercicios`
  const volver = (
    <Link to={biblioteca} className={estilos.volver}>
      <ChevronLeft aria-hidden size={20} />
      Ejercicios
    </Link>
  )
  if (ejercicio.isPending) return <Cargando />
  if (ejercicio.isError) {
    return (
      <div className={estilos.ficha}>
        {volver}
        <EstadoVacio titulo="No se encuentra el ejercicio" descripcion={ejercicio.error.message} />
      </div>
    )
  }
  return <Ficha ejercicio={ejercicio.data} volver={volver} biblioteca={biblioteca} />
}

function Ficha({
  ejercicio: e,
  volver,
  biblioteca,
}: {
  ejercicio: Ejercicio
  volver: React.ReactNode
  biblioteca: string
}) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [editando, setEditando] = useState(false)
  const [opciones, setOpciones] = useState(false)
  // En casillas (GH-275); la que no tiene dato no se muestra
  const cifras = (
    [
      e.duracionMin ? { texto: 'Minutos', valor: e.duracionMin } : null,
      e.jugadores ? { texto: 'Jugadores', valor: e.jugadores } : null,
      e.material ? { texto: 'Material', valor: e.material, ancha: true } : null,
    ] satisfies (Cifra | null)[]
  ).filter((c) => c !== null)

  return (
    <div className={estilos.ficha}>
      {volver}
      <header className={estilos.cabecera}>
        {/* Editar y «⋯» junto al título, como en la ficha del jugador (GH-234, GH-275) */}
        <div className={estilos.filaTitulo}>
          <h2>{e.nombre}</h2>
          {gestiona && (
            <>
              <Boton
                variante="secundario"
                className={estilos.botonIcono}
                icono={<Pencil aria-hidden size={18} />}
                aria-label="Editar"
                title="Editar"
                onClick={() => setEditando(true)}
              />
              <Boton
                variante="secundario"
                className={estilos.botonIcono}
                icono={<Ellipsis aria-hidden size={20} />}
                aria-label="Opciones del ejercicio"
                aria-haspopup="dialog"
                title="Opciones del ejercicio"
                onClick={() => setOpciones(true)}
              />
            </>
          )}
        </div>
        <p className={estilos.chipsFicha}>
          <span
            className={estilos.chipCategoria}
            style={{ '--color-chip': colorCategoria(e.categoria) } as CSSProperties}
          >
            <IconoCategoria categoria={e.categoria} />
            {e.categoria ? CATEGORIAS[e.categoria] : 'Sin categoría'}
          </span>
          {e.archivado && <span className={estilos.marcaArchivado}>Archivado</span>}
          {e.etiquetas.map((t) => (
            <span key={t} className={estilos.etiquetaFicha}>
              {t}
            </span>
          ))}
        </p>
      </header>

      {e.descripcion && <p className={estilos.descripcion}>{e.descripcion}</p>}
      {cifras.length > 0 && <Cifras cifras={cifras} columnas={2} />}
      {e.enPlantilla && <p className={estilos.usoEjercicio}>{textoUso(e.enPlantilla)}</p>}

      {/* Primero ver: cada foto, vídeo o enlace se gestiona desde su «⋯» (GH-276) */}
      <section className={estilos.seccion} aria-labelledby="medios">
        <h3 id="medios">Fotos, vídeos y enlaces</h3>
        {e.medios.length === 0 ? (
          <p className={estilos.secundario}>
            {gestiona
              ? 'Añade fotos o vídeos del ejercicio desde el móvil, o un enlace (por ejemplo, de YouTube).'
              : 'Este ejercicio no tiene fotos ni vídeos.'}
          </p>
        ) : (
          <ul className={estilos.galeria} aria-label="Fotos, vídeos y enlaces">
            {e.medios.map((m, i) => (
              <li key={m.id}>
                <ElementoMedio ejercicio={e} medio={m} posicion={i} gestiona={gestiona} />
              </li>
            ))}
          </ul>
        )}
        {gestiona && <AnadirMedios ejercicio={e} />}
      </section>

      <FormularioEjercicio abierta={editando} ejercicio={e} alCerrar={() => setEditando(false)} />
      {gestiona && (
        <OpcionesEjercicio
          ejercicio={e}
          abierta={opciones}
          alCerrar={() => setOpciones(false)}
          biblioteca={biblioteca}
        />
      )}
    </div>
  )
}

// «Usado en 3 entrenos · el último, jueves 15 oct» (GH-277): solo los entrenos de la plantilla activa
function textoUso({ entrenos, ultimo }: { entrenos: number; ultimo: string | null }) {
  if (entrenos === 0) return 'Todavía no se ha usado en ningún entreno'
  const cuantos = `${entrenos} ${entrenos === 1 ? 'entreno' : 'entrenos'}`
  // Solo en planes de entrenos que aún no han llegado
  if (!ultimo) return `Planificado en ${cuantos}; todavía no se ha hecho`
  const dia = textoFecha(ultimo)
  const cuando = dia.startsWith('Hoy')
    ? 'hoy'
    : dia.startsWith('Ayer')
      ? 'ayer'
      : dia.replace(',', '')
  return `Usado en ${cuantos} · el último, ${cuando}`
}

// «la foto», «el vídeo», «el enlace»
const nombreMedio = (m: Medio) =>
  m.tipo === 'foto' ? 'la foto' : m.tipo === 'video' ? 'el vídeo' : 'el enlace'

function ElementoMedio({
  ejercicio,
  medio: m,
  posicion,
  gestiona,
}: {
  ejercicio: Ejercicio
  medio: Medio
  posicion: number
  gestiona: boolean
}) {
  const [opciones, setOpciones] = useState(false)
  // Distingue cada uno para el lector de pantalla: por su título o, sin él, por su posición
  const deCual = `${m.tipo === 'foto' ? 'de la foto' : m.tipo === 'video' ? 'del vídeo' : 'del enlace'} ${m.pie ? `«${m.pie}»` : posicion + 1}`
  const mas = gestiona && (
    <>
      <button
        type="button"
        className={estilos.masMedio}
        aria-label={`Opciones ${deCual}`}
        aria-haspopup="dialog"
        title="Opciones"
        onClick={() => setOpciones(true)}
      >
        <Ellipsis aria-hidden size={20} />
      </button>
      <OpcionesMedio
        ejercicio={ejercicio}
        medio={m}
        posicion={posicion}
        abierta={opciones}
        alCerrar={() => setOpciones(false)}
      />
    </>
  )
  // El enlace lleva el título dentro de su tarjeta; el «⋯», al lado
  if (m.tipo === 'enlace') {
    return (
      <div className={estilos.filaEnlace}>
        <VistaMedio medio={m} />
        {mas}
      </div>
    )
  }
  // Foto o vídeo: el «⋯» en la esquina y el título debajo
  return (
    <figure className={estilos.medio}>
      <div className={estilos.marcoMedio}>
        <VistaMedio medio={m} />
        {mas}
      </div>
      {m.pie && <figcaption>{m.pie}</figcaption>}
    </figure>
  )
}

function VistaMedio({ medio: m }: { medio: Medio }) {
  if (m.tipo === 'enlace' && m.url) {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className={estilos.enlace}>
        <ExternalLink aria-hidden size={20} />
        <span>
          <strong>{m.pie || dominio(m.url)}</strong>
          {/* El espacio separa el título de la web al leerlo; en pantalla, cada uno en su línea */}
          {m.pie && ' '}
          {m.pie && <span className={estilos.secundario}>{dominio(m.url)}</span>}
        </span>
      </a>
    )
  }
  if (m.estado === 'procesando') {
    return (
      <div className={estilos.procesando} role="status">
        <LoaderCircle aria-hidden size={22} className={estilos.girando} />
        Procesando el vídeo: en unos minutos se podrá ver
      </div>
    )
  }
  if (m.estado === 'error' || !m.urlArchivo) {
    return (
      <div className={estilos.procesando}>
        <CircleAlert aria-hidden size={22} />
        No se ha podido procesar este vídeo
      </div>
    )
  }
  if (m.tipo === 'video') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: vídeos de ejercicios grabados en el campo, sin subtítulos
      <video
        controls
        playsInline
        preload="metadata"
        poster={m.urlMiniatura ?? undefined}
        className={estilos.video}
      >
        <source src={m.urlArchivo} type={m.mime ?? undefined} />
      </video>
    )
  }
  return (
    <a href={m.urlArchivo} target="_blank" rel="noreferrer">
      <img
        src={m.urlArchivo}
        alt={m.pie ?? 'Foto del ejercicio'}
        className={estilos.foto}
        loading="lazy"
      />
    </a>
  )
}

// Subida de fotos y vídeos: varios a la vez, de uno en uno, con progreso y cancelar
type Subida = {
  id: number
  nombre: string
  progreso: number
  error?: string
  cancelar?: () => void
}

// Al final de la sección (GH-276): un solo botón que deja elegir entre subir un archivo (varios a la
// vez, con progreso y cancelar) o pegar un enlace
function AnadirMedios({ ejercicio }: { ejercicio: Ejercicio }) {
  const plantilla = usePlantillaActiva()
  const [eligiendo, setEligiendo] = useState(false)
  const [enlace, setEnlace] = useState(false)
  const cliente = useQueryClient()
  const limites = useLimites()
  const entrada = useRef<HTMLInputElement>(null)
  const [subidas, setSubidas] = useState<Subida[]>([])
  const siguiente = useRef(0)

  const actualizar = (id: number, cambios: Partial<Subida>) =>
    setSubidas((todas) => todas.map((s) => (s.id === id ? { ...s, ...cambios } : s)))
  const quitar = (id: number) => setSubidas((todas) => todas.filter((s) => s.id !== id))

  async function subir(archivos: File[]) {
    for (const archivo of archivos) {
      const id = siguiente.current++
      const esVideo = archivo.type.startsWith('video/')
      const maximo = esVideo ? limites.data?.maxVideoBytes : limites.data?.maxFotoBytes
      setSubidas((todas) => [...todas, { id, nombre: archivo.name, progreso: 0 }])
      // Antes de subir nada: lo que el servidor va a rechazar
      if (/hei[cf]$/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name)) {
        actualizar(id, {
          error:
            'Las fotos HEIC no se admiten: elígela desde la galería del navegador o expórtala como JPEG',
        })
        continue
      }
      if (maximo && archivo.size > maximo) {
        actualizar(id, {
          error: `Pesa ${textoMb(archivo.size)} y el máximo para ${esVideo ? 'vídeos' : 'fotos'} es ${textoMb(maximo)}`,
        })
        continue
      }
      const { promesa, cancelar } = subirMedio(plantilla.clubId, ejercicio.id, archivo, (p) =>
        actualizar(id, { progreso: p }),
      )
      actualizar(id, { cancelar })
      try {
        await promesa
        quitar(id)
      } catch (error) {
        const codigo = (error as { codigo?: string }).codigo
        if (codigo === 'cancelada') quitar(id)
        else
          actualizar(id, {
            error: error instanceof Error ? error.message : 'No se ha podido subir',
            cancelar: undefined,
          })
      }
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
    }
  }

  return (
    <>
      <input
        ref={entrada}
        type="file"
        accept="image/jpeg,image/png,image/webp,video/*"
        multiple
        hidden
        aria-label="Fotos o vídeos del ejercicio"
        onChange={(ev) => {
          const archivos = [...(ev.target.files ?? [])]
          ev.target.value = ''
          void subir(archivos)
        }}
      />
      {subidas.length > 0 && (
        <ul className={estilos.subidas} aria-label="Subidas">
          {subidas.map((s) => (
            <li key={s.id} data-error={s.error ? true : undefined}>
              <span className={estilos.nombreSubida}>{s.nombre}</span>
              {s.error ? (
                <span role="alert">{s.error}</span>
              ) : (
                <progress max={1} value={s.progreso} aria-label={`Subiendo ${s.nombre}`} />
              )}
              <button
                type="button"
                aria-label={
                  s.error ? `Cerrar aviso de ${s.nombre}` : `Cancelar la subida de ${s.nombre}`
                }
                onClick={() => (s.cancelar && !s.error ? s.cancelar() : quitar(s.id))}
              >
                <X aria-hidden size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Boton
        variante="secundario"
        className={estilos.botonAnadir}
        icono={<Plus aria-hidden size={18} />}
        aria-haspopup="dialog"
        onClick={() => setEligiendo(true)}
      >
        Añadir foto, vídeo o enlace
      </Boton>
      <HojaInferior
        abierta={eligiendo}
        alCerrar={() => setEligiendo(false)}
        titulo="Añadir foto, vídeo o enlace"
      >
        <ul className={estilos.opciones}>
          <li>
            {/* El selector de archivos se abre en el mismo toque: el navegador lo exige */}
            <button
              type="button"
              onClick={() => {
                setEligiendo(false)
                entrada.current?.click()
              }}
            >
              <ImagePlus aria-hidden size={20} />
              Subir foto o vídeo
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => {
                setEligiendo(false)
                setEnlace(true)
              }}
            >
              <Link2 aria-hidden size={20} />
              Pegar un enlace
            </button>
          </li>
        </ul>
      </HojaInferior>
      <HojaInferior abierta={enlace} alCerrar={() => setEnlace(false)} titulo="Añadir enlace">
        {enlace && <FormularioEnlace ejercicio={ejercicio} alCerrar={() => setEnlace(false)} />}
      </HojaInferior>
    </>
  )
}

// «⋯» de una foto, vídeo o enlace (GH-276): mover (si hay más de uno), cambiar el título y quitar
function OpcionesMedio({
  ejercicio,
  medio,
  posicion,
  abierta,
  alCerrar,
}: {
  ejercicio: Ejercicio
  medio: Medio
  posicion: number
  abierta: boolean
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const [pie, setPie] = useState(false)
  const ruta = { cid: plantilla.clubId, eid: ejercicio.id }
  const fallo = (error: unknown) =>
    avisar({
      tipo: 'error',
      mensaje: error instanceof Error ? error.message : 'No se ha podido guardar',
    })

  const mover = useMutation({
    mutationFn: (desplazamiento: -1 | 1) => {
      const ids = ejercicio.medios.map((m) => m.id)
      const i = ids.indexOf(medio.id)
      ;[ids[i], ids[i + desplazamiento]] = [ids[i + desplazamiento] as string, ids[i] as string]
      return datos(
        api.PUT('/api/clubes/{cid}/ejercicios/{eid}/medios/orden', {
          params: { path: ruta },
          body: { medios: ids },
        }),
      )
    },
    // La respuesta no trae el uso en la plantilla: se conserva el que ya había
    onSuccess: (actualizado) =>
      cliente.setQueryData<Ejercicio>(
        claveEjercicio(plantilla.clubId, ejercicio.id, plantilla.id),
        (previo) => ({ ...actualizado, enPlantilla: previo?.enPlantilla ?? null }),
      ),
    onError: fallo,
  })

  const quitar = useMutation({
    mutationFn: () =>
      enviar(
        api.DELETE('/api/clubes/{cid}/ejercicios/{eid}/medios/{mid}', {
          params: { path: { ...ruta, mid: medio.id } },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      avisar({
        tipo: 'exito',
        mensaje: medio.tipo === 'enlace' ? 'Enlace quitado' : 'Archivo quitado',
      })
    },
    onError: fallo,
  })

  const nombre = nombreMedio(medio)
  const total = ejercicio.medios.length
  return (
    <>
      <HojaInferior
        abierta={abierta}
        alCerrar={alCerrar}
        titulo={medio.tipo === 'foto' ? 'Foto' : medio.tipo === 'video' ? 'Vídeo' : 'Enlace'}
      >
        <ul className={estilos.opciones}>
          {/* Con uno solo no hay nada que mover; tras mover, la hoja sigue abierta para seguir */}
          {total > 1 && (
            <>
              <li>
                <button
                  type="button"
                  disabled={posicion === 0 || mover.isPending}
                  onClick={() => mover.mutate(-1)}
                >
                  <ArrowUp aria-hidden size={20} />
                  Mover arriba
                </button>
              </li>
              <li>
                <button
                  type="button"
                  disabled={posicion === total - 1 || mover.isPending}
                  onClick={() => mover.mutate(1)}
                >
                  <ArrowDown aria-hidden size={20} />
                  Mover abajo
                </button>
              </li>
            </>
          )}
          <li>
            <button
              type="button"
              onClick={() => {
                alCerrar()
                setPie(true)
              }}
            >
              <Pencil aria-hidden size={20} />
              Cambiar el título
            </button>
          </li>
          <li>
            <button
              type="button"
              className={estilos.opcionPeligrosa}
              disabled={quitar.isPending}
              onClick={async () => {
                alCerrar()
                const si = await confirmar({
                  titulo: `¿Quitar ${nombre}?`,
                  mensaje:
                    medio.tipo === 'enlace'
                      ? 'Se quita el enlace del ejercicio.'
                      : 'Se borra el archivo. No se puede deshacer.',
                  textoConfirmar: 'Quitar',
                  peligrosa: true,
                })
                if (si) quitar.mutate()
              }}
            >
              <Trash2 aria-hidden size={20} />
              Quitar
            </button>
          </li>
        </ul>
      </HojaInferior>
      <HojaInferior abierta={pie} alCerrar={() => setPie(false)} titulo="Título">
        {pie && (
          <FormularioPie ejercicio={ejercicio} medio={medio} alCerrar={() => setPie(false)} />
        )}
      </HojaInferior>
    </>
  )
}

function FormularioPie({
  ejercicio,
  medio,
  alCerrar,
}: {
  ejercicio: Ejercicio
  medio: Medio
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const [texto, setTexto] = useState(medio.pie ?? '')
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/clubes/{cid}/ejercicios/{eid}/medios/{mid}', {
          params: { path: { cid: plantilla.clubId, eid: ejercicio.id, mid: medio.id } },
          body: { pie: texto.trim() || null },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      alCerrar()
    },
  })
  return (
    <form
      className={estilos.formulario}
      onSubmit={(ev: FormEvent) => {
        ev.preventDefault()
        guardar.mutate()
      }}
    >
      <Campo
        etiqueta="Título"
        value={texto}
        maxLength={500}
        onChange={(ev) => setTexto(ev.target.value)}
      />
      {guardar.isError && (
        <p className={estilos.error} role="alert">
          {guardar.error.message}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}

function FormularioEnlace({ ejercicio, alCerrar }: { ejercicio: Ejercicio; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const [url, setUrl] = useState('')
  const [pie, setPie] = useState('')
  const [error, setError] = useState<string | null>(null)
  const guardar = useMutation({
    mutationFn: () =>
      datos(
        api.POST('/api/clubes/{cid}/ejercicios/{eid}/medios/enlace', {
          params: { path: { cid: plantilla.clubId, eid: ejercicio.id } },
          body: { url: url.trim(), pie: pie.trim() || null },
        }),
      ),
    onSuccess: async () => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      alCerrar()
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido añadir'),
  })
  return (
    <form
      className={estilos.formulario}
      onSubmit={(ev) => {
        ev.preventDefault()
        setError(null)
        if (!/^https?:\/\/\S+/i.test(url.trim()))
          return setError('Pega una dirección web, que empiece por https://')
        guardar.mutate()
      }}
    >
      <Campo
        etiqueta="Dirección"
        type="url"
        inputMode="url"
        placeholder="https://www.youtube.com/watch?v=…"
        value={url}
        onChange={(ev) => setUrl(ev.target.value)}
        error={error ?? undefined}
      />
      <Campo
        etiqueta="Título (opcional)"
        value={pie}
        maxLength={500}
        onChange={(ev) => setPie(ev.target.value)}
      />
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={guardar.isPending}>
          Añadir enlace
        </Boton>
      </div>
    </form>
  )
}

// «⋯» de la ficha (GH-275): duplicar, archivar o desarchivar y, si no se ha usado, borrar
function OpcionesEjercicio({
  ejercicio: e,
  abierta,
  alCerrar,
  biblioteca,
}: {
  ejercicio: Ejercicio
  abierta: boolean
  alCerrar: () => void
  biblioteca: string
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const navegar = useNavigate()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const ruta = { cid: plantilla.clubId, eid: e.id }
  const fallo = (error: unknown) =>
    avisar({
      tipo: 'error',
      mensaje: error instanceof Error ? error.message : 'No se ha podido hacer',
    })

  const archivar = useMutation({
    mutationFn: () =>
      datos(
        api.PATCH('/api/clubes/{cid}/ejercicios/{eid}', {
          params: { path: ruta },
          body: { archivado: !e.archivado },
        }),
      ),
    onSuccess: async (actualizado) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      avisar({
        tipo: 'exito',
        mensaje: actualizado.archivado ? 'Ejercicio archivado' : 'Ejercicio desarchivado',
      })
    },
    onError: fallo,
  })
  const duplicar = useMutation({
    mutationFn: () =>
      datos(api.POST('/api/clubes/{cid}/ejercicios/{eid}/duplicar', { params: { path: ruta } })),
    onSuccess: async (copia) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      avisar({ tipo: 'exito', mensaje: `Copia creada: «${copia.nombre}»` })
      navegar(`${biblioteca}/${copia.id}`)
    },
    onError: fallo,
  })
  const borrar = useMutation({
    mutationFn: () =>
      enviar(api.DELETE('/api/clubes/{cid}/ejercicios/{eid}', { params: { path: ruta } })),
    onSuccess: async () => {
      navegar(biblioteca, { replace: true })
      await cliente.invalidateQueries({ queryKey: CLAVE_EJERCICIOS })
      avisar({ tipo: 'exito', mensaje: `«${e.nombre}» borrado` })
    },
    onError: fallo,
  })

  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Opciones del ejercicio">
      <ul className={estilos.opciones}>
        <li>
          <button
            type="button"
            disabled={duplicar.isPending}
            onClick={() => {
              alCerrar()
              duplicar.mutate()
            }}
          >
            <Copy aria-hidden size={20} />
            Duplicar
          </button>
        </li>
        <li>
          <button
            type="button"
            disabled={archivar.isPending}
            onClick={() => {
              alCerrar()
              archivar.mutate()
            }}
          >
            {e.archivado ? (
              <ArchiveRestore aria-hidden size={20} />
            ) : (
              <Archive aria-hidden size={20} />
            )}
            {e.archivado ? 'Desarchivar' : 'Archivar'}
          </button>
        </li>
        {/* Solo si no se ha usado en ningún plan: si no, se archiva */}
        {e.usos === 0 && (
          <li>
            <button
              type="button"
              className={estilos.opcionPeligrosa}
              disabled={borrar.isPending}
              onClick={async () => {
                alCerrar()
                const si = await confirmar({
                  titulo: `¿Borrar «${e.nombre}»?`,
                  mensaje: 'Se borran también sus fotos y vídeos. No se puede deshacer.',
                  textoConfirmar: 'Borrar ejercicio',
                  peligrosa: true,
                })
                if (si) borrar.mutate()
              }}
            >
              <Trash2 aria-hidden size={20} />
              Borrar
            </button>
          </li>
        )}
      </ul>
    </HojaInferior>
  )
}
