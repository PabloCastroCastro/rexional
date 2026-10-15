import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { crearPreguntas } from '../src/scripts/terminal.js'

// Preguntas de los scripts (crear-admin) con un terminal simulado. GH-98: la contraseña se ocultaba
// con un método interno de readline que desapareció en Node 24.22 y el script fallaba al pedirla.

function terminalSimulado(terminal: boolean) {
  const entrada = new PassThrough()
  const salida = new PassThrough()
  let visto = ''
  salida.on('data', (trozo) => {
    visto += trozo
  })
  const preguntas = crearPreguntas(entrada, salida, terminal)
  return {
    preguntas,
    teclear: (texto: string) => entrada.write(`${texto}\n`),
    visto: () => visto,
  }
}

describe.each([true, false])('preguntas por terminal (modo terminal: %s)', (modoTerminal) => {
  it('devuelve lo escrito en una pregunta normal', async () => {
    const t = terminalSimulado(modoTerminal)
    const respuesta = t.preguntas.preguntar('Email: ')
    t.teclear('ana@rexional.test')
    expect(await respuesta).toBe('ana@rexional.test')
    expect(t.visto()).toContain('Email: ')
    t.preguntas.cerrar()
  })

  it('pregunta la contraseña sin mostrarla y la devuelve', async () => {
    const t = terminalSimulado(modoTerminal)
    const respuesta = t.preguntas.preguntarOculto('Contraseña: ')
    t.teclear('muy-secreta-123')
    expect(await respuesta).toBe('muy-secreta-123')
    expect(t.visto()).toContain('Contraseña: ')
    expect(t.visto()).not.toContain('muy-secreta-123')

    // Después de la contraseña, lo que se escribe vuelve a verse
    const siguiente = t.preguntas.preguntar('Nombre: ')
    t.teclear('Ana')
    expect(await siguiente).toBe('Ana')
    t.preguntas.cerrar()
  })
})

it('en modo terminal, lo que se teclea se ve salvo en la contraseña', async () => {
  const t = terminalSimulado(true)
  const email = t.preguntas.preguntar('Email: ')
  t.teclear('visible@rexional.test')
  await email
  const contrasena = t.preguntas.preguntarOculto('Contraseña: ')
  t.teclear('oculta-456789')
  await contrasena
  expect(t.visto()).toContain('visible@rexional.test')
  expect(t.visto()).not.toContain('oculta-456789')
  t.preguntas.cerrar()
})
