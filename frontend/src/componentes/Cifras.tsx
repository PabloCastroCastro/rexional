import type { CSSProperties, ReactNode } from 'react'
import estilos from './Cifras.module.css'

export type Cifra = {
  texto: string
  valor: ReactNode
  // Sin nada que contar (un 0, un «—»): en el color suave, pero sin quitarla, para que todas las
  // fichas tengan las mismas casillas en el mismo orden (GH-226)
  vacia?: boolean
}

// Cifras destacadas en casillas de cuatro (o tres) por fila: el número grande y lo que es debajo. En
// la ficha del jugador y en Partidos → Estadísticas
export function Cifras({ cifras, columnas = 4 }: { cifras: Cifra[]; columnas?: 3 | 4 }) {
  return (
    <dl className={estilos.cifras} style={{ '--columnas': columnas } as CSSProperties}>
      {cifras.map((c) => (
        <div key={c.texto} data-vacia={c.vacia || undefined}>
          <dt>{c.texto}</dt>
          <dd>{c.valor}</dd>
        </div>
      ))}
    </dl>
  )
}
