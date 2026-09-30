// Crea el primer usuario y su club, del que queda como administrador (GH-5).
//
//   npm run crear-admin                                             (desarrollo)
//   docker compose exec backend node dist/scripts/crear-admin.js    (servidor)
//
// Pregunta lo que no se indique. Para automatizarlo: --email, --nombre y --club, y la contraseña en
// la variable CONTRASENA_ADMIN (nunca como argumento, para que no quede en el historial).
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import { crearAdministrador, ErrorAdministrador } from '../administradores.js'
import { LONGITUD_MINIMA_CONTRASENA } from '../auth.js'
import { pool } from '../db/cliente.js'

const { values: argumentos } = parseArgs({
  options: { email: { type: 'string' }, nombre: { type: 'string' }, club: { type: 'string' } },
})

const rl = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY })

async function preguntar(texto: string, valor?: string) {
  return valor ?? (await rl.question(texto))
}

// Lee sin mostrar lo que se escribe
async function preguntarOculto(texto: string) {
  const salida = rl as unknown as { _writeToOutput: (s: string) => void }
  const original = salida._writeToOutput.bind(rl)
  stdout.write(texto)
  salida._writeToOutput = () => {}
  try {
    return await rl.question('')
  } finally {
    salida._writeToOutput = original
    stdout.write('\n')
  }
}

async function pedirContrasena() {
  const deEntorno = process.env.CONTRASENA_ADMIN
  if (deEntorno) return deEntorno
  if (!stdin.isTTY)
    throw new ErrorAdministrador('Sin terminal: indica la contraseña en CONTRASENA_ADMIN')
  const contrasena = await preguntarOculto(
    `Contraseña (mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres): `,
  )
  if ((await preguntarOculto('Repite la contraseña: ')) !== contrasena) {
    throw new ErrorAdministrador('Las contraseñas no coinciden')
  }
  return contrasena
}

let codigo = 0
try {
  const email = await preguntar('Email: ', argumentos.email)
  const nombre = await preguntar('Nombre: ', argumentos.nombre)
  const club = await preguntar('Nombre del club: ', argumentos.club)
  const contrasena = await pedirContrasena()

  const { usuario, club: creado } = await crearAdministrador({ email, nombre, club, contrasena })
  console.log(`Creado ${usuario.name} <${usuario.email}>, administrador del club ${creado.nombre}`)
} catch (error) {
  if (!(error instanceof ErrorAdministrador)) throw error
  console.error(`No se ha creado nada: ${error.message}`)
  codigo = 1
} finally {
  rl.close()
  await pool.end()
}
process.exit(codigo)
