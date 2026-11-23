import type { CSSProperties, ReactNode } from 'react'
import estilos from './Cifras.module.css'

export type Cifra = {
  texto: string
  valor: ReactNode
  // Sin nada que contar (un 0, un «—»): en el color suave, pero sin quitarla, para que todas las
  // fichas tengan las mismas casillas en el mismo orden (GH-226)
  vacia?: boolean
  // Ocupa la fila entera, con el valor en texto normal: para un texto (el material de un ejercicio,
  // GH-275) en vez de un número
  ancha?: boolean
}

// Cifras destacadas en casillas de cuatro (o tres, o dos) por fila: el número grande y lo que es
// debajo. En la ficha del jugador, en Partidos → Estadísticas y en la ficha del ejercicio
export function Cifras({ cifras, columnas = 4 }: { cifras: Cifra[]; columnas?: 2 | 3 | 4 }) {
  return (
    <dl className={estilos.cifras} style={{ '--columnas': columnas } as CSSProperties}>
      {cifras.map((c) => (
        <div key={c.texto} data-vacia={c.vacia || undefined} data-ancha={c.ancha || undefined}>
          <dt>{c.texto}</dt>
          <dd>{c.valor}</dd>
        </div>
      ))}
    </dl>
  )
}
