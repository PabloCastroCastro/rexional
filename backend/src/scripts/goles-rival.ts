// Completa los goles del rival de los partidos ya registrados con acta (GH-151). Se lanza una vez
// tras desplegar la versión que los guarda; repetirlo no duplica nada.
//
//   npm run goles-rival [-- --aplicar]                                     (desarrollo)
//   docker compose exec backend node dist/scripts/goles-rival.js [--aplicar]   (servidor)
//
// Sin --aplicar solo enseña lo que haría, sin guardar nada.
import { parseArgs } from 'node:util'
import { completarGolesRival } from '../acta/goles-rival.js'
import { db, pool } from '../db/cliente.js'

const { values: argumentos } = parseArgs({ options: { aplicar: { type: 'boolean' } } })
const aplicar = argumentos.aplicar === true

const ESTADOS = {
  anadidos: aplicar ? 'añadidos' : 'se añadirían',
  ya_tenia: 'ya los tenía',
  sin_goles: 'sin goles del rival',
  no_legible: 'acta no legible',
  incoherente: 'no cuadra, no se añade',
}

try {
  const resultados = await completarGolesRival(db, { aplicar })
  for (const r of resultados) {
    const minutos = r.minutos.map((m) => (m === null ? '?' : `${m}'`)).join(', ')
    const detalle = r.detalle ? ` (${r.detalle})` : ''
    console.log(
      `${r.fecha} ${r.rival}: ${ESTADOS[r.estado]}${minutos ? ` · ${minutos}` : ''}${detalle}`,
    )
  }
  const anadidos = resultados.filter((r) => r.estado === 'anadidos')
  const goles = anadidos.reduce((total, r) => total + r.minutos.length, 0)
  console.log(
    `\n${resultados.length} partidos con acta; ${goles} goles del rival en ${anadidos.length} partidos ${aplicar ? 'añadidos' : 'por añadir (simulación: no se ha guardado nada)'}`,
  )
} finally {
  await pool.end()
}
