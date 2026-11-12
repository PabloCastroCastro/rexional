import estilos from './EscudoClub.module.css'

// Escudo del club (GH-29): el que subió el club o, si no tiene, el genérico de Vestuario dibujado con
// los colores del club activo. Decorativo: el nombre del club va siempre al lado. Con placa, sobre un
// fondo claro, para la cabecera del color del club (GH-221).
export function EscudoClub({
  escudo,
  tamano = 32,
  className,
  conPlaca = false,
}: {
  escudo: string | null
  tamano?: number
  className?: string
  conPlaca?: boolean
}) {
  if (conPlaca) {
    return (
      <span className={[estilos.placa, className].filter(Boolean).join(' ')} data-placa>
        <EscudoClub escudo={escudo} tamano={tamano - 6} />
      </span>
    )
  }
  if (escudo) {
    return <img src={escudo} alt="" width={tamano} height={tamano} className={className} />
  }
  return (
    <svg
      viewBox="0 0 512 512"
      width={tamano}
      height={tamano}
      aria-hidden="true"
      className={className}
    >
      <rect width="512" height="512" rx="112" fill="var(--color-primario)" />
      <path
        d="M256 84 400 136v114c0 88-58 148-144 182-86-34-144-94-144-182V136Z"
        fill="var(--color-secundario)"
      />
      <path
        d="M190 196 256 336 322 196"
        fill="none"
        stroke="var(--color-sobre-secundario)"
        strokeWidth="42"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
