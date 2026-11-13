import { Clock, MapPin, Pencil } from 'lucide-react'
import { EscudoClub } from '../diseno/EscudoClub'
import { hoy, sumarDias } from '../entrenos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { type Partido, TEXTO_RESULTADO, tipoResultado } from './datos'
import estilos from './TarjetaPartido.module.css'

const partes = (fecha: string, opciones: Intl.DateTimeFormatOptions) =>
  Object.fromEntries(
    new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', ...opciones })
      .formatToParts(new Date(`${fecha}T12:00:00Z`))
      .map((p) => [p.type, p.value.replace('.', '')]),
  )

const mayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

// «Sáb 28 nov»
export function fechaCorta(fecha: string) {
  const p = partes(fecha, { weekday: 'short', day: 'numeric', month: 'short' })
  return `${mayuscula(p.weekday ?? '')} ${p.day} ${p.month}`
}

// Cuándo se juega, en lenguaje de persona: «Hoy», «Mañana», el día de esta semana («Sábado») o, si
// falta más (o ya pasó), la fecha corta; con la hora detrás si la hay (GH-229)
export function cuandoSeJuega(fecha: string, hora: string | null, hoyEs = hoy()) {
  const dias = Math.round(
    (Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${hoyEs}T12:00:00Z`)) / 86_400_000,
  )
  const dia =
    dias === 0
      ? 'Hoy'
      : fecha === sumarDias(hoyEs, 1)
        ? 'Mañana'
        : dias > 1 && dias < 7
          ? mayuscula(partes(fecha, { weekday: 'long' }).weekday ?? '')
          : fechaCorta(fecha)
  return hora ? `${dia} · ${hora}` : dia
}

// La tarjeta de arriba del detalle de un partido, con dos caras: antes de jugarlo mandan la hora y el
// sitio; después, el resultado. Nuestro escudo siempre a la izquierda y el resultado desde nuestro
// lado, como en la lista (GH-229)
export function TarjetaPartido({
  partido: p,
  alEditar,
}: {
  partido: Partido
  // Solo para quien gestiona el partido
  alEditar?: () => void
}) {
  const plantilla = usePlantillaActiva()
  const jugado = p.estado === 'jugado'
  const tipo = jugado ? tipoResultado(p) : null
  const arriba = [p.competicion, jugado && fechaCorta(p.fecha)].filter(Boolean).join(' · ')
  const lado = p.local === true ? 'Casa' : p.local === false ? 'Fuera' : null
  const sitio = [lado, p.lugar].filter(Boolean).join(' · ')

  return (
    <header className={estilos.tarjeta}>
      {alEditar && (
        <button
          type="button"
          className={estilos.editar}
          aria-label="Editar"
          title="Editar"
          onClick={alEditar}
        >
          <Pencil aria-hidden size={18} />
        </button>
      )}
      {arriba && <p className={estilos.arriba}>{arriba}</p>}

      <div className={estilos.equipos}>
        <EscudoClub escudo={plantilla.club.escudo} tamano={46} conPlaca />
        <div className={estilos.centro}>
          {jugado && tipo ? (
            <>
              <span className={estilos.marcador}>
                <span className="solo-lectores">{plantilla.club.nombre} </span>
                {p.golesFavor}–{p.golesContra}
              </span>
              <span className={estilos.pastilla} data-resultado={tipo}>
                {TEXTO_RESULTADO[tipo]}
              </span>
            </>
          ) : p.estado === 'aplazado' ? (
            <span className={estilos.aplazado}>Aplazado</span>
          ) : (
            <span className={estilos.vs}>
              <span className="solo-lectores">{plantilla.club.nombre} </span>vs
            </span>
          )}
        </div>
        <h1 className={estilos.rival}>{p.rival}</h1>
      </div>

      {p.estado === 'programado' && (
        <p className={estilos.cuando}>{cuandoSeJuega(p.fecha, p.hora)}</p>
      )}
      {((p.estado === 'programado' && p.horaCitacion) || sitio) && (
        <ul className={estilos.datos}>
          {p.estado === 'programado' && p.horaCitacion && (
            <li>
              <Clock aria-hidden size={16} />
              <span>
                Citación <strong>{p.horaCitacion}</strong>
              </span>
            </li>
          )}
          {sitio && (
            <li>
              <MapPin aria-hidden size={16} />
              <span>{sitio}</span>
            </li>
          )}
        </ul>
      )}
    </header>
  )
}
