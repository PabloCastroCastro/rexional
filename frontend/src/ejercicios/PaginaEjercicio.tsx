import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  CircleAlert,
  Copy,
  ExternalLink,
  ImagePlus,
  Link2,
  LoaderCircle,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, datos, enviar } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { Cargando } from '../componentes/Cargando'
import { useConfirmacion } from '../componentes/Confirmacion'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { HojaInferior } from '../componentes/HojaInferior'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  CLAVE_EJERCICIOS,
  dominio,
  type Ejercicio,
  type Medio,
  subirMedio,
  textoDetalles,
  textoMb,
  useEjercicio,
  useLimites,
} from './datos'
import estilos from './Ejercicios.module.css'
import { FormularioEjercicio } from './FormularioEjercicio'

// Ficha de un ejercicio: explicación, fotos, vídeos y enlaces. El cuerpo técnico sube fotos y vídeos
// (desde la galería o la cámara del móvil), añade enlaces, ordena, edita pies, duplica y archiva.

export function PaginaEjercicio() {
  const plantilla = usePlantillaActiva()
  const { ejercicioId = '' } = useParams()
  const ejercicio = useEjercicio(plantilla.clubId, ejercicioId)
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
  const [enlace, setEnlace] = useState(false)
  const datosFicha = [
    e.jugadores && { titulo: 'Jugadores', texto: e.jugadores },
    e.material && { titulo: 'Material', texto: e.material },
  ].filter((d): d is { titulo: string; texto: string } => Boolean(d))

  return (
    <div className={estilos.ficha}>
      {volver}
      <header className={estilos.cabecera}>
        <h2>{e.nombre}</h2>
        <p className={estilos.secundario}>
          {[textoDetalles(e), e.archivado && 'Archivado'].filter(Boolean).join(' · ') ||
            'Sin categoría'}
        </p>
        {e.etiquetas.length > 0 && (
          <p className={estilos.etiquetas}>
            {e.etiquetas.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </p>
        )}
      </header>

      {gestiona && (
        <Acciones ejercicio={e} alEditar={() => setEditando(true)} biblioteca={biblioteca} />
      )}

      {e.descripcion && <p className={estilos.descripcion}>{e.descripcion}</p>}
      {datosFicha.length > 0 && (
        <dl className={estilos.datosFicha}>
          {datosFicha.map((d) => (
            <div key={d.titulo}>
              <dt>{d.titulo}</dt>
              <dd>{d.texto}</dd>
            </div>
          ))}
        </dl>
      )}

      <section className={estilos.seccion} aria-labelledby="medios">
        <h3 id="medios">Fotos, vídeos y enlaces</h3>
        {gestiona && (
          <div className={estilos.accionesMedios}>
            <Subidas ejercicio={e} />
            <Boton
              variante="secundario"
              icono={<Link2 aria-hidden size={18} />}
              onClick={() => setEnlace(true)}
            >
              Añadir enlace
            </Boton>
          </div>
        )}
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
                <VistaMedio medio={m} />
                {(m.pie || gestiona) && (
                  <div className={estilos.pieMedio}>
                    {m.pie && <p>{m.pie}</p>}
                    {gestiona && (
                      <ControlesMedio
                        ejercicio={e}
                        medio={m}
                        primero={i === 0}
                        ultimo={i === e.medios.length - 1}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormularioEjercicio abierta={editando} ejercicio={e} alCerrar={() => setEditando(false)} />
      <HojaInferior abierta={enlace} alCerrar={() => setEnlace(false)} titulo="Añadir enlace">
        {enlace && <FormularioEnlace ejercicio={e} alCerrar={() => setEnlace(false)} />}
      </HojaInferior>
    </div>
  )
}

function VistaMedio({ medio: m }: { medio: Medio }) {
  if (m.tipo === 'enlace' && m.url) {
    return (
      <a href={m.url} target="_blank" rel="noreferrer" className={estilos.enlace}>
        <ExternalLink aria-hidden size={20} />
        <span>
          <strong>Ver vídeo o enlace</strong>
          <span className={estilos.secundario}>{dominio(m.url)}</span>
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

function Subidas({ ejercicio }: { ejercicio: Ejercicio }) {
  const plantilla = usePlantillaActiva()
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
      <Boton icono={<ImagePlus aria-hidden size={18} />} onClick={() => entrada.current?.click()}>
        Añadir foto o vídeo
      </Boton>
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
    </>
  )
}

function ControlesMedio({
  ejercicio,
  medio,
  primero,
  ultimo,
}: {
  ejercicio: Ejercicio
  medio: Medio
  primero: boolean
  ultimo: boolean
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
    onSuccess: (actualizado) =>
      cliente.setQueryData(
        [...CLAVE_EJERCICIOS, plantilla.clubId, 'ejercicio', ejercicio.id],
        actualizado,
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

  const nombre =
    medio.tipo === 'foto' ? 'la foto' : medio.tipo === 'video' ? 'el vídeo' : 'el enlace'
  return (
    <div className={estilos.controles}>
      <button
        type="button"
        aria-label={`Subir ${nombre}`}
        disabled={primero || mover.isPending}
        onClick={() => mover.mutate(-1)}
      >
        <ArrowUp aria-hidden size={18} />
      </button>
      <button
        type="button"
        aria-label={`Bajar ${nombre}`}
        disabled={ultimo || mover.isPending}
        onClick={() => mover.mutate(1)}
      >
        <ArrowDown aria-hidden size={18} />
      </button>
      <button type="button" aria-label={`Editar el pie de ${nombre}`} onClick={() => setPie(true)}>
        <Pencil aria-hidden size={18} />
      </button>
      <button
        type="button"
        aria-label={`Quitar ${nombre}`}
        disabled={quitar.isPending}
        onClick={async () => {
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
        <Trash2 aria-hidden size={18} />
      </button>
      <HojaInferior abierta={pie} alCerrar={() => setPie(false)} titulo="Pie">
        {pie && (
          <FormularioPie ejercicio={ejercicio} medio={medio} alCerrar={() => setPie(false)} />
        )}
      </HojaInferior>
    </div>
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
        etiqueta="Pie"
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
        etiqueta="Pie (opcional)"
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

function Acciones({
  ejercicio: e,
  alEditar,
  biblioteca,
}: {
  ejercicio: Ejercicio
  alEditar: () => void
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
        mensaje: actualizado.archivado ? 'Ejercicio archivado' : 'Ejercicio recuperado',
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
    <div className={estilos.acciones}>
      <Boton variante="secundario" icono={<Pencil aria-hidden size={18} />} onClick={alEditar}>
        Editar
      </Boton>
      <Boton
        variante="secundario"
        icono={<Copy aria-hidden size={18} />}
        cargando={duplicar.isPending}
        onClick={() => duplicar.mutate()}
      >
        Duplicar
      </Boton>
      <Boton
        variante="secundario"
        icono={
          e.archivado ? <ArchiveRestore aria-hidden size={18} /> : <Archive aria-hidden size={18} />
        }
        cargando={archivar.isPending}
        onClick={() => archivar.mutate()}
      >
        {e.archivado ? 'Recuperar' : 'Archivar'}
      </Boton>
      {e.usos === 0 && (
        <Boton
          variante="peligro"
          icono={<Trash2 aria-hidden size={18} />}
          cargando={borrar.isPending}
          onClick={async () => {
            const si = await confirmar({
              titulo: `¿Borrar «${e.nombre}»?`,
              mensaje: 'Se borran también sus fotos y vídeos. No se puede deshacer.',
              textoConfirmar: 'Borrar ejercicio',
              peligrosa: true,
            })
            if (si) borrar.mutate()
          }}
        >
          Borrar
        </Boton>
      )}
    </div>
  )
}
