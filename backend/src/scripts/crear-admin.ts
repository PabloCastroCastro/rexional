// Crea el primer usuario y su club, del que queda como administrador (GH-5).
//
//   npm run crear-admin                                             (desarrollo)
//   docker compose exec backend node dist/scripts/crear-admin.js    (servidor)
//
// Pregunta lo que no se indique. Para automatizarlo: --email, --nombre y --club, y la contraseña en
// la variable CONTRASENA_ADMIN (nunca como argumento, para que no quede en el historial).
import { stdin, stdout } from 'node:process'
import { parseArgs } from 'node:util'
import { crearAdministrador, ErrorAdministrador } from '../administradores.js'
import { LONGITUD_MINIMA_CONTRASENA } from '../auth.js'
import { pool } from '../db/cliente.js'
import { crearPreguntas } from './terminal.js'

const { values: argumentos } = parseArgs({
  options: { email: { type: 'string' }, nombre: { type: 'string' }, club: { type: 'string' } },
})

const terminal = crearPreguntas(stdin, stdout)

async function preguntar(texto: string, valor?: string) {
  return valor ?? (await terminal.preguntar(texto))
}

async function pedirContrasena() {
  const deEntorno = process.env.CONTRASENA_ADMIN
  if (deEntorno) return deEntorno
  if (!stdin.isTTY)
    throw new ErrorAdministrador('Sin terminal: indica la contraseña en CONTRASENA_ADMIN')
  const contrasena = await terminal.preguntarOculto(
    `Contraseña (mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres): `,
  )
  if ((await terminal.preguntarOculto('Repite la contraseña: ')) !== contrasena) {
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
  terminal.cerrar()
  await pool.end()
}
process.exit(codigo)
