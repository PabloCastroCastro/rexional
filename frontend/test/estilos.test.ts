import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
