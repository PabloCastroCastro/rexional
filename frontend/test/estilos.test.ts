import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contraste } from '../src/diseno/tema'

// Una clase definida dos veces en el mismo módulo de estilos se pisa sin avisar: en la v1.1.1 el
// icono de las tarjetas (.tarjeta) deformó la tarjeta de cada partido del listado, que se llamaba
// igual. Las agrupaciones (".a, .b { … }" y luego ".b { … }") y las reglas dentro de @media no
// cuentan: solo una regla de primer nivel cuyo selector es exactamente la misma clase.

// Los tests se ejecutan desde frontend/ (en jsdom, import.meta.url no es una ruta de archivo)
const SRC = join(process.cwd(), 'src')

const modulos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? modulos(join(dir, e.name))
      : e.name.endsWith('.module.css')
        ? [join(dir, e.name)]
        : [],
  )

// Selectores de las reglas de primer nivel (fuera de @media, @keyframes…)
function selectoresDePrimerNivel(css: string) {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectores: string[] = []
  let nivel = 0
  let actual = ''
  for (const c of sinComentarios) {
    if (c === '{') {
      if (nivel === 0) selectores.push(actual.trim())
      nivel++
      actual = ''
    } else if (c === '}') {
      nivel--
      actual = ''
    } else if (nivel === 0) {
      actual += c
    }
  }
  return selectores
}

describe('módulos de estilos', () => {
  it('ninguna clase se define dos veces en el mismo archivo', () => {
    const repetidas = modulos(SRC).flatMap((archivo) => {
      const clases = selectoresDePrimerNivel(readFileSync(archivo, 'utf8')).filter((s) =>
        /^\.[\w-]+$/.test(s),
      )
      return clases
        .filter((c, i) => clases.indexOf(c) !== i)
        .map((c) => `${archivo.slice(SRC.length + 1)}: ${c}`)
    })
    expect(repetidas).toEqual([])
  })
})

// GH-227: Saira Condensed para los títulos y los números, incluida en la app y guardada para usarla
// sin conexión
describe('fuente de los títulos', () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), 'utf8')

  it('el token empieza por Saira Condensed y tiene alternativas estrechas', () => {
    const token = leer('src/estilos/tokens.css').match(/--fuente-titulos:\s*([^;]+);/)?.[1]
    expect(token?.trim()).toMatch(/^"Saira Condensed", "Arial Narrow"/)
  })

  it('los h1 y los h2 la usan', () => {
    const base = leer('src/estilos/base.css')
    for (const h of ['h1', 'h2']) {
      const regla = base.match(new RegExp(`\n${h} {([^}]+)}`))?.[1]
      expect(regla).toContain('font-family: var(--fuente-titulos)')
    }
  })

  it('se carga desde la app, solo en latín, y la PWA guarda los woff2', () => {
    const main = leer('src/main.tsx')
    expect(main).toContain("import '@fontsource/saira-condensed/latin-600.css'")
    expect(main).toContain("import '@fontsource/saira-condensed/latin-700.css'")
    expect(leer('vite.config.ts')).toMatch(/globPatterns: \[[^\]]*woff2/)
  })
})

// GH-228: los colores del resultado se leen con su texto, en claro y en oscuro
describe('colores del resultado', () => {
  const tokens = readFileSync(join(SRC, 'estilos/tokens.css'), 'utf8')
  const [claro = '', oscuro = ''] = tokens.split('@media (prefers-color-scheme: dark)')
  const valor = (bloque: string, nombre: string) =>
    bloque.match(new RegExp(`--${nombre}:\\s*(#[0-9a-f]{6});`))?.[1] ?? ''

  for (const [modo, bloque] of [
    ['claro', claro],
    ['oscuro', oscuro],
  ] as const) {
    for (const tipo of ['victoria', 'empate', 'derrota']) {
      it(`${tipo} en modo ${modo} cumple AA con su texto`, () => {
        const fondo = valor(bloque, `color-${tipo}`)
        const texto = valor(bloque, `color-sobre-${tipo}`)
        expect(fondo).not.toBe('')
        expect(contraste(fondo, texto)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
