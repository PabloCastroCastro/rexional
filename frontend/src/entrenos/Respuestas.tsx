import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleHelp, X } from 'lucide-react'
import { api, datos, enviar } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { MensajeCompartible } from '../componentes/MensajeCompartible'
import { nombreCompleto } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_ENTRENOS, type Entreno, type EntrenoListado, useEntreno } from './datos'
import estilos from './Entrenos.module.css'

// Respuestas a si van a los próximos entrenos (GH-204): la intención de ir, aparte de pasar lista

export type Respuesta = components['schemas']['RespuestaEntreno']['respuesta']

export const RESPUESTAS: { valor: Respuesta; texto: string; icono: typeof Check; clase: string }[] =
  [
    { valor: 'voy', texto: 'Voy', icono: Check, clase: estilos.asiste ?? '' },
    { valor: 'duda', texto: 'Duda', icono: CircleHelp, clase: estilos.justificada ?? '' },
    { valor: 'no_voy', texto: 'No voy', icono: X, clase: estilos.falta ?? '' },
  ]

const PISTAS: Record<Respuesta, string> = {
  voy: 'Dijo que iba',
  duda: 'Estaba en duda',
  no_voy: 'Dijo que no iba',
}

const formatoCierre = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Madrid',
})

// "Puedes cambiarla hasta el martes a las 18:00"
const textoCierre = (cierre: string) => {
  const [dia, hora] = formatoCierre.format(new Date(cierre)).split(', ')
  return `hasta el ${dia} a las ${hora}`
}

// Tres botones: tocar la elegida la quita. Compactos, solo con el icono (en la lista del cuerpo técnico)
function ControlRespuesta({
  valor,
  etiqueta,
  deshabilitado,
  compacto = false,
  alElegir,
}: {
  valor: Respuesta | null
  etiqueta: string
  deshabilitado?: boolean
  compacto?: boolean
  alElegir: (nueva: Respuesta | null) => void
}) {
  return (
    <fieldset
      className={compacto ? `${estilos.respuestas} ${estilos.compacto}` : estilos.respuestas}
      disabled={deshabilitado}
    >
      <legend className="solo-lectores">{etiqueta}</legend>
      {RESPUESTAS.map(({ valor: v, texto, icono: Icono, clase }) => (
        <button
          key={v}
          type="button"
          className={clase}
          aria-pressed={valor === v}
          aria-label={compacto ? texto : undefined}
          title={compacto ? texto : undefined}
          onClick={() => alElegir(valor === v ? null : v)}
        >
          <Icono aria-hidden size={compacto ? 20 : 16} />
          {!compacto && texto}
        </button>
      ))}
    </fieldset>
  )
}

// Rol jugador: su respuesta a un próximo entreno, mientras esté abierto
export function MiRespuesta({ entreno }: { entreno: EntrenoListado }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const ruta = { params: { path: { id: plantilla.id, eid: entreno.id } } }
  const cambiar = useMutation({
    mutationFn: (respuesta: Respuesta | null) =>
      respuesta
        ? enviar(
            api.PUT('/api/plantillas/{id}/entrenos/{eid}/respuesta', {
              ...ruta,
              body: { respuesta },
            }),
          )
        : enviar(api.DELETE('/api/plantillas/{id}/entrenos/{eid}/respuesta', ruta)),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS }),
    onError: (error) => avisar({ tipo: 'error', mensaje: error.message }),
  })
  const valor = cambiar.isPending ? (cambiar.variables ?? null) : entreno.miRespuesta

  if (!entreno.respuestasAbiertas) {
    const elegida = RESPUESTAS.find((r) => r.valor === entreno.miRespuesta)
    return (
      <p className={estilos.cierre}>
        {elegida ? `Respondiste «${elegida.texto}». ` : ''}Respuestas cerradas
      </p>
    )
  }
  return (
    <div className={estilos.miRespuesta}>
      <ControlRespuesta
        valor={valor}
        etiqueta="¿Vas a este entreno?"
        deshabilitado={cambiar.isPending}
        alElegir={(nueva) => cambiar.mutate(nueva)}
      />
      <p className={estilos.cierre}>Puedes cambiarla {textoCierre(entreno.cierreRespuestas)}</p>
    </div>
  )
}

// Recuento de un próximo entreno, sin nombres: "3 van · 1 duda · 0 no van · 5 sin responder"
export function RecuentoRespuestas({ respuestas }: { respuestas: EntrenoListado['respuestas'] }) {
  return (
    <span className={estilos.recuentoRespuestas}>
      {respuestas.voy} {respuestas.voy === 1 ? 'va' : 'van'} · {respuestas.duda}{' '}
      {respuestas.duda === 1 ? 'duda' : 'dudan'} · {respuestas.noVoy} no{' '}
      {respuestas.noVoy === 1 ? 'va' : 'van'} · {respuestas.sinResponder} sin responder
    </span>
  )
}

// Al pasar lista, lo que dijo cada jugador: solo una pista, no rellena nada
export function PistaRespuesta({
  jugador,
}: {
  jugador: Pick<Entreno['jugadores'][number], 'respuesta' | 'motivoRespuesta'>
}) {
  if (!jugador.respuesta) return null
  const { icono: Icono, clase } =
    RESPUESTAS.find((r) => r.valor === jugador.respuesta) ??
    (RESPUESTAS[0] as (typeof RESPUESTAS)[0])
  return (
    <span className={`${estilos.pista} ${clase}`}>
      <Icono aria-hidden size={14} />
      {PISTAS[jugador.respuesta]}
      {jugador.motivoRespuesta ? `: ${jugador.motivoRespuesta}` : ''}
    </span>
  )
}

const useMensajeRespuestas = (plantillaId: string, entrenoId: string) =>
  useQuery({
    queryKey: [...CLAVE_ENTRENOS, plantillaId, entrenoId, 'respuestas', 'mensaje'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/entrenos/{eid}/respuestas/mensaje', {
          params: { path: { id: plantillaId, eid: entrenoId } },
        }),
      ),
  })

// Cuerpo técnico, en un próximo entreno: quién va, apuntar o corregir respuestas y el resumen para
// WhatsApp
export function RespuestasEntreno({ entreno }: { entreno: EntrenoListado }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const detalle = useEntreno(plantilla.id, entreno.id)
  const mensaje = useMensajeRespuestas(plantilla.id, entreno.id)
  const apuntar = useMutation({
    mutationFn: ({ jugadorId, respuesta }: { jugadorId: string; respuesta: Respuesta | null }) => {
      const ruta = { params: { path: { id: plantilla.id, eid: entreno.id, jid: jugadorId } } }
      return respuesta
        ? enviar(
            api.PUT('/api/plantillas/{id}/entrenos/{eid}/respuestas/{jid}', {
              ...ruta,
              body: { respuesta },
            }),
          )
        : enviar(api.DELETE('/api/plantillas/{id}/entrenos/{eid}/respuestas/{jid}', ruta))
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS }),
    onError: (error) => avisar({ tipo: 'error', mensaje: error.message }),
  })

  // Responden los jugadores activos en la dinámica
  const jugadores = detalle.data?.jugadores.filter((j) => j.activo) ?? []

  return (
    <section aria-label="Respuestas" className={estilos.seccionRespuestas}>
      <h2 className={estilos.mes}>¿Quién va?</h2>
      <p>
        <RecuentoRespuestas respuestas={entreno.respuestas} />
      </p>
      {detalle.isPending ? null : detalle.isError ? (
        <p className={estilos.error} role="alert">
          {detalle.error.message}
        </p>
      ) : (
        <ul className={estilos.lista} aria-label="Respuestas de los jugadores">
          {jugadores.map((j) => (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} />
                <span className={estilos.nombre}>
                  {nombreCompleto(j)}
                  {j.motivoRespuesta && (
                    <span className={estilos.motivoRespuesta}>{j.motivoRespuesta}</span>
                  )}
                </span>
                <ControlRespuesta
                  valor={
                    apuntar.isPending && apuntar.variables?.jugadorId === j.jugadorId
                      ? apuntar.variables.respuesta
                      : j.respuesta
                  }
                  etiqueta={`Respuesta de ${nombreCompleto(j)}`}
                  compacto
                  deshabilitado={apuntar.isPending}
                  alElegir={(respuesta) => apuntar.mutate({ jugadorId: j.jugadorId, respuesta })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {mensaje.data && <MensajeCompartible {...mensaje.data} />}
    </section>
  )
}
