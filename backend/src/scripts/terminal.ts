import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'

// Preguntas por terminal para los scripts. Para no mostrar una contraseña, readline escribe en un
// flujo propio que se silencia mientras se teclea: no depende de métodos internos de readline, que
// cambian entre versiones de Node (GH-98: _writeToOutput ya no existe en Node 24.22).
export function crearPreguntas(
  entrada: NodeJS.ReadableStream & { isTTY?: boolean },
  salida: NodeJS.WritableStream,
  terminal = Boolean(entrada.isTTY),
) {
  let silenciada = false
  const visible = new Writable({
    write(trozo, _codificacion, listo) {
      if (!silenciada) salida.write(trozo)
      listo()
    },
  })
  const rl = createInterface({ input: entrada, output: visible, terminal })

  return {
    preguntar: (texto: string) => rl.question(texto),

    // Lee sin mostrar lo que se escribe
    async preguntarOculto(texto: string) {
      salida.write(texto)
      silenciada = true
      try {
        return await rl.question('')
      } finally {
        silenciada = false
        salida.write('\n')
      }
    },

    cerrar: () => rl.close(),
  }
}
