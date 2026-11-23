import estilos from './Entrenos.module.css'

// Porcentaje de asistencia con un color suave según el valor: ≥ 80 bien, 60–79 regular, < 60 bajo
// Mientras carga, una pastilla vacía del mismo tamaño, para que la fila no salte al llegar (GH-253);
// sin datos, «—» en texto suave y sin pastilla
export function Porcentaje({
  valor,
  cargando = false,
}: {
  valor: number | null | undefined
  cargando?: boolean
}) {
  if (cargando) {
    return (
      <span className={`${estilos.porcentaje} ${estilos.porcentajeCargando}`} aria-hidden="true">
        {/* Un espacio duro: da a la pastilla vacía la altura de una con texto */}
        {' '}
      </span>
    )
  }
  if (valor === undefined) return null
  if (valor === null) {
    return (
      <span className={estilos.porcentaje} data-vacio="true">
        <span aria-hidden="true">—</span>
        <span className="solo-lectores">Sin asistencia registrada</span>
      </span>
    )
  }
  const nivel = nivelAsistencia(valor)
  return (
    <span className={estilos.porcentaje} data-nivel={nivel}>
      {valor} %<span className="solo-lectores"> de asistencia</span>
    </span>
  )
}

export const nivelAsistencia = (valor: number) =>
  valor >= 80 ? 'alto' : valor >= 60 ? 'medio' : 'bajo'
