import type { Partido } from './datos'
import estilos from './Partidos.module.css'

type EntrenoPrevio = NonNullable<Partido['jugadores'][number]['entrenosPrevios']>[number]

const diaSemana = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' })
const elDia = (fecha: string) => `el ${diaSemana.format(new Date(`${fecha}T12:00:00Z`))}`

// «el martes y el jueves»
function enumerar(partes: string[]) {
  return partes.length < 2
    ? (partes[0] ?? '')
    : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`
}

// «Entrenó 1 de 2 desde el partido anterior. Faltó el jueves · Trabajo. Falta pasar lista del
// viernes»: lo que se lee y se ve al pasar por encima (GH-288)
export function textoEntrenos(entrenos: EntrenoPrevio[]) {
  const conLista = entrenos.filter((e) => e.estado !== null)
  const fue = conLista.filter((e) => e.estado === 'asiste').length
  const faltas = conLista
    .filter((e) => e.estado !== 'asiste')
    .map((e) => `${elDia(e.fecha)}${e.motivo ? ` · ${e.motivo}` : ''}`)
  const pendientes = entrenos.filter((e) => e.estado === null).map((e) => elDia(e.fecha))
  return [
    conLista.length > 0 && `Entrenó ${fue} de ${conLista.length} desde el partido anterior`,
    faltas.length > 0 && `Faltó ${enumerar(faltas)}`,
    pendientes.length > 0 && `Falta pasar lista ${enumerar(pendientes).replaceAll('el ', 'del ')}`,
  ]
    .filter(Boolean)
    .map((frase) => `${frase}.`)
    .join(' ')
}

// Cómo ha entrenado desde el partido anterior, sin texto en pantalla (GH-288): hasta 5 entrenos,
// un punto por sesión en orden (verde si fue, rojo si faltó, gris si aún no se ha pasado lista); con
// 6 o más, la fracción, en el color de los umbrales de asistencia (80 % y 60 %)
export function EntrenosPrevios({ entrenos }: { entrenos: EntrenoPrevio[] | null }) {
  if (!entrenos || entrenos.length === 0) return null
  const texto = textoEntrenos(entrenos)
  if (entrenos.length <= 5) {
    return (
      <span className={estilos.puntosEntrenos} role="img" aria-label={texto} title={texto}>
        {entrenos.map((e, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: la posición es el orden de las sesiones
            key={i}
            data-estado={e.estado === null ? 'pendiente' : e.estado === 'asiste' ? 'fue' : 'falto'}
          />
        ))}
      </span>
    )
  }
  const conLista = entrenos.filter((e) => e.estado !== null)
  const fue = conLista.filter((e) => e.estado === 'asiste').length
  const porcentaje = conLista.length ? (fue / conLista.length) * 100 : null
  const nivel =
    porcentaje === null
      ? 'pendiente'
      : porcentaje >= 80
        ? 'alto'
        : porcentaje >= 60
          ? 'medio'
          : 'bajo'
  return (
    <span
      className={estilos.fraccionEntrenos}
      data-nivel={nivel}
      role="img"
      aria-label={texto}
      title={texto}
    >
      {conLista.length ? `${fue}/${conLista.length}` : '–'}
    </span>
  )
}
