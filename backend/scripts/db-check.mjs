// Falla si el esquema de Drizzle tiene cambios sin migración generada, o si las migraciones son
// incoherentes. Lo ejecuta la CI (npm run db:check). No necesita base de datos ni modifica drizzle/:
// genera en una copia temporal y comprueba si aparece alguna migración nueva.
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const drizzleKit = join('node_modules', 'drizzle-kit', 'bin.cjs')

// drizzle-kit puede terminar con código 0 aunque falle, así que también se analiza su salida
const ejecutar = (args, env = {}) => {
  const r = spawnSync(process.execPath, [drizzleKit, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  const salida = `${r.stdout}${r.stderr}`
  process.stdout.write(salida)
  return { ok: r.status === 0 && !/\bError\b/.test(salida), salida }
}

const fallar = (mensaje) => {
  console.error(`\n${mensaje}`)
  process.exit(1)
}

const migraciones = (carpeta) => readdirSync(carpeta).filter((f) => f.endsWith('.sql'))

if (!ejecutar(['check']).ok) fallar('Las migraciones de drizzle/ no son coherentes')

// Carpeta relativa: drizzle-kit no admite rutas absolutas de Windows como salida
const copia = mkdtempSync('.db-check-')
let error = null
try {
  cpSync('drizzle', copia, { recursive: true })
  const antes = migraciones(copia)
  const { ok, salida } = ejecutar(['generate', '--name', 'comprobacion'], { DRIZZLE_OUT: copia })
  const nuevas = migraciones(copia).filter((f) => !antes.includes(f))

  if (nuevas.length > 0) {
    error =
      'El esquema tiene cambios sin migración. Genérala con: npm run db:generate -- --name <descripcion>'
  } else if (!ok || !/No schema changes/i.test(salida)) {
    error = 'No se pudo comprobar el esquema con drizzle-kit (ver la salida anterior)'
  }
} finally {
  rmSync(copia, { recursive: true, force: true })
}

if (error) fallar(error)
console.log('\nEl esquema y las migraciones están al día')
