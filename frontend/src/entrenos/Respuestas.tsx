import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, CircleHelp, Share2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api, datos, enviar } from '../api/cliente'
import type { components } from '../api/esquema'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { HojaInferior } from '../componentes/HojaInferior'
import { MensajeCompartible } from '../componentes/MensajeCompartible'
import { nombreCompleto, nombresCortos } from '../jugadores/datos'
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

// La respuesta de cada jugador, vista por el cuerpo técnico
const TEXTOS_CUERPO_TECNICO: Record<Respuesta, string> = {
  voy: 'Va',
  duda: 'Duda',
  no_voy: 'No va',
}

// Tres botones: tocar la elegida la quita. El jugador ve la suya con icono y texto; el cuerpo técnico,
// en pastillas solo de texto («Va / Duda / No va»), para no confundirlas con pasar lista (GH-260)
function ControlRespuesta({
  valor,
  etiqueta,
  deshabilitado,
  pastillas = false,
  alElegir,
}: {
  valor: Respuesta | null
  etiqueta: string
  deshabilitado?: boolean
  pastillas?: boolean
  alElegir: (nueva: Respuesta | null) => void
}) {
  return (
    <fieldset
      className={pastillas ? `${estilos.respuestas} ${estilos.pastillas}` : estilos.respuestas}
      disabled={deshabilitado}
    >
      <legend className="solo-lectores">{etiqueta}</legend>
      {RESPUESTAS.map(({ valor: v, texto, icono: Icono, clase }) => (
        <button
          key={v}
          type="button"
          className={clase}
          aria-pressed={valor === v}
          onClick={() => alElegir(valor === v ? null : v)}
        >
          {pastillas ? (
            TEXTOS_CUERPO_TECNICO[v]
          ) : (
            <>
              <Icono aria-hidden size={16} />
              {texto}
            </>
          )}
        </button>
      ))}
    </fieldset>
  )
}

// Rol jugador: su respuesta a un próximo entreno, mientras esté abierto
// Con «Duda» o «No voy» puede indicar el motivo (GH-211): se guarda al salir del campo o con Intro, y
// se conserva al cambiar entre las dos
export function MiRespuesta({ entreno }: { entreno: EntrenoListado }) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const [motivo, setMotivo] = useState(entreno.miMotivo ?? '')
  const ruta = { params: { path: { id: plantilla.id, eid: entreno.id } } }

  // Si cambia lo guardado (otra pestaña, el cuerpo técnico), el campo lo sigue
  useEffect(() => setMotivo(entreno.miMotivo ?? ''), [entreno.miMotivo])

  const cambiar = useMutation({
    mutationFn: ({ respuesta, motivo }: { respuesta: Respuesta | null; motivo: string | null }) =>
      respuesta
        ? enviar(
            api.PUT('/api/plantillas/{id}/entrenos/{eid}/respuesta', {
              ...ruta,
              body: { respuesta, motivo: respuesta === 'voy' ? null : motivo },
            }),
          )
        : enviar(api.DELETE('/api/plantillas/{id}/entrenos/{eid}/respuesta', ruta)),
    onSuccess: () => cliente.invalidateQueries({ queryKey: CLAVE_ENTRENOS }),
    onError: (error) => avisar({ tipo: 'error', mensaje: error.message }),
  })
  const valor = cambiar.isPending ? (cambiar.variables?.respuesta ?? null) : entreno.miRespuesta
  const conMotivo = valor === 'duda' || valor === 'no_voy'

  function guardarMotivo() {
    const limpio = motivo.trim() || null
    if (!conMotivo || limpio === (entreno.miMotivo ?? null)) return
    cambiar.mutate({ respuesta: valor, motivo: limpio })
  }

  if (!entreno.respuestasAbiertas) {
    const elegida = RESPUESTAS.find((r) => r.valor === entreno.miRespuesta)
    return (
      <p className={estilos.cierre}>
        {elegida
          ? `Respondiste «${elegida.texto}»${entreno.miMotivo ? `: ${entreno.miMotivo}` : ''}. `
          : ''}
        Respuestas cerradas
      </p>
    )
  }
  return (
    <div className={estilos.miRespuesta}>
      <ControlRespuesta
        valor={valor}
        etiqueta="¿Vas a este entreno?"
        deshabilitado={cambiar.isPending}
        alElegir={(nueva) =>
          cambiar.mutate({
            respuesta: nueva,
            motivo: nueva === 'voy' ? null : motivo.trim() || null,
          })
        }
      />
      {conMotivo && (
        <input
          className={estilos.motivoMio}
          aria-label="Motivo (opcional)"
          placeholder="Motivo (opcional)"
          maxLength={200}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          onBlur={guardarMotivo}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
        />
      )}
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

// Solo lo que no es cero: «1 no va · 31 sin responder»
function resumenRespuestas(r: EntrenoListado['respuestas']) {
  const partes = [
    r.voy && `${r.voy} ${r.voy === 1 ? 'va' : 'van'}`,
    r.duda && `${r.duda} ${r.duda === 1 ? 'duda' : 'dudan'}`,
    r.noVoy && `${r.noVoy} no ${r.noVoy === 1 ? 'va' : 'van'}`,
    r.sinResponder && `${r.sinResponder} sin responder`,
  ].filter(Boolean)
  return partes.length ? partes.join(' · ') : 'Sin respuestas'
}

// Entreno de hoy aún sin lista (GH-215): encima de la lista, una línea plegada con el resumen; al
// abrirla, el recuento completo y el resumen para WhatsApp (GH-258)
export function RespuestasDeHoy({ entreno }: { entreno: EntrenoListado }) {
  return (
    <section aria-label="Respuestas" className={estilos.filaRespuestasHoy}>
      <details className={estilos.respuestasHoy}>
        <summary>
          <strong>¿Quién va?</strong> {resumenRespuestas(entreno.respuestas)}
        </summary>
        <p>
          <RecuentoRespuestas respuestas={entreno.respuestas} />
        </p>
      </details>
      <CompartirRespuestas entreno={entreno} />
    </section>
  )
}

// Compartir quién va con el grupo del equipo: siempre en la cabecera de «¿Quién va?», como acción, y el
// mensaje en una hoja con copiar y compartir
export function CompartirRespuestas({ entreno }: { entreno: EntrenoListado }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton
        variante="secundario"
        className={estilos.botonCompartir}
        icono={<Share2 aria-hidden size={18} />}
        aria-label="Resumen para WhatsApp"
        title="Resumen para WhatsApp"
        onClick={() => setAbierta(true)}
      />
      <HojaInferior
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Resumen para WhatsApp"
      >
        {abierta && <MensajeRespuestas entreno={entreno} />}
      </HojaInferior>
    </>
  )
}

function MensajeRespuestas({ entreno }: { entreno: EntrenoListado }) {
  const plantilla = usePlantillaActiva()
  const mensaje = useMensajeRespuestas(plantilla.id, entreno.id)
  if (mensaje.isPending) return <Cargando />
  if (mensaje.isError)
    return (
      <p className={estilos.error} role="alert">
        {mensaje.error.message}
      </p>
    )
  return <MensajeCompartible {...mensaje.data} />
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
  // Nombre y primer apellido, como al pasar lista (GH-257); la leyenda de cada fila lleva el completo
  const nombres = nombresCortos(jugadores)

  return (
    <section aria-label="Respuestas" className={estilos.seccionRespuestas}>
      <div className={estilos.cabeceraRespuestas}>
        <h2>¿Quién va?</h2>
        <CompartirRespuestas entreno={entreno} />
      </div>
      <p className={estilos.cierre}>{textoPlazo(entreno.cierreRespuestas)}</p>
      <PastillasRecuento respuestas={entreno.respuestas} />
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
                  {nombres.get(j.jugadorId)}
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
                  pastillas
                  deshabilitado={apuntar.isPending}
                  alElegir={(respuesta) => apuntar.mutate({ jugadorId: j.jugadorId, respuesta })}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// «Pueden responder hasta el martes a las 20:00», o que ya se cerró
const textoPlazo = (cierre: string) =>
  new Date(cierre).getTime() > Date.now()
    ? `Pueden responder ${textoCierre(cierre)}`
    : 'Ya no se puede responder: el plazo se ha cerrado'

// El recuento en pastillas, cada una con el color de su respuesta (GH-260)
function PastillasRecuento({ respuestas: r }: { respuestas: EntrenoListado['respuestas'] }) {
  const pastillas = [
    { clase: estilos.asiste, texto: `${r.voy} ${r.voy === 1 ? 'va' : 'van'}` },
    { clase: estilos.justificada, texto: `${r.duda} ${r.duda === 1 ? 'duda' : 'dudan'}` },
    { clase: estilos.falta, texto: `${r.noVoy} no ${r.noVoy === 1 ? 'va' : 'van'}` },
    { clase: '', texto: `${r.sinResponder} sin responder` },
  ]
  return (
    <ul className={estilos.pastillasRecuento} aria-label="Recuento de respuestas">
      {pastillas.map(({ clase, texto }) => (
        <li key={texto} className={`${estilos.pastilla} ${clase}`}>
          {texto}
        </li>
      ))}
    </ul>
  )
}
