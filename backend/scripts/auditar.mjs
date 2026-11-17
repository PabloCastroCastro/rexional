// Audit de las dependencias de producción (CI, GH-317): falla con cualquier aviso alto o crítico, salvo
// los de la lista de excepciones. Cada excepción lleva su motivo y una fecha de revisión; npm audit no
// permite ignorar avisos concretos, por eso este script en vez de `npm audit --audit-level=high`.
//
//   node scripts/auditar.mjs

import { spawnSync } from 'node:child_process'

const EXCEPCIONES = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    paquete: 'picomatch',
    motivo:
      'ReDoS con extglobs. Sin versión corregida (afecta a todas, también la 4.0.7). Solo llega a ' +
      'producción por vitest, dependencia opcional (peer) de better-auth y herramienta de tests; la app ' +
      'no construye globs con datos del usuario.',
    revisar: '2026-12-31',
  },
]

const GRAVES = new Set(['high', 'critical'])

const salida = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
let informe
try {
  informe = JSON.parse(salida.stdout)
} catch {
  console.error('No se ha podido leer la salida de npm audit:\n', salida.stdout, salida.stderr)
  process.exit(1)
}

// Cada aviso aparece en el paquete afectado como un objeto en `via`; el resto de entradas son los
// paquetes que lo arrastran
const avisos = new Map()
for (const vulnerabilidad of Object.values(informe.vulnerabilities ?? {})) {
  for (const via of vulnerabilidad.via) {
    if (typeof via !== 'object') continue
    const id = via.url?.split('/').at(-1) ?? String(via.source)
    avisos.set(id, { id, paquete: via.name, gravedad: via.severity, titulo: via.title })
  }
}

const hoy = new Date().toISOString().slice(0, 10)
let fallos = 0
for (const aviso of avisos.values()) {
  if (!GRAVES.has(aviso.gravedad)) continue
  const excepcion = EXCEPCIONES.find((e) => e.id === aviso.id)
  if (excepcion && excepcion.revisar >= hoy) {
    console.log(`Permitido ${aviso.id} (${aviso.paquete}, ${aviso.gravedad}): ${excepcion.motivo}`)
    continue
  }
  fallos++
  console.error(
    excepcion
      ? `Excepción caducada (${excepcion.revisar}): revisa ${aviso.id} (${aviso.paquete}, ${aviso.gravedad})`
      : `${aviso.gravedad}: ${aviso.paquete} · ${aviso.titulo} · ${aviso.id}`,
  )
}

// Una excepción que ya no sale en el audit sobra: se avisa para quitarla
for (const excepcion of EXCEPCIONES) {
  if (!avisos.has(excepcion.id)) {
    console.log(`La excepción ${excepcion.id} (${excepcion.paquete}) ya no hace falta: quítala`)
  }
}

if (fallos > 0) {
  console.error(`\n${fallos} ${fallos === 1 ? 'aviso alto o crítico' : 'avisos altos o críticos'}`)
  process.exit(1)
}
console.log('Sin avisos altos ni críticos fuera de las excepciones')
