import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardList, FileText, Image, Pencil, Trash2, Upload } from 'lucide-react'
import { type FormEvent, useRef, useState } from 'react'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { subirConProgreso, textoMb, useLimites } from '../ejercicios/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido } from './datos'
import estilos from './Partidos.module.css'

// Planificación del partido (GH-147): PDF o fotos con la charla, el plan táctico, el rival… Solo los
// ve el cuerpo técnico; el rol jugador no ve la sección. Se abren en otra pestaña

export type ArchivoPartido = components['schemas']['ArchivoPartido']

export const MAXIMO_ARCHIVOS = 10
const TIPOS_ADMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

const claveArchivos = (plantillaId: string, partidoId: string) => [
  ...CLAVE_PARTIDOS,
  plantillaId,
  'archivos',
  partidoId,
]

const urlArchivos = (plantillaId: string, partidoId: string) =>
  `/api/plantillas/${plantillaId}/partidos/${partidoId}/archivos`

// «230 KB» o «2,4 MB»
export const textoTamano = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`

export function SeccionPlanificacion({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  // undefined: hoja cerrada; null: subir uno nuevo
  const [editando, setEditando] = useState<ArchivoPartido | null | undefined>(undefined)
  const archivos = useQuery({
    queryKey: claveArchivos(plantilla.id, partido.id),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos/{pid}/archivos', {
          params: { path: { id: plantilla.id, pid: partido.id } },
        }),
      ),
    enabled: gestiona,
  })
  if (!gestiona) return null
  const lleno = (archivos.data?.length ?? 0) >= MAXIMO_ARCHIVOS

  return (
    <section className={estilos.seccion} aria-labelledby="planificacion">
      <h2 id="planificacion">
        <ClipboardList aria-hidden size={20} />
        Planificación
      </h2>
      {archivos.isPending ? (
        <p className={estilos.secundario}>Cargando archivos…</p>
      ) : archivos.isError ? (
        <p className={estilos.secundario}>No se han podido cargar los archivos.</p>
      ) : archivos.data.length === 0 ? (
        <p className={estilos.secundario}>
          Sube la charla, el plan táctico o el análisis del rival (PDF o foto). Solo los ve el
          cuerpo técnico.
        </p>
      ) : (
        <ul className={estilos.lineaTiempo} aria-label="Archivos de planificación">
          {archivos.data.map((a) => (
            <FilaArchivo key={a.id} partido={partido} archivo={a} alEditar={() => setEditando(a)} />
          ))}
        </ul>
      )}
      <div className={estilos.acciones}>
        {lleno ? (
          <p className={estilos.secundario}>
            Como mucho {MAXIMO_ARCHIVOS} archivos: quita alguno para subir otro.
          </p>
        ) : (
          <Boton
            variante="secundario"
            icono={<Upload aria-hidden size={18} />}
            onClick={() => setEditando(null)}
          >
            Subir archivo
          </Boton>
        )}
      </div>
      <HojaInferior
        abierta={editando !== undefined}
        alCerrar={() => setEditando(undefined)}
        titulo={editando ? 'Cambiar título' : 'Subir archivo'}
      >
        {editando === null && (
          <FormularioSubida partido={partido} alCerrar={() => setEditando(undefined)} />
        )}
        {editando && (
          <FormularioTitulo
            partido={partido}
            archivo={editando}
            alCerrar={() => setEditando(undefined)}
          />
        )}
      </HojaInferior>
    </section>
  )
}

function useGuardarArchivos(partido: Partido) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  return async (peticion: Promise<ArchivoPartido[]>) => {
    const archivos = await peticion
    cliente.setQueryData(claveArchivos(plantilla.id, partido.id), archivos)
    return archivos
  }
}

function FilaArchivo({
  partido,
  archivo,
  alEditar,
}: {
  partido: Partido
  archivo: ArchivoPartido
  alEditar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const guardar = useGuardarArchivos(partido)
  const texto = archivo.titulo ?? archivo.nombreOriginal
  const Icono = archivo.tipo === 'pdf' ? FileText : Image

  const quitar = useMutation({
    mutationFn: () =>
      guardar(
        datos(
          api.DELETE('/api/plantillas/{id}/partidos/{pid}/archivos/{aid}', {
            params: { path: { id: plantilla.id, pid: partido.id, aid: archivo.id } },
          }),
        ),
      ),
    onSuccess: () => avisar({ tipo: 'exito', mensaje: 'Archivo quitado' }),
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido quitar',
      }),
  })

  return (
    <li className={estilos.evento}>
      <Icono
        role="img"
        aria-label={archivo.tipo === 'pdf' ? 'PDF' : 'Imagen'}
        size={18}
        className={estilos.iconoEvento}
      />
      <span className={estilos.textoArchivo}>
        <a
          href={`${urlArchivos(plantilla.id, partido.id)}/${archivo.id}`}
          target="_blank"
          rel="noreferrer"
          aria-label={`${texto} (se abre en otra pestaña)`}
        >
          {texto}
        </a>
        <span className={estilos.autorNota}>
          {[archivo.titulo && archivo.nombreOriginal, textoTamano(archivo.tamanoBytes)]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </span>
      <button
        type="button"
        className={estilos.borrarEvento}
        aria-label={`Cambiar el título: ${texto}`}
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
            titulo: '¿Quitar este archivo?',
            mensaje: `Se borra «${texto}» del partido.`,
            textoConfirmar: 'Quitar',
            peligrosa: true,
          })
          if (si) quitar.mutate()
        }}
      >
        <Trash2 aria-hidden size={18} />
      </button>
    </li>
  )
}

// Lo que el servidor va a rechazar, antes de subir nada
function problemaDe(archivo: File, maximo: number | undefined) {
  if (/hei[cf]$/i.test(archivo.type) || /\.hei[cf]$/i.test(archivo.name)) {
    return 'Las fotos HEIC no se admiten: elígela desde la galería del navegador o expórtala como JPEG'
  }
  if (archivo.type && !TIPOS_ADMITIDOS.includes(archivo.type)) {
    return 'Solo se admiten PDF o fotos JPEG, PNG o WebP'
  }
  if (maximo && archivo.size > maximo) {
    return `Pesa ${textoMb(archivo.size)} y el máximo es ${textoMb(maximo)}`
  }
  return null
}

function FormularioSubida({ partido, alCerrar }: { partido: Partido; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useGuardarArchivos(partido)
  const limites = useLimites()
  const entrada = useRef<HTMLInputElement>(null)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [titulo, setTitulo] = useState('')
  const [progreso, setProgreso] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const subir = useMutation({
    mutationFn: (elegido: File) => {
      const { promesa } = subirConProgreso<ArchivoPartido[]>(
        urlArchivos(plantilla.id, partido.id),
        elegido,
        setProgreso,
        titulo.trim() ? { titulo: titulo.trim() } : {},
      )
      return guardar(promesa)
    },
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: 'Archivo subido' })
    },
    onError: (e) => {
      setProgreso(null)
      setError(e instanceof Error ? e.message : 'No se ha podido subir')
    },
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!archivo) return setError('Elige un PDF o una foto')
    const problema = problemaDe(archivo, limites.data?.maxFotoBytes)
    if (problema) return setError(problema)
    subir.mutate(archivo)
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <div className={estilos.elegirArchivo}>
        <input
          ref={entrada}
          type="file"
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          hidden
          aria-label="Archivo (PDF o foto)"
          onChange={(e) => {
            const elegido = e.target.files?.[0] ?? null
            e.target.value = ''
            setError(null)
            setArchivo(elegido)
          }}
        />
        <Boton
          variante="secundario"
          icono={<Upload aria-hidden size={18} />}
          onClick={() => entrada.current?.click()}
        >
          {archivo ? 'Elegir otro' : 'Elegir PDF o foto'}
        </Boton>
        {archivo && (
          <span className={estilos.secundario}>
            {archivo.name} · {textoTamano(archivo.size)}
          </span>
        )}
      </div>
      <Campo
        etiqueta="Título"
        autoComplete="off"
        maxLength={80}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        ayuda="Opcional: «Charla», «Plan táctico», «Rival»…"
      />
      {progreso !== null && subir.isPending && (
        <progress className={estilos.progreso} value={progreso} max={1} aria-label="Subiendo" />
      )}
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={subir.isPending}>
          Subir
        </Boton>
      </div>
    </form>
  )
}

function FormularioTitulo({
  partido,
  archivo,
  alCerrar,
}: {
  partido: Partido
  archivo: ArchivoPartido
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useGuardarArchivos(partido)
  const [titulo, setTitulo] = useState(archivo.titulo ?? '')
  const [error, setError] = useState<string | null>(null)

  const cambiar = useMutation({
    mutationFn: () =>
      guardar(
        datos(
          api.PATCH('/api/plantillas/{id}/partidos/{pid}/archivos/{aid}', {
            params: { path: { id: plantilla.id, pid: partido.id, aid: archivo.id } },
            body: { titulo: titulo.trim() || null },
          }),
        ),
      ),
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: 'Título cambiado' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar'),
  })

  return (
    <form
      className={estilos.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        cambiar.mutate()
      }}
      noValidate
    >
      <p className={estilos.secundario}>{archivo.nombreOriginal}</p>
      <Campo
        etiqueta="Título"
        autoComplete="off"
        maxLength={80}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        ayuda="Vacío: se ve el nombre del archivo"
        error={error ?? undefined}
      />
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
