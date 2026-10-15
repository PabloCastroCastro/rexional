import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// Dos esquemas con el mismo nombre en el contrato se pisan: uno de los dos acaba con la forma del
// otro y el cliente del frontend se genera mal sin que nada falle

const archivos = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? archivos(join(dir, e.name))
      : e.name.endsWith('.ts')
        ? [join(dir, e.name)]
        : [],
  )

describe('contrato de la API', () => {
  it('no hay dos esquemas con el mismo nombre', () => {
    const nombres = archivos(fileURLToPath(new URL('../src', import.meta.url)))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\.openapi\('([A-Za-z]+)'\)/g)])
      .map((m) => m[1])
    expect(nombres.length).toBeGreaterThan(20)
    expect(nombres.filter((n, i) => nombres.indexOf(n) !== i)).toEqual([])
  })
})
