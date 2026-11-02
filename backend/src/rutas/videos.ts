import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, count, eq } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { videosPartido } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { bloquearPartido } from '../estadisticas.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import {
  buscarPartido,
  detallePartido,
  EsquemaPartido,
  errores,
  json,
  ParamPartido,
} from './partidos.js'

// Enlaces al vídeo de un partido (GH-134): el cuerpo técnico los gestiona y los ve cualquier miembro
// en el detalle del partido. Solo se guarda la URL; el vídeo se abre fuera de la app.

export const MAXIMO_VIDEOS = 10

const EsquemaUrl = z
  .url({ protocol: /^https?$/, error: 'Debe ser una dirección web (https://…)' })
  .max(2000)

// Vacío o solo espacios es «sin título»
const EsquemaTitulo = z
  .string()
  .trim()
  .max(80, 'El título no puede tener más de 80 caracteres')
  .nullish()
  .transform((t) => (t ? t : t === undefined ? undefined : null))

const ParamVideo = ParamPartido.extend({
  vid: EsquemaUuid.openapi({ param: { name: 'vid', in: 'path' } }),
})

const noEncontrado = () => new ErrorApi(404, 'no_encontrado', 'No existe ese vídeo en el partido')

export const rutasVideos = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/videos',
        tags: ['Partidos'],
        summary: 'Añadir un vídeo',
        description: `Delegado o superior. Un enlace web (YouTube, Drive…) con título opcional; como mucho ${MAXIMO_VIDEOS} por partido.`,
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z.object({ url: EsquemaUrl, titulo: EsquemaTitulo }).strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaPartido, 'Vídeo añadido'),
          400: json(EsquemaError, 'Datos no válidos o demasiados vídeos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const { url, titulo } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await db.transaction(async (tx) => {
          // Dos altas a la vez van una detrás de otra: el máximo se respeta
          await bloquearPartido(tx, pid)
          const [{ n } = { n: 0 }] = await tx
            .select({ n: count() })
            .from(videosPartido)
            .where(eq(videosPartido.partidoId, pid))
          if (n >= MAXIMO_VIDEOS) {
            throw new ErrorApi(
              400,
              'demasiados_videos',
              `Un partido puede tener como mucho ${MAXIMO_VIDEOS} vídeos`,
            )
          }
          await tx
            .insert(videosPartido)
            .values({ partidoId: pid, url, titulo: titulo ?? null, creadoPor: c.var.usuario.id })
        })
        return c.json(await detallePartido(plantillaId, pid), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/partidos/{pid}/videos/{vid}',
        tags: ['Partidos'],
        summary: 'Cambiar un vídeo',
        description: 'Delegado o superior. La URL o el título; un título vacío lo quita.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamVideo,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({ url: EsquemaUrl.optional(), titulo: EsquemaTitulo })
                  .strict()
                  .refine((d) => d.url !== undefined || d.titulo !== undefined, {
                    message: 'Indica la URL o el título',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPartido, 'Vídeo cambiado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, vid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        const cambiados = await db
          .update(videosPartido)
          .set(cambios)
          .where(and(eq(videosPartido.id, vid), eq(videosPartido.partidoId, pid)))
          .returning({ id: videosPartido.id })
        if (cambiados.length === 0) throw noEncontrado()
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/videos/{vid}',
        tags: ['Partidos'],
        summary: 'Quitar un vídeo',
        description: 'Delegado o superior. Quita el enlace; el vídeo sigue donde estuviera.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamVideo },
        responses: { 200: json(EsquemaPartido, 'Vídeo quitado'), ...errores },
      }),
      async (c) => {
        const { pid, vid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        const borrados = await db
          .delete(videosPartido)
          .where(and(eq(videosPartido.id, vid), eq(videosPartido.partidoId, pid)))
          .returning({ id: videosPartido.id })
        if (borrados.length === 0) throw noEncontrado()
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
