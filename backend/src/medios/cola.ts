import { eq } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { ejercicioMedios } from '../db/schema/index.js'
import { logger } from '../logger.js'
import { limpiarTemporales, preparar } from './almacen.js'
import { procesarVideo } from './procesar.js'

// Cola de vídeos por procesar, en el propio backend y de uno en uno. No hace falta nada más: el
// estado vive en la base de datos (medios «procesando» con el original en pendientes/), así que al
// arrancar se retoma lo que quedara a medias.

let cola: Promise<void> = Promise.resolve()

export function encolar(medioId: string) {
  cola = cola
    .then(() => procesarVideo(medioId))
    .catch((error) => logger.error({ err: error, medioId }, 'Error en la cola de vídeos'))
}

// Se resuelve cuando no queda nada por procesar (para los tests)
export async function esperarCola() {
  let actual: Promise<void>
  do {
    actual = cola
    await actual
  } while (actual !== cola)
}

// Al arrancar: carpetas, temporales viejos fuera y vídeos pendientes otra vez a la cola
export async function iniciarMedios() {
  await preparar()
  await limpiarTemporales()
  const pendientes = await db
    .select({ id: ejercicioMedios.id })
    .from(ejercicioMedios)
    .where(eq(ejercicioMedios.estado, 'procesando'))
  for (const { id } of pendientes) encolar(id)
  if (pendientes.length > 0)
    logger.info({ pendientes: pendientes.length }, 'Vídeos pendientes de procesar')
}
