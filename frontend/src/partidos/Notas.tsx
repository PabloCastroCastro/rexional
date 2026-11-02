import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { NotebookPen, Pencil, StickyNote, Trash2, TriangleAlert, Waypoints } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { hoy } from '../entrenos/datos'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido } from './datos'
import estilos from './Partidos.module.css'

// Notas del cuerpo técnico durante el partido (GH-149): tácticas, incidencias u otras, con minuto
// opcional. Solo las ve el cuerpo técnico; el rol jugador no ve la sección

type Nota = components['schemas']['NotaPartido']
type TipoNota = Nota['tipo']

const TIPOS: { tipo: TipoNota; texto: string; Icono: typeof StickyNote }[] = [
  { tipo: 'tactica', texto: 'Táctica', Icono: Waypoints },
  { tipo: 'incidencia', texto: 'Incidencia', Icono: TriangleAlert },
  { tipo: 'otra', texto: 'Otra', Icono: StickyNote },
]

const DESCANSO = 15

// Minuto de juego según la hora de inicio, solo el día del partido: el descanso cuenta como 45 y
// después se descuenta. Sin hora, otro día o mucho después del final, sin minuto
export function minutoPropuesto(
  partido: Pick<Partido, 'fecha' | 'hora'>,
  ahora = new Date(),
): number | null {
  if (!partido.hora || partido.fecha !== hoy()) return null
  const [h = 0, m = 0] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(ahora)
    .split(':')
    .map(Number)
  const [hi = 0, mi = 0] = partido.hora.split(':').map(Number)
  const transcurridos = h * 60 + m - (hi * 60 + mi)
  if (transcurridos < 0 || transcurridos > 180) return null
  if (transcurridos <= 45) return transcurridos
  if (transcurridos <= 45 + DESCANSO) return 45
  return Math.min(transcurridos - DESCANSO, 90)
}

const claveNotas = (plantillaId: string, partidoId: string) => [
  ...CLAVE_PARTIDOS,
  plantillaId,
  'notas',
  partidoId,
]

export function SeccionNotas({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  // undefined: hoja cerrada; null: nota nueva
  const [editando, setEditando] = useState<Nota | null | undefined>(undefined)
  const notas = useQuery({
    queryKey: claveNotas(plantilla.id, partido.id),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/partidos/{pid}/notas', {
          params: { path: { id: plantilla.id, pid: partido.id } },
        }),
      ),
    enabled: gestiona,
  })
  if (!gestiona) return null

  return (
    <section className={estilos.seccion} aria-labelledby="notas">
      <h2 id="notas">
        <NotebookPen aria-hidden size={20} />
        Notas
      </h2>
      {notas.isPending ? (
        <p className={estilos.secundario}>Cargando notas…</p>
      ) : notas.isError ? (
        <p className={estilos.secundario}>No se han podido cargar las notas.</p>
      ) : notas.data.length === 0 ? (
        <p className={estilos.secundario}>
          Apunta detalles tácticos o incidencias para repasarlos después. Solo las ve el cuerpo
          técnico.
        </p>
      ) : (
        <ol className={estilos.lineaTiempo} aria-label="Notas">
          {notas.data.map((n) => (
            <FilaNota key={n.id} partido={partido} nota={n} alEditar={() => setEditando(n)} />
          ))}
        </ol>
      )}
      <div className={estilos.acciones}>
        <Boton
          variante="secundario"
          icono={<NotebookPen aria-hidden size={18} />}
          onClick={() => setEditando(null)}
        >
          Anotar
        </Boton>
      </div>
      <HojaInferior
        abierta={editando !== undefined}
        alCerrar={() => setEditando(undefined)}
        titulo={editando ? 'Cambiar nota' : 'Anotar'}
      >
        {editando !== undefined && (
          <FormularioNota
            partido={partido}
            nota={editando}
            alCerrar={() => setEditando(undefined)}
          />
        )}
      </HojaInferior>
    </section>
  )
}

function useGuardarNotas(partido: Partido) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  return async (peticion: Promise<Nota[]>) => {
    const notas = await peticion
    cliente.setQueryData(claveNotas(plantilla.id, partido.id), notas)
    return notas
  }
}

function FilaNota({
  partido,
  nota,
  alEditar,
}: {
  partido: Partido
  nota: Nota
  alEditar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const guardar = useGuardarNotas(partido)
  const tipo = TIPOS.find((t) => t.tipo === nota.tipo) ?? TIPOS[2]
  const Icono = tipo?.Icono ?? StickyNote

  const borrar = useMutation({
    mutationFn: () =>
      guardar(
        datos(
          api.DELETE('/api/plantillas/{id}/partidos/{pid}/notas/{nid}', {
            params: { path: { id: plantilla.id, pid: partido.id, nid: nota.id } },
          }),
        ),
      ),
    onSuccess: () => avisar({ tipo: 'exito', mensaje: 'Nota borrada' }),
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido borrar',
      }),
  })

  return (
    <li className={estilos.nota} data-tipo={nota.tipo}>
      <span className={estilos.minuto}>{nota.minuto === null ? '–' : `${nota.minuto}'`}</span>
      <Icono aria-label={tipo?.texto} role="img" size={18} className={estilos.iconoEvento} />
      <div className={estilos.textoNota}>
        <p>{nota.texto}</p>
        {nota.autor && <p className={estilos.autorNota}>{nota.autor}</p>}
      </div>
      <button
        type="button"
        className={estilos.borrarEvento}
        aria-label={`Cambiar la nota: ${nota.texto}`}
        onClick={alEditar}
      >
        <Pencil aria-hidden size={18} />
      </button>
      <button
        type="button"
        className={estilos.borrarEvento}
        aria-label={`Borrar la nota: ${nota.texto}`}
        disabled={borrar.isPending}
        onClick={async () => {
          const si = await confirmar({
            titulo: '¿Borrar esta nota?',
            mensaje: `${nota.minuto === null ? '' : `${nota.minuto}' · `}${nota.texto}`,
            textoConfirmar: 'Borrar',
            peligrosa: true,
          })
          if (si) borrar.mutate()
        }}
      >
        <Trash2 aria-hidden size={18} />
      </button>
    </li>
  )
}

function FormularioNota({
  partido,
  nota,
  alCerrar,
}: {
  partido: Partido
  nota: Nota | null
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useGuardarNotas(partido)
  const [tipo, setTipo] = useState<TipoNota>(nota?.tipo ?? 'tactica')
  const [texto, setTexto] = useState(nota?.texto ?? '')
  const [minuto, setMinuto] = useState(() => {
    const m = nota ? nota.minuto : minutoPropuesto(partido)
    return m === null ? '' : String(m)
  })
  const [error, setError] = useState<string | null>(null)

  const enviar = useMutation({
    mutationFn: () => {
      const cuerpo = { tipo, texto: texto.trim(), minuto: minuto === '' ? null : Number(minuto) }
      const path = { id: plantilla.id, pid: partido.id }
      return guardar(
        datos(
          nota
            ? api.PATCH('/api/plantillas/{id}/partidos/{pid}/notas/{nid}', {
                params: { path: { ...path, nid: nota.id } },
                body: cuerpo,
              })
            : api.POST('/api/plantillas/{id}/partidos/{pid}/notas', {
                params: { path },
                body: cuerpo,
              }),
        ),
      )
    },
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: nota ? 'Nota cambiada' : 'Nota guardada' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar'),
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!texto.trim()) return setError('Escribe la nota')
    const m = Number(minuto)
    if (minuto !== '' && (!Number.isInteger(m) || m < 0 || m > 150)) {
      return setError('El minuto va de 0 a 150')
    }
    enviar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <label className={estilos.areaTexto}>
        Nota
        <textarea
          rows={4}
          maxLength={1000}
          // biome-ignore lint/a11y/noAutofocus: la hoja se abre para escribir; durante el partido cada toque cuenta
          autoFocus
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Qué has visto…"
        />
      </label>
      <fieldset className={estilos.tiposEvento}>
        <legend>Tipo</legend>
        {TIPOS.map((t) => (
          <button
            key={t.tipo}
            type="button"
            aria-pressed={tipo === t.tipo}
            onClick={() => setTipo(t.tipo)}
          >
            {t.texto}
          </button>
        ))}
      </fieldset>
      <label className={estilos.campoMinuto}>
        Minuto (opcional)
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={150}
          value={minuto}
          onChange={(e) => setMinuto(e.target.value)}
        />
      </label>
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviar.isPending}>
          Guardar
        </Boton>
      </div>
    </form>
  )
}
