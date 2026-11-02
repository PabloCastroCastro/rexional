import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, count, eq } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { archivosPartido, user } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { bloquearPartido } from '../estadisticas.js'
import { absoluta, borrar, carpetaDePartido, mover, nueva } from '../medios/almacen.js'
import { procesarFoto } from '../medios/procesar.js'
import { recibirArchivo } from '../medios/subida.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import { buscarPartido, errores, json, ParamPartido } from './partidos.js'

// Planificación de un partido (GH-147): archivos con la charla, el plan táctico, el rival… PDF tal
// cual o foto reducida a WebP sin metadatos, en la carpeta de subidas del partido. Van aparte del
// detalle del partido, que ve cualquier miembro: estas rutas son solo para delegado o superior

export const MAXIMO_ARCHIVOS = 10

const LARGO_TITULO = 80
const LARGO_NOMBRE = 200

export const EsquemaArchivoPartido = z
  .object({
    id: z.uuid(),
    titulo: z.string().nullable(),
    nombreOriginal: z.string(),
    tipo: z.enum(['pdf', 'imagen']),
    tamanoBytes: z.int(),
    subidoPor: z.string().nullable().openapi({ description: 'Nombre de quien lo subió' }),
    subidoEn: z.string(),
  })
  .openapi('ArchivoPartido')

const EsquemaArchivos = z.array(EsquemaArchivoPartido)

const ParamArchivo = ParamPartido.extend({
  aid: EsquemaUuid.openapi({ param: { name: 'aid', in: 'path' } }),
})

const noEncontrado = () => new ErrorApi(404, 'no_encontrado', 'No existe ese archivo en el partido')

const demasiados = () =>
  new ErrorApi(
    400,
    'demasiados_archivos',
    `Un partido puede tener como mucho ${MAXIMO_ARCHIVOS} archivos`,
  )

// Vacío o solo espacios es «sin título»
const limpiarTitulo = (t: string | null | undefined) => t?.trim().slice(0, LARGO_TITULO) || null

// Sin rutas ni caracteres de control; si no queda nada, un nombre genérico
function limpiarNombre(nombre: string, extension: string) {
  const base = nombre
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\p{Cc}]/gu, '')
    .trim()
    .slice(0, LARGO_NOMBRE)
  return base || `archivo.${extension}`
}

const contar = async (tx: Pick<typeof db, 'select'>, partidoId: string) => {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(archivosPartido)
    .where(eq(archivosPartido.partidoId, partidoId))
  return n
}

// Por orden de subida
export async function archivosDelPartido(partidoId: string) {
  const filas = await db
    .select({
      id: archivosPartido.id,
      titulo: archivosPartido.titulo,
      nombreOriginal: archivosPartido.nombreOriginal,
      mime: archivosPartido.mime,
      tamanoBytes: archivosPartido.tamanoBytes,
      subidoPor: user.name,
      subidoEn: archivosPartido.createdAt,
    })
    .from(archivosPartido)
    .leftJoin(user, eq(user.id, archivosPartido.subidoPor))
    .where(eq(archivosPartido.partidoId, partidoId))
    .orderBy(asc(archivosPartido.createdAt), asc(archivosPartido.id))
  return filas.map(({ mime, subidoEn, ...a }) => ({
    ...a,
    tipo: mime === 'application/pdf' ? ('pdf' as const) : ('imagen' as const),
    subidoEn: subidoEn.toISOString(),
  }))
}

export const rutasPlanificacion = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/archivos',
        tags: ['Partidos'],
        summary: 'Planificación del partido',
        description: 'Delegado o superior. Los archivos por orden de subida.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 200: json(EsquemaArchivos, 'Archivos del partido'), ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        return c.json(await archivosDelPartido(pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/archivos',
        tags: ['Partidos'],
        summary: 'Subir un archivo de planificación',
        description: `Delegado o superior. Cuerpo \`multipart/form-data\` con el archivo en \`archivo\` y, opcional, \`titulo\` (no se declara aquí: validarlo leería el cuerpo entero y la subida dejaría de ir en streaming). PDF o foto JPEG, PNG o WebP, con el límite de las fotos (por defecto 15 MB). El PDF se guarda tal cual; la foto, reducida, en WebP y sin metadatos. Como mucho ${MAXIMO_ARCHIVOS} por partido.`,
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: {
          201: json(EsquemaArchivos, 'Archivo subido; devuelve todos los del partido'),
          400: json(EsquemaError, 'Falta el archivo o hay demasiados'),
          413: json(EsquemaError, 'Supera el límite'),
          415: json(EsquemaError, 'Tipo no admitido'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        // Antes de recibir nada: no tiene sentido subir 15 MB para rechazarlos
        if ((await contar(db, pid)) >= MAXIMO_ARCHIVOS) throw demasiados()

        const subida = await recibirArchivo(c.req.raw, 'planificacion')
        const carpeta = carpetaDePartido(plantillaId, pid)
        let guardado: { archivo: string; mime: string; tamanoBytes: number }
        if (subida.tipo.tipo === 'pdf') {
          const archivo = nueva(carpeta, 'pdf')
          await mover(subida.temporal, archivo)
          guardado = { archivo, mime: subida.tipo.mime, tamanoBytes: subida.bytes }
        } else {
          guardado = await procesarFoto(subida.temporal, carpeta, false)
        }

        try {
          await db.transaction(async (tx) => {
            // Dos subidas a la vez van una detrás de otra: el máximo se respeta
            await bloquearPartido(tx, pid)
            if ((await contar(tx, pid)) >= MAXIMO_ARCHIVOS) throw demasiados()
            await tx.insert(archivosPartido).values({
              partidoId: pid,
              titulo: limpiarTitulo(subida.campos.titulo),
              nombreOriginal: limpiarNombre(subida.nombre, subida.tipo.extension),
              ...guardado,
              subidoPor: c.var.usuario.id,
            })
          })
        } catch (error) {
          // También si el partido se borró mientras tanto
          await borrar(guardado.archivo)
          throw error
        }
        return c.json(await archivosDelPartido(pid), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/partidos/{pid}/archivos/{aid}',
        tags: ['Partidos'],
        summary: 'Cambiar el título de un archivo',
        description: 'Delegado o superior. Un título vacío lo quita.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamArchivo,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    titulo: z
                      .string()
                      .trim()
                      .max(
                        LARGO_TITULO,
                        `El título no puede tener más de ${LARGO_TITULO} caracteres`,
                      )
                      .nullable(),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaArchivos, 'Título cambiado; devuelve todos los del partido'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, aid } = c.req.valid('param')
        const { titulo } = c.req.valid('json')
        await buscarPartido(c.var.plantilla.id, pid)
        const cambiados = await db
          .update(archivosPartido)
          .set({ titulo: titulo || null })
          .where(and(eq(archivosPartido.id, aid), eq(archivosPartido.partidoId, pid)))
          .returning({ id: archivosPartido.id })
        if (cambiados.length === 0) throw noEncontrado()
        return c.json(await archivosDelPartido(pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/archivos/{aid}',
        tags: ['Partidos'],
        summary: 'Quitar un archivo',
        description: 'Delegado o superior. Lo borra también del disco.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamArchivo },
        responses: {
          200: json(EsquemaArchivos, 'Archivo quitado; devuelve los que quedan'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, aid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        const [borrado] = await db
          .delete(archivosPartido)
          .where(and(eq(archivosPartido.id, aid), eq(archivosPartido.partidoId, pid)))
          .returning({ archivo: archivosPartido.archivo })
        if (!borrado) throw noEncontrado()
        await borrar(borrado.archivo)
        return c.json(await archivosDelPartido(pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/archivos/{aid}',
        tags: ['Partidos'],
        summary: 'Descargar un archivo de planificación',
        description:
          'Delegado o superior. Se sirve para abrirlo en el navegador (`inline`) con su nombre original.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamArchivo },
        responses: {
          200: {
            description: 'El archivo',
            content: {
              'application/pdf': { schema: z.string().openapi({ format: 'binary' }) },
              'image/webp': { schema: z.string().openapi({ format: 'binary' }) },
            },
          },
          ...errores,
        },
      }),
      async (c) => {
        const { pid, aid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        const [fila] = await db
          .select({
            archivo: archivosPartido.archivo,
            mime: archivosPartido.mime,
            nombreOriginal: archivosPartido.nombreOriginal,
          })
          .from(archivosPartido)
          .where(and(eq(archivosPartido.id, aid), eq(archivosPartido.partidoId, pid)))
        if (!fila) throw noEncontrado()
        const ruta = absoluta(fila.archivo)
        const info = await stat(ruta).catch(() => null)
        if (!info) throw noEncontrado()
        // Una foto se guarda como WebP: el nombre que se descarga lleva esa extensión
        const nombre =
          fila.mime === 'image/webp'
            ? `${fila.nombreOriginal.replace(/\.[^.]*$/, '')}.webp`
            : fila.nombreOriginal
        const flujo = Readable.toWeb(createReadStream(ruta)) as ReadableStream
        return c.body(flujo, 200, {
          'content-type': fila.mime,
          'content-length': String(info.size),
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(nombre)}`,
          'x-content-type-options': 'nosniff',
          // Solo cuerpo técnico: que no se quede en cachés compartidas
          'cache-control': 'private, no-cache',
        })
      },
    )
