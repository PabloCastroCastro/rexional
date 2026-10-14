import estilos from './Entrenos.module.css'

// Porcentaje de asistencia con un color suave según el valor: ≥ 80 bien, 60–79 regular, < 60 bajo
export function Porcentaje({ valor }: { valor: number | null | undefined }) {
  if (valor === undefined) return null
  if (valor === null) {
    return (
      <span className={estilos.porcentaje}>
        <span aria-hidden="true">—</span>
        <span className="solo-lectores">Sin asistencia registrada</span>
      </span>
    )
  }
  const nivel = valor >= 80 ? 'alto' : valor >= 60 ? 'medio' : 'bajo'
  return (
    <span className={estilos.porcentaje} data-nivel={nivel}>
      {valor} %<span className="solo-lectores"> de asistencia</span>
    </span>
  )
}
