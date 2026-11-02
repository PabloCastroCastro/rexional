import { useMutation } from '@tanstack/react-query'
import { ExternalLink, Pencil, Plus, Trash2, Video } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import type { Partido } from './datos'
import { useCambioPartido } from './Jugado'
import estilos from './Partidos.module.css'

// Enlaces al vídeo del partido (GH-134): el cuerpo técnico los añade, cambia y quita, y cualquier
// miembro los abre fuera de la app. Sin vídeos, un jugador no ve la sección.

type VideoPartido = Partido['videos'][number]

// El título o, si no tiene, el dominio («youtube.com»)
export function textoVideo(v: VideoPartido) {
  if (v.titulo) return v.titulo
  try {
    return new URL(v.url).hostname.replace(/^www\./, '')
  } catch {
    return v.url
  }
}

export function SeccionVideos({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  // undefined: hoja cerrada; null: vídeo nuevo
  const [editando, setEditando] = useState<VideoPartido | null | undefined>(undefined)
  if (partido.videos.length === 0 && !gestiona) return null

  return (
    <section className={estilos.seccion} aria-labelledby="videos">
      <h2 id="videos">
        <Video aria-hidden size={20} />
        Vídeos
      </h2>
      {partido.videos.length === 0 ? (
        <p className={estilos.secundario}>
          Enlaza el vídeo del partido (YouTube, Drive…), por ejemplo uno por cada parte.
        </p>
      ) : (
        <ul className={estilos.lineaTiempo} aria-label="Vídeos">
          {partido.videos.map((v) => (
            <FilaVideo
              key={v.id}
              partido={partido}
              video={v}
              gestiona={gestiona}
              alEditar={() => setEditando(v)}
            />
          ))}
        </ul>
      )}
      {gestiona && (
        <div className={estilos.acciones}>
          <Boton
            variante="secundario"
            icono={<Plus aria-hidden size={18} />}
            onClick={() => setEditando(null)}
          >
            Añadir vídeo
          </Boton>
        </div>
      )}
      <HojaInferior
        abierta={editando !== undefined}
        alCerrar={() => setEditando(undefined)}
        titulo={editando ? 'Cambiar vídeo' : 'Añadir vídeo'}
      >
        {editando !== undefined && (
          <FormularioVideo
            partido={partido}
            video={editando}
            alCerrar={() => setEditando(undefined)}
          />
        )}
      </HojaInferior>
    </section>
  )
}

function FilaVideo({
  partido,
  video,
  gestiona,
  alEditar,
}: {
  partido: Partido
  video: VideoPartido
  gestiona: boolean
  alEditar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const guardar = useCambioPartido(partido)
  const texto = textoVideo(video)

  const quitar = useMutation({
    mutationFn: () =>
      guardar(
        datos(
          api.DELETE('/api/plantillas/{id}/partidos/{pid}/videos/{vid}', {
            params: { path: { id: plantilla.id, pid: partido.id, vid: video.id } },
          }),
        ),
      ),
    onSuccess: () => avisar({ tipo: 'exito', mensaje: 'Vídeo quitado' }),
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido quitar',
      }),
  })

  return (
    <li className={estilos.evento}>
      <ExternalLink aria-hidden size={18} className={estilos.iconoEvento} />
      <a
        className={estilos.textoEvento}
        href={video.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`${texto} (se abre fuera de la app)`}
      >
        {texto}
      </a>
      {gestiona && (
        <>
          <button
            type="button"
            className={estilos.borrarEvento}
            aria-label={`Cambiar: ${texto}`}
            onClick={alEditar}
          >
            <Pencil aria-hidden size={18} />
          </button>
          <button
            type="button"
            className={estilos.borrarEvento}
            aria-label={`Quitar: ${texto}`}
            disabled={quitar.isPending}
            onClick={async () => {
              const si = await confirmar({
                titulo: '¿Quitar este vídeo?',
                mensaje: `Se quita el enlace «${texto}»; el vídeo sigue donde esté.`,
                textoConfirmar: 'Quitar',
                peligrosa: true,
              })
              if (si) quitar.mutate()
            }}
          >
            <Trash2 aria-hidden size={18} />
          </button>
        </>
      )}
    </li>
  )
}

function FormularioVideo({
  partido,
  video,
  alCerrar,
}: {
  partido: Partido
  video: VideoPartido | null
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useCambioPartido(partido)
  const [url, setUrl] = useState(video?.url ?? '')
  const [titulo, setTitulo] = useState(video?.titulo ?? '')
  const [error, setError] = useState<string | null>(null)

  const enviar = useMutation({
    mutationFn: () => {
      const cuerpo = { url: url.trim(), titulo: titulo.trim() || null }
      const params = { path: { id: plantilla.id, pid: partido.id } }
      return guardar(
        datos(
          video
            ? api.PATCH('/api/plantillas/{id}/partidos/{pid}/videos/{vid}', {
                params: { path: { ...params.path, vid: video.id } },
                body: cuerpo,
              })
            : api.POST('/api/plantillas/{id}/partidos/{pid}/videos', { params, body: cuerpo }),
        ),
      )
    },
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: video ? 'Vídeo cambiado' : 'Vídeo añadido' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar'),
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!/^https?:\/\/\S+$/i.test(url.trim())) {
      return setError('Pega la dirección del vídeo (https://…)')
    }
    enviar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <Campo
        etiqueta="Dirección del vídeo"
        required
        type="url"
        inputMode="url"
        autoComplete="off"
        placeholder="https://"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        error={error ?? undefined}
      />
      <Campo
        etiqueta="Título"
        autoComplete="off"
        maxLength={80}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        ayuda="Opcional: «1ª parte», «Resumen»…"
      />
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={enviar.isPending}>
          {video ? 'Guardar' : 'Añadir'}
        </Boton>
      </div>
    </form>
  )
}
