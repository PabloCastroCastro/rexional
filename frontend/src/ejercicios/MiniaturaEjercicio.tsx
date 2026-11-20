import {
  Dumbbell,
  Flame,
  Hand,
  type LucideIcon,
  type LucideProps,
  Target,
  Users,
  Waypoints,
  Wind,
  Zap,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { type Categoria, colorCategoria } from './datos'
import estilos from './MiniaturaEjercicio.module.css'

// Balón de fútbol con el trazo de lucide, que no lo tiene
function Balon({ size = 24, ...resto }: LucideProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...resto}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m12 8 3.8 2.8-1.5 4.4H9.7l-1.5-4.4Z" />
      <path d="M12 8V2.5M15.8 10.8l5.2-1.7M14.3 15.2l3.2 4.4M9.7 15.2l-3.2 4.4M8.2 10.8 3 9.1" />
    </svg>
  )
}

// Icono de cada categoría (GH-273); sin categoría, uno neutro
const ICONOS: Record<Categoria | 'ninguna', LucideIcon | typeof Balon> = {
  calentamiento: Flame,
  tecnica: Balon,
  tactica: Waypoints,
  fisico: Zap,
  finalizacion: Target,
  porteros: Hand,
  partido: Users,
  vuelta_calma: Wind,
  ninguna: Dumbbell,
}

// Miniatura de un ejercicio: su foto, o sin ella, el icono de la categoría sobre su color suave.
// El tamaño lo pone quien la usa con className.
export function MiniaturaEjercicio({
  url,
  categoria,
  className,
  tamanoIcono = 22,
}: {
  url: string | null
  categoria: Categoria | null
  className?: string
  tamanoIcono?: number
}) {
  const clases = [estilos.miniatura, className].filter(Boolean).join(' ')
  if (url) return <img src={url} alt="" className={clases} loading="lazy" />
  const Icono = ICONOS[categoria ?? 'ninguna']
  return (
    <span
      className={clases}
      style={{ '--color-categoria': colorCategoria(categoria) } as CSSProperties}
      data-categoria={categoria ?? 'ninguna'}
      aria-hidden="true"
    >
      <Icono size={tamanoIcono} />
    </span>
  )
}
