// Tema de cada club (GH-29): sus dos colores pasan a las variables CSS de toda la aplicación. El
// color principal se usa tal cual de fondo (cabecera, botones) con texto blanco o negro según su
// luminosidad; para textos y acentos sobre la superficie se oscurece (tema claro) o se aclara (tema
// oscuro) lo justo para cumplir WCAG AA.

export type ColoresClub = { colorPrincipal: string; colorSecundario: string }

export const POR_DEFECTO: ColoresClub = { colorPrincipal: '#14553d', colorSecundario: '#f2c230' }

// Las superficies de tokens.css, sobre las que van los acentos
const SUPERFICIE_CLARA = '#ffffff'
const SUPERFICIE_OSCURA = '#181d1a'
const TEXTO_OSCURO = '#1b1f1d'
const BLANCO = '#ffffff'
const CONTRASTE_MINIMO = 4.5

type Rgb = [number, number, number]

const aRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const aHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

const esHex = (color: string) => /^#[0-9a-f]{6}$/i.test(color)

// Luminancia relativa de WCAG 2.2
export function luminancia(hex: string) {
  const [r, g, b] = aRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as Rgb
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contraste(a: string, b: string) {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x) as [number, number]
  return (claro + 0.05) / (oscuro + 0.05)
}

// Texto sobre un color de fondo: blanco si se lee igual o mejor que el oscuro
export const textoSobre = (fondo: string) =>
  contraste(fondo, BLANCO) >= contraste(fondo, TEXTO_OSCURO) ? BLANCO : TEXTO_OSCURO

const mezclar = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

// El color, mezclado con negro o con blanco (según la superficie) lo justo para tener al menos
// 4,5:1 con ella. Si ya lo cumple, tal cual
export function legibleSobre(color: string, superficie: string) {
  if (contraste(color, superficie) >= CONTRASTE_MINIMO) return color.toLowerCase()
  const hacia: Rgb = luminancia(superficie) > 0.5 ? [0, 0, 0] : [255, 255, 255]
  const origen = aRgb(color)
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidato = aHex(mezclar(origen, hacia, t))
    if (contraste(candidato, superficie) >= CONTRASTE_MINIMO) return candidato
  }
  return aHex(hacia)
}

// Variables CSS del tema: las que tokens.css deja preparadas para el club
export function variablesTema(colores: ColoresClub): Record<string, string> {
  const principal = esHex(colores.colorPrincipal)
    ? colores.colorPrincipal
    : POR_DEFECTO.colorPrincipal
  const secundario = esHex(colores.colorSecundario)
    ? colores.colorSecundario
    : POR_DEFECTO.colorSecundario
  return {
    '--color-primario': principal.toLowerCase(),
    '--color-sobre-primario': textoSobre(principal),
    '--color-secundario': secundario.toLowerCase(),
    '--color-sobre-secundario': textoSobre(secundario),
    '--acento-claro': legibleSobre(principal, SUPERFICIE_CLARA),
    '--acento-oscuro':
      principal.toLowerCase() === POR_DEFECTO.colorPrincipal
        ? '#7fd1aa'
        : legibleSobre(principal, SUPERFICIE_OSCURA),
  }
}

const CLAVE = 'vestuario.tema'

// Aplica el tema a toda la aplicación y al color de la barra del navegador, y lo recuerda para la
// próxima vez que se abra (así no se ven un instante los colores por defecto)
export function aplicarTema(colores: ColoresClub) {
  const raiz = document.documentElement
  for (const [nombre, valor] of Object.entries(variablesTema(colores))) {
    raiz.style.setProperty(nombre, valor)
  }
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', variablesTema(colores)['--color-primario'] ?? '')
  try {
    localStorage.setItem(CLAVE, JSON.stringify(colores))
  } catch {
    // Sin almacenamiento (modo privado): solo se pierde el arranque sin parpadeo
  }
}

// Al arrancar, antes de pintar nada: el tema de la última plantilla abierta
export function aplicarTemaGuardado() {
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE) ?? 'null') as ColoresClub | null
    if (guardado?.colorPrincipal && guardado.colorSecundario) aplicarTema(guardado)
  } catch {
    // Nada guardado o ilegible: se quedan los colores por defecto
  }
}
