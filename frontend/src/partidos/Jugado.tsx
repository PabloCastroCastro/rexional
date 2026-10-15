import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Goal,
  Handshake,
  ListOrdered,
  Minus,
  Plus,
  RectangleVertical,
  Shirt,
  Trash2,
} from 'lucide-react'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'
import { api, datos } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { Boton } from '../componentes/Boton'
import { useConfirmacion } from '../componentes/Confirmacion'
import { HojaInferior } from '../componentes/HojaInferior'
import { Selector } from '../componentes/Selector'
import { hoy } from '../entrenos/datos'
import { nombreCompleto, puedeGestionarJugadores } from '../jugadores/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_PARTIDOS, type Partido, textoResultado } from './datos'
import estilos from './Partidos.module.css'

// El partido jugado: marcador, titulares y suplentes, y la línea de tiempo con el registro rápido
// de goles, cambios y tarjetas. Lo importado del acta se corrige igual que lo registrado a mano.

type Evento = Partido['eventos'][number]
type NuevoEvento = { jugadorId: string | null; tipo: Evento['tipo']; minuto: number | null }

// Guarda un cambio del partido y deja el detalle al día con la respuesta
function useCambioPartido(partido: Partido) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  return async (peticion: Promise<Partido>) => {
    const actualizado = await peticion
    cliente.setQueryData([...CLAVE_PARTIDOS, plantilla.id, 'partido', partido.id], actualizado)
    await cliente.invalidateQueries({ queryKey: CLAVE_PARTIDOS })
    return actualizado
  }
}

const ruta = (plantillaId: string, partidoId: string) => ({
  params: { path: { id: plantillaId, pid: partidoId } },
})

export function SeccionPartido({ partido }: { partido: Partido }) {
  const plantilla = usePlantillaActiva()
  const gestiona = puedeGestionarJugadores(plantilla)
  const [resultado, setResultado] = useState(false)
  const [evento, setEvento] = useState(false)
  const convocados = partido.jugadores.filter((j) => j.convocado)
  const conAlineacion = convocados.some((j) => j.titular !== null)
  // Un partido futuro sin nada registrado aún no tiene esta sección
  if (partido.fecha > hoy() && partido.estado === 'programado' && partido.eventos.length === 0) {
    return null
  }

  return (
    <section className={estilos.seccion} aria-labelledby="partido-jugado">
      <h2 id="partido-jugado">
        <Goal aria-hidden size={20} />
        Partido
      </h2>
      <div className={estilos.marcadorPartido}>
        <span className={estilos.resultadoGrande} data-estado={partido.estado}>
          {partido.estado === 'jugado'
            ? textoResultado(partido)
            : partido.estado === 'aplazado'
              ? 'Aplazado'
              : 'Sin resultado'}
        </span>
        {gestiona && (
          <Boton variante="secundario" onClick={() => setResultado(true)}>
            {partido.estado === 'jugado' ? 'Cambiar resultado' : 'Poner resultado'}
          </Boton>
        )}
      </div>
      {gestiona && convocados.length > 0 && (
        <div className={estilos.acciones}>
          <Link to="alineacion" className={estilos.enlaceSecundario}>
            <Shirt aria-hidden size={18} />
            {conAlineacion ? 'Titulares y suplentes' : 'Indicar titulares'}
          </Link>
          <Boton icono={<Plus aria-hidden size={18} />} onClick={() => setEvento(true)}>
            Añadir
          </Boton>
        </div>
      )}
      <LineaTiempo partido={partido} gestiona={gestiona} />
      <HojaResultado partido={partido} abierta={resultado} alCerrar={() => setResultado(false)} />
      <HojaEvento partido={partido} abierta={evento} alCerrar={() => setEvento(false)} />
    </section>
  )
}

// Texto de un evento con el nombre del jugador
function textoEvento(e: Evento, nombre: (id: string | null) => string) {
  switch (e.tipo) {
    case 'gol':
      return `Gol de ${nombre(e.jugadorId)}`
    case 'asistencia':
      return `Asistencia de ${nombre(e.jugadorId)}`
    case 'amarilla':
      return `Amarilla a ${nombre(e.jugadorId)}`
    case 'roja':
      return `Roja a ${nombre(e.jugadorId)}`
    case 'entra':
      return `Entra ${nombre(e.jugadorId)}`
    case 'sale':
      return `Sale ${nombre(e.jugadorId)}`
    case 'gol_propia':
      return e.jugadorId
        ? `Gol en propia de ${nombre(e.jugadorId)}`
        : 'Gol en propia puerta del rival'
  }
}

const ICONOS: Record<Evento['tipo'], typeof Goal> = {
  gol: Goal,
  asistencia: Handshake,
  amarilla: RectangleVertical,
  roja: RectangleVertical,
  entra: ArrowUpRight,
  sale: ArrowDownLeft,
  gol_propia: Goal,
}

function LineaTiempo({ partido, gestiona }: { partido: Partido; gestiona: boolean }) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()
  const guardar = useCambioPartido(partido)
  const nombres = new Map(partido.jugadores.map((j) => [j.jugadorId, nombreCompleto(j)]))
  const nombre = (id: string | null) => (id ? (nombres.get(id) ?? 'un jugador') : '')

  const borrar = useMutation({
    mutationFn: (e: Evento) =>
      guardar(
        datos(
          api.DELETE('/api/plantillas/{id}/partidos/{pid}/eventos/{evid}', {
            params: { path: { id: plantilla.id, pid: partido.id, evid: e.id } },
          }),
        ),
      ),
    onSuccess: () => avisar({ tipo: 'exito', mensaje: 'Evento borrado' }),
    onError: (error) =>
      avisar({
        tipo: 'error',
        mensaje: error instanceof Error ? error.message : 'No se ha podido borrar',
      }),
  })

  if (partido.eventos.length === 0) {
    return <p className={estilos.secundario}>Todavía no hay goles, cambios ni tarjetas.</p>
  }
  return (
    <ol className={estilos.lineaTiempo} aria-label="Línea de tiempo">
      {partido.eventos.map((e) => {
        const Icono = ICONOS[e.tipo]
        const texto = textoEvento(e, nombre)
        return (
          <li key={e.id} className={estilos.evento} data-tipo={e.tipo}>
            <span className={estilos.minuto}>{e.minuto === null ? '–' : `${e.minuto}'`}</span>
            <Icono aria-hidden size={18} className={estilos.iconoEvento} />
            <span className={estilos.textoEvento}>
              {texto}
              {e.origen === 'acta' && <span className={estilos.etiquetaActa}>acta</span>}
            </span>
            {gestiona && (
              <button
                type="button"
                className={estilos.borrarEvento}
                aria-label={`Borrar: ${texto}`}
                disabled={borrar.isPending}
                onClick={async () => {
                  const si = await confirmar({
                    titulo: '¿Borrar este evento?',
                    mensaje: `${e.minuto === null ? '' : `${e.minuto}' · `}${texto}`,
                    textoConfirmar: 'Borrar',
                    peligrosa: true,
                  })
                  if (si) borrar.mutate(e)
                }}
              >
                <Trash2 aria-hidden size={18} />
              </button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

function Contador({
  etiqueta,
  valor,
  alCambiar,
}: {
  etiqueta: string
  valor: number
  alCambiar: (v: number) => void
}) {
  return (
    <fieldset className={estilos.contadorGoles}>
      <legend>{etiqueta}</legend>
      <button
        type="button"
        aria-label={`Quitar un gol: ${etiqueta}`}
        onClick={() => alCambiar(Math.max(0, valor - 1))}
      >
        <Minus aria-hidden size={20} />
      </button>
      <output aria-live="polite">{valor}</output>
      <button
        type="button"
        aria-label={`Sumar un gol: ${etiqueta}`}
        onClick={() => alCambiar(Math.min(99, valor + 1))}
      >
        <Plus aria-hidden size={20} />
      </button>
    </fieldset>
  )
}

function HojaResultado({
  partido,
  abierta,
  alCerrar,
}: {
  partido: Partido
  abierta: boolean
  alCerrar: () => void
}) {
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Resultado">
      {abierta && <FormularioResultado partido={partido} alCerrar={alCerrar} />}
    </HojaInferior>
  )
}

function FormularioResultado({ partido, alCerrar }: { partido: Partido; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useCambioPartido(partido)
  const [favor, setFavor] = useState(partido.golesFavor ?? 0)
  const [contra, setContra] = useState(partido.golesContra ?? 0)
  const [error, setError] = useState<string | null>(null)

  const cambiar = useMutation({
    mutationFn: (accion: 'guardar' | 'quitar' | 'aplazar' | 'programar') => {
      const r = ruta(plantilla.id, partido.id)
      if (accion === 'guardar') {
        return guardar(
          datos(
            api.PUT('/api/plantillas/{id}/partidos/{pid}/resultado', {
              ...r,
              body: { golesFavor: favor, golesContra: contra },
            }),
          ),
        )
      }
      if (accion === 'quitar') {
        return guardar(datos(api.DELETE('/api/plantillas/{id}/partidos/{pid}/resultado', r)))
      }
      return guardar(
        datos(
          api.PATCH('/api/plantillas/{id}/partidos/{pid}', {
            ...r,
            body: { estado: accion === 'aplazar' ? 'aplazado' : 'programado' },
          }),
        ),
      )
    },
    onSuccess: (p, accion) => {
      alCerrar()
      avisar({
        tipo: 'exito',
        mensaje: {
          guardar: `Resultado guardado: ${textoResultado(p)}`,
          quitar: 'Resultado quitado',
          aplazar: 'Partido aplazado',
          programar: 'El partido vuelve a estar programado',
        }[accion],
      })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido guardar'),
  })

  return (
    <form
      className={estilos.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        cambiar.mutate('guardar')
      }}
    >
      <div className={estilos.contadores}>
        <Contador etiqueta={plantilla.nombre} valor={favor} alCambiar={setFavor} />
        <Contador etiqueta={partido.rival} valor={contra} alCambiar={setContra} />
      </div>
      {error && (
        <p className={estilos.error} role="alert">
          {error}
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton type="submit" cargando={cambiar.isPending && cambiar.variables === 'guardar'}>
          Guardar resultado
        </Boton>
        {partido.estado === 'jugado' && (
          <Boton variante="texto" onClick={() => cambiar.mutate('quitar')}>
            Quitar resultado
          </Boton>
        )}
        {partido.estado === 'aplazado' ? (
          <Boton variante="texto" onClick={() => cambiar.mutate('programar')}>
            Quitar aplazamiento
          </Boton>
        ) : (
          <Boton variante="texto" onClick={() => cambiar.mutate('aplazar')}>
            Aplazar partido
          </Boton>
        )}
      </div>
    </form>
  )
}

type Tipo = 'gol' | 'cambio' | 'amarilla' | 'roja' | 'gol_propia'
const TIPOS: { tipo: Tipo; texto: string; aviso: string }[] = [
  { tipo: 'gol', texto: 'Gol', aviso: 'Gol registrado' },
  { tipo: 'cambio', texto: 'Cambio', aviso: 'Cambio registrado' },
  { tipo: 'amarilla', texto: 'Amarilla', aviso: 'Amarilla registrada' },
  { tipo: 'roja', texto: 'Roja', aviso: 'Roja registrada' },
  { tipo: 'gol_propia', texto: 'Gol en propia', aviso: 'Gol en propia registrado' },
]

function HojaEvento({
  partido,
  abierta,
  alCerrar,
}: {
  partido: Partido
  abierta: boolean
  alCerrar: () => void
}) {
  return (
    <HojaInferior abierta={abierta} alCerrar={alCerrar} titulo="Añadir al partido">
      {abierta && <FormularioEvento partido={partido} alCerrar={alCerrar} />}
    </HojaInferior>
  )
}

function FormularioEvento({ partido, alCerrar }: { partido: Partido; alCerrar: () => void }) {
  const plantilla = usePlantillaActiva()
  const { avisar } = useAvisos()
  const guardar = useCambioPartido(partido)
  const minutos = partido.eventos.flatMap((e) => (e.minuto === null ? [] : [e.minuto]))
  const [tipo, setTipo] = useState<Tipo>('gol')
  const [jugador, setJugador] = useState('')
  const [otro, setOtro] = useState('')
  const [propiaDelRival, setPropiaDelRival] = useState(true)
  // El último minuto usado: durante el partido, lo siguiente suele pasar cerca
  const [minuto, setMinuto] = useState(minutos.length ? String(Math.max(...minutos)) : '')
  const [error, setError] = useState<string | null>(null)

  const convocados = partido.jugadores.filter((j) => j.convocado)
  const conAlineacion = convocados.some((j) => j.titular !== null)
  const hay = (tipoEvento: Evento['tipo'], id: string) =>
    partido.eventos.some((e) => e.tipo === tipoEvento && e.jugadorId === id)
  const haJugado = (j: (typeof convocados)[number]) =>
    j.titular === true || hay('entra', j.jugadorId)
  const enCampo = (j: (typeof convocados)[number]) =>
    haJugado(j) && !hay('sale', j.jugadorId) && !hay('roja', j.jugadorId)
  const opciones =
    tipo === 'cambio'
      ? convocados.filter((j) => j.titular === false && !hay('entra', j.jugadorId))
      : tipo === 'gol' && conAlineacion
        ? convocados.filter(haJugado)
        : convocados
  const salen = convocados.filter(enCampo)
  const asistentes = (conAlineacion ? convocados.filter(haJugado) : convocados).filter(
    (j) => j.jugadorId !== jugador,
  )
  const sinJugador = tipo === 'gol_propia' && propiaDelRival

  const registrar = useMutation({
    mutationFn: () => {
      const m = minuto === '' ? null : Number(minuto)
      const eventos: NuevoEvento[] =
        tipo === 'cambio'
          ? [
              { jugadorId: jugador, tipo: 'entra', minuto: m },
              { jugadorId: otro, tipo: 'sale', minuto: m },
            ]
          : tipo === 'gol'
            ? [
                { jugadorId: jugador, tipo: 'gol', minuto: m },
                ...(otro ? [{ jugadorId: otro, tipo: 'asistencia' as const, minuto: m }] : []),
              ]
            : [{ jugadorId: sinJugador ? null : jugador, tipo, minuto: m }]
      return guardar(
        datos(
          api.POST('/api/plantillas/{id}/partidos/{pid}/eventos/lote', {
            ...ruta(plantilla.id, partido.id),
            body: { eventos },
          }),
        ),
      )
    },
    onSuccess: () => {
      alCerrar()
      avisar({ tipo: 'exito', mensaje: TIPOS.find((t) => t.tipo === tipo)?.aviso ?? 'Registrado' })
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No se ha podido registrar'),
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!sinJugador && !jugador) return setError('Elige el jugador')
    if (tipo === 'cambio' && !otro) return setError('Elige quién sale')
    if (tipo === 'cambio' && minuto === '') return setError('Los cambios necesitan el minuto')
    registrar.mutate()
  }

  const opcion = (j: (typeof convocados)[number]) => (
    <option key={j.jugadorId} value={j.jugadorId}>
      {j.dorsal ?? '–'} · {nombreCompleto(j)}
    </option>
  )

  if (convocados.length === 0) {
    return <p className={estilos.secundario}>Primero hay que hacer la convocatoria.</p>
  }
  return (
    <form className={estilos.formulario} onSubmit={enviar}>
      <fieldset className={estilos.tiposEvento}>
        <legend>Qué ha pasado</legend>
        {TIPOS.map((t) => (
          <button
            key={t.tipo}
            type="button"
            aria-pressed={tipo === t.tipo}
            onClick={() => {
              setTipo(t.tipo)
              setJugador('')
              setOtro('')
            }}
          >
            {t.texto}
          </button>
        ))}
      </fieldset>

      {tipo === 'cambio' && !conAlineacion ? (
        <p className={estilos.secundario}>
          Para registrar cambios, indica antes los{' '}
          <Link to="alineacion" onClick={alCerrar}>
            titulares y suplentes
          </Link>
          .
        </p>
      ) : (
        <>
          {tipo === 'gol_propia' && (
            <fieldset className={estilos.grupo}>
              <legend>De quién</legend>
              <label className={estilos.opcion}>
                <input
                  type="radio"
                  checked={propiaDelRival}
                  onChange={() => setPropiaDelRival(true)}
                />
                Del rival (a nuestro favor)
              </label>
              <label className={estilos.opcion}>
                <input
                  type="radio"
                  checked={!propiaDelRival}
                  onChange={() => setPropiaDelRival(false)}
                />
                De uno de los nuestros (en contra)
              </label>
            </fieldset>
          )}
          {!sinJugador && (
            <Selector
              etiqueta={tipo === 'cambio' ? 'Entra' : 'Jugador'}
              value={jugador}
              onChange={(e) => setJugador(e.target.value)}
            >
              <option value="">Elige…</option>
              {opciones.map(opcion)}
            </Selector>
          )}
          {tipo === 'cambio' && (
            <Selector etiqueta="Sale" value={otro} onChange={(e) => setOtro(e.target.value)}>
              <option value="">Elige…</option>
              {salen.map(opcion)}
            </Selector>
          )}
          {tipo === 'gol' && (
            <Selector
              etiqueta="Asistencia (opcional)"
              value={otro}
              onChange={(e) => setOtro(e.target.value)}
            >
              <option value="">Sin asistencia</option>
              {asistentes.map(opcion)}
            </Selector>
          )}
          <label className={estilos.campoMinuto}>
            Minuto{tipo === 'cambio' ? '' : ' (opcional)'}
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
            <Boton
              type="submit"
              cargando={registrar.isPending}
              icono={<ListOrdered aria-hidden size={18} />}
            >
              Registrar
            </Boton>
          </div>
        </>
      )}
    </form>
  )
}
