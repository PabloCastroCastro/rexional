import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bandage, Pencil } from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { api, datos, erroresPorCampo } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { CLAVE_ENTRENOS, hoy, sumarDias } from '../entrenos/datos'
import { CLAVE_PARTIDOS } from '../partidos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_JUGADORES } from './datos'
import estilos from './Lesiones.module.css'

// Lesiones de los jugadores (GH-230): la franja de la ficha, marcar, corregir, dar el alta y borrar,
// el historial y los textos que se usan en la plantilla, la convocatoria y pasar lista.

export type Lesion = components['schemas']['Lesion']
export type LesionActual = components['schemas']['LesionActual']
type Lesiones = components['schemas']['LesionesJugador']

const claveLesiones = (plantillaId: string, jugadorId: string) =>
  [...CLAVE_JUGADORES, plantillaId, jugadorId, 'lesiones'] as const

// activa: solo el cuerpo técnico o el propio jugador pueden verlas
export const useLesiones = (plantillaId: string, jugadorId: string, activa = true) =>
  useQuery({
    enabled: activa,
    queryKey: claveLesiones(plantillaId, jugadorId),
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/jugadores/{jid}/lesiones', {
          params: { path: { id: plantillaId, jid: jugadorId } },
        }),
      ),
  })

const formatoDia = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

// «3 nov»
export const diaCorto = (fecha: string) =>
  formatoDia.format(new Date(`${fecha}T12:00:00Z`)).replace('.', '')

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T12:00:00Z`) - Date.parse(`${desde}T12:00:00Z`)) / 86_400_000)

// Cuándo vuelve, contado desde hoy: «vuelve mañana», «vuelve en 5 días», «vuelve en 2 semanas»,
// «sin fecha de vuelta» o, si ya pasó, «debía volver el 10 nov»
export function textoVuelta(vueltaPrevista: string | null, hoyEs = hoy()) {
  if (!vueltaPrevista) return 'sin fecha de vuelta'
  const dias = diasEntre(hoyEs, vueltaPrevista)
  if (dias < 0) return `debía volver el ${diaCorto(vueltaPrevista)}`
  if (dias === 0) return 'vuelve hoy'
  if (dias === 1) return 'vuelve mañana'
  if (dias < 14) return `vuelve en ${dias} días`
  return `vuelve en ${Math.round(dias / 7)} semanas`
}

// «Lesionado · vuelve en 2 semanas», para la convocatoria y pasar lista
export const textoLesion = (lesion: NonNullable<LesionActual>, hoyEs = hoy()) =>
  `Lesionado · ${textoVuelta(lesion.vueltaPrevista, hoyEs)}`

// Marca pequeña de lesionado, para las listas; con la lesión, también cuándo vuelve
export function MarcaLesion({ lesion }: { lesion?: NonNullable<LesionActual> }) {
  return (
    <span className={estilos.marca}>
      <Bandage aria-hidden size={14} />
      {lesion ? textoLesion(lesion) : 'Lesionado'}
    </span>
  )
}

// Guarda un cambio y refresca todo lo que enseña lesiones: la ficha, las listas de la plantilla, las
// convocatorias y las listas de los entrenos
function useGuardarLesion(jugadorId: string) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  return async (peticion: Promise<Lesiones>) => {
    const lesiones = await peticion
    cliente.setQueryData(claveLesiones(plantilla.id, jugadorId), lesiones)
    await Promise.all(
      [CLAVE_JUGADORES, CLAVE_PARTIDOS, CLAVE_ENTRENOS].map((queryKey) =>
        cliente.invalidateQueries({ queryKey }),
      ),
    )
    return lesiones
  }
}

type Edicion =
  | { tipo: 'nueva' }
  | { tipo: 'editar'; lesion: Lesion }
  | { tipo: 'alta'; lesion: Lesion }

// La franja de la lesión en curso, bajo el nombre en la ficha. El cuerpo técnico la corrige o da el
// alta desde aquí; el jugador solo la ve
export function FranjaLesion({
  lesion,
  gestiona,
  alEditar,
}: {
  lesion: Lesion
  gestiona: boolean
  alEditar: (edicion: Edicion) => void
}) {
  const vencida = lesion.vueltaPrevista !== null && lesion.vueltaPrevista < hoy()
  return (
    <section className={estilos.franja} aria-label="Lesión" data-vencida={vencida || undefined}>
      <Bandage aria-hidden size={20} className={estilos.icono} />
      <div className={estilos.texto}>
        <strong>Lesionado desde el {diaCorto(lesion.desde)}</strong>
        <span>{mayuscula(textoVuelta(lesion.vueltaPrevista))}</span>
        {lesion.nota && <span className={estilos.nota}>{lesion.nota}</span>}
      </div>
      {gestiona && (
        <div className={estilos.acciones}>
          <Boton
            variante="secundario"
            className={estilos.botonIcono}
            icono={<Pencil aria-hidden size={16} />}
            aria-label="Corregir la lesión"
            title="Corregir la lesión"
            onClick={() => alEditar({ tipo: 'editar', lesion })}
          />
          <Boton variante="secundario" onClick={() => alEditar({ tipo: 'alta', lesion })}>
            Dar el alta
          </Boton>
        </div>
      )}
    </section>
  )
}

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// Las lesiones anteriores, solo para el cuerpo técnico y solo si hay alguna
export function HistorialLesiones({ historial }: { historial: Lesion[] }) {
  if (historial.length === 0) return null
  return (
    <section className={estilos.historial} aria-labelledby="lesiones">
      <h2 id="lesiones">Lesiones</h2>
      <ul>
        {historial.map((l) => (
          <li key={l.id}>
            <span className={estilos.fechas}>
              {diaCorto(l.desde)} – {l.alta && diaCorto(l.alta)}
            </span>
            <span className={estilos.duracion}>
              {duracion(l.desde, l.alta ?? l.desde)}
              {l.nota && ` · ${l.nota}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

// «12 días», «3 semanas»
function duracion(desde: string, alta: string) {
  const dias = diasEntre(desde, alta)
  if (dias < 14) return `${dias} ${dias === 1 ? 'día' : 'días'}`
  return `${Math.round(dias / 7)} semanas`
}

// La hoja para marcar, corregir o dar el alta
export function HojaLesion({
  jugadorId,
  nombre,
  edicion,
  alCerrar,
}: {
  jugadorId: string
  nombre: string
  edicion: Edicion | null
  alCerrar: () => void
}) {
  const titulo =
    edicion?.tipo === 'alta'
      ? `Dar el alta a ${nombre}`
      : edicion?.tipo === 'editar'
        ? 'Corregir la lesión'
        : `Marcar lesión de ${nombre}`
  return (
    <HojaInferior abierta={edicion !== null} alCerrar={alCerrar} titulo={titulo}>
      {edicion?.tipo === 'alta' && (
        <FormularioAlta jugadorId={jugadorId} lesion={edicion.lesion} alCerrar={alCerrar} />
      )}
      {(edicion?.tipo === 'nueva' || edicion?.tipo === 'editar') && (
        <FormularioLesion
          jugadorId={jugadorId}
          lesion={edicion.tipo === 'editar' ? edicion.lesion : null}
          alCerrar={alCerrar}
        />
      )}
    </HojaInferior>
  )
}

function FormularioLesion({
  jugadorId,
  lesion,
  alCerrar,
}: {
  jugadorId: string
  lesion: Lesion | null
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const guardar = useGuardarLesion(jugadorId)
  const [desde, setDesde] = useState(lesion?.desde ?? hoy())
  const [vuelta, setVuelta] = useState(lesion?.vueltaPrevista ?? '')
  const [nota, setNota] = useState(lesion?.nota ?? '')
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const ruta = { id: plantilla.id, jid: jugadorId }

  const enviar = useMutation({
    mutationFn: () => {
      const cuerpo = {
        desde,
        vueltaPrevista: vuelta || null,
        nota: nota.trim() || null,
      }
      return guardar(
        datos(
          lesion
            ? api.PATCH('/api/plantillas/{id}/jugadores/{jid}/lesiones/{lid}', {
                params: { path: { ...ruta, lid: lesion.id } },
                body: cuerpo,
              })
            : api.POST('/api/plantillas/{id}/jugadores/{jid}/lesiones', {
                params: { path: ruta },
                body: cuerpo,
              }),
        ),
      )
    },
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: lesion ? 'Lesión corregida' : 'Lesión registrada' })
    },
    onError: (e) => {
      setErrores(erroresPorCampo(e))
      setError(e instanceof Error ? e.message : 'No se ha podido guardar')
    },
  })

  const borrar = useMutation({
    mutationFn: (id: string) =>
      guardar(
        datos(
          api.DELETE('/api/plantillas/{id}/jugadores/{jid}/lesiones/{lid}', {
            params: { path: { ...ruta, lid: id } },
          }),
        ),
      ),
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: 'Lesión borrada' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido borrar'),
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    setError(null)
    if (!desde) return setErrores({ desde: 'Indica desde cuándo' })
    if (desde > hoy()) return setErrores({ desde: 'La lesión no puede empezar después de hoy' })
    if (vuelta && vuelta < desde) {
      return setErrores({ vueltaPrevista: 'La vuelta prevista no puede ser antes del inicio' })
    }
    enviar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <Campo
        etiqueta="Desde"
        type="date"
        required
        max={hoy()}
        value={desde}
        onChange={(e) => setDesde(e.target.value)}
        error={errores.desde}
      />
      <Campo
        etiqueta="Vuelta prevista (opcional)"
        type="date"
        min={desde || undefined}
        value={vuelta}
        onChange={(e) => setVuelta(e.target.value)}
        error={errores.vueltaPrevista}
        ayuda={`Por ejemplo, en dos semanas: ${diaCorto(sumarDias(hoy(), 14))}`}
      />
      <Campo
        etiqueta="Nota (opcional)"
        maxLength={140}
        value={nota}
        onChange={(e) => setNota(e.target.value)}
        error={errores.nota}
        ayuda="Solo la ve el cuerpo técnico. Sin diagnósticos: es un dato de salud."
      />
      {error && Object.keys(errores).length === 0 && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.pie}>
        {lesion && (
          <Boton
            variante="texto"
            className={estilos.textoPeligro}
            cargando={borrar.isPending}
            onClick={async () => {
              const confirmado = await confirmar({
                titulo: '¿Borrar esta lesión?',
                mensaje:
                  'Solo si se registró por error. Para cerrarla y que quede en el historial, dale el alta.',
                textoConfirmar: 'Borrar lesión',
                peligrosa: true,
              })
              if (confirmado) borrar.mutate(lesion.id)
            }}
          >
            Borrar
          </Boton>
        )}
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviar.isPending}>
          {lesion ? 'Guardar' : 'Marcar lesión'}
        </Boton>
      </div>
    </form>
  )
}

function FormularioAlta({
  jugadorId,
  lesion,
  alCerrar,
}: {
  jugadorId: string
  lesion: Lesion
  alCerrar: () => void
}) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useGuardarLesion(jugadorId)
  const [alta, setAlta] = useState(hoy())
  const [errores, setErrores] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const enviar = useMutation({
    mutationFn: () =>
      guardar(
        datos(
          api.PATCH('/api/plantillas/{id}/jugadores/{jid}/lesiones/{lid}', {
            params: { path: { id: plantilla.id, jid: jugadorId, lid: lesion.id } },
            body: { alta },
          }),
        ),
      ),
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: 'Alta registrada' })
    },
    onError: (e) => {
      setErrores(erroresPorCampo(e))
      setError(e instanceof Error ? e.message : 'No se ha podido guardar')
    },
  })

  function alEnviar(e: FormEvent) {
    e.preventDefault()
    setErrores({})
    setError(null)
    if (!alta) return setErrores({ alta: 'Indica el día del alta' })
    if (alta < lesion.desde) {
      return setErrores({ alta: 'El alta no puede ser antes del inicio de la lesión' })
    }
    if (alta > hoy()) return setErrores({ alta: 'El alta no puede ser después de hoy' })
    enviar.mutate()
  }

  return (
    <form className={estilos.formulario} onSubmit={alEnviar} noValidate>
      <Campo
        etiqueta="Recuperado el"
        type="date"
        required
        min={lesion.desde}
        max={hoy()}
        value={alta}
        onChange={(e) => setAlta(e.target.value)}
        error={errores.alta}
        ayuda="Desde ese día ya cuenta como disponible. La lesión queda en el historial."
      />
      {error && Object.keys(errores).length === 0 && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.pie}>
        <Boton variante="secundario" onClick={alCerrar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviar.isPending}>
          Dar el alta
        </Boton>
      </div>
    </form>
  )
}

export type { Edicion as EdicionLesion }
