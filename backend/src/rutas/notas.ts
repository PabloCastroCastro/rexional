import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { notasPartido, tipoNota, user } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { bloquearPartido } from '../estadisticas.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import { buscarPartido, errores, json, ParamPartido } from './partidos.js'

// Notas del cuerpo técnico durante el partido (GH-149): tácticas, incidencias u otras, con minuto
// opcional. Van aparte del detalle del partido, que ve cualquier miembro: estas rutas son solo para
// delegado o superior, así que un jugador nunca las recibe

export const MAXIMO_NOTAS = 200

const EsquemaTipoNota = z.enum(tipoNota.enumValues).openapi('TipoNota')

const EsquemaTexto = z
  .string()
  .trim()
  .min(1, 'Escribe la nota')
  .max(1000, 'La nota no puede tener más de 1000 caracteres')

const EsquemaMinuto = z.int().min(0).max(150)

export const EsquemaNota = z
  .object({
    id: z.uuid(),
    tipo: EsquemaTipoNota,
    texto: z.string(),
    minuto: z.int().nullable(),
    autor: z.string().nullable().openapi({ description: 'Nombre de quien la escribió' }),
    autorId: z.uuid().nullable(),
    creadaEn: z.string(),
    editadaEn: z.string(),
  })
  .openapi('NotaPartido')

const EsquemaNotas = z.array(EsquemaNota)

const ParamNota = ParamPartido.extend({
  nid: EsquemaUuid.openapi({ param: { name: 'nid', in: 'path' } }),
})

const noEncontrada = () => new ErrorApi(404, 'no_encontrada', 'No existe esa nota en el partido')

// Por minuto; las que no tienen minuto, al final. A igual minuto, por orden de alta
export async function notasDelPartido(partidoId: string) {
  const filas = await db
    .select({
      id: notasPartido.id,
      tipo: notasPartido.tipo,
      texto: notasPartido.texto,
      minuto: notasPartido.minuto,
      autor: user.name,
      autorId: notasPartido.autorId,
      creadaEn: notasPartido.createdAt,
      editadaEn: notasPartido.updatedAt,
    })
    .from(notasPartido)
    .leftJoin(user, eq(user.id, notasPartido.autorId))
    .where(eq(notasPartido.partidoId, partidoId))
    .orderBy(sql`${notasPartido.minuto} asc nulls last`, asc(notasPartido.createdAt))
  return filas.map((n) => ({
    ...n,
    creadaEn: n.creadaEn.toISOString(),
    editadaEn: n.editadaEn.toISOString(),
  }))
}

export const rutasNotas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/notas',
        tags: ['Partidos'],
        summary: 'Notas del partido',
        description: 'Delegado o superior. Ordenadas por minuto; las que no tienen, al final.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 200: json(EsquemaNotas, 'Notas del partido'), ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        return c.json(await notasDelPartido(pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/notas',
        tags: ['Partidos'],
        summary: 'Anotar',
        description: `Delegado o superior. Como mucho ${MAXIMO_NOTAS} notas por partido.`,
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    tipo: EsquemaTipoNota,
                    texto: EsquemaTexto,
                    minuto: EsquemaMinuto.nullish(),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaNotas, 'Nota añadida; devuelve todas las del partido'),
          400: json(EsquemaError, 'Datos no válidos o demasiadas notas'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const { tipo, texto, minuto } = c.req.valid('json')
        await buscarPartido(c.var.plantilla.id, pid)
        await db.transaction(async (tx) => {
          // Dos altas a la vez van una detrás de otra: el máximo se respeta
          await bloquearPartido(tx, pid)
          const [{ n } = { n: 0 }] = await tx
            .select({ n: count() })
            .from(notasPartido)
            .where(eq(notasPartido.partidoId, pid))
          if (n >= MAXIMO_NOTAS) {
            throw new ErrorApi(
              400,
              'demasiadas_notas',
              `Un partido puede tener como mucho ${MAXIMO_NOTAS} notas`,
            )
          }
          await tx.insert(notasPartido).values({
            partidoId: pid,
            tipo,
            texto,
            minuto: minuto ?? null,
            autorId: c.var.usuario.id,
          })
        })
        return c.json(await notasDelPartido(pid), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/partidos/{pid}/notas/{nid}',
        tags: ['Partidos'],
        summary: 'Cambiar una nota',
        description:
          'Delegado o superior, aunque la escribiera otro. El tipo, el texto o el minuto; un minuto null lo quita.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamNota,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    tipo: EsquemaTipoNota.optional(),
                    texto: EsquemaTexto.optional(),
                    minuto: EsquemaMinuto.nullish(),
                  })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica qué cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaNotas, 'Nota cambiada; devuelve todas las del partido'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, nid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        await buscarPartido(c.var.plantilla.id, pid)
        const cambiadas = await db
          .update(notasPartido)
          .set(cambios)
          .where(and(eq(notasPartido.id, nid), eq(notasPartido.partidoId, pid)))
          .returning({ id: notasPartido.id })
        if (cambiadas.length === 0) throw noEncontrada()
        return c.json(await notasDelPartido(pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/notas/{nid}',
        tags: ['Partidos'],
        summary: 'Borrar una nota',
        description: 'Delegado o superior, aunque la escribiera otro.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamNota },
        responses: {
          200: json(EsquemaNotas, 'Nota borrada; devuelve las que quedan'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, nid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        const borradas = await db
          .delete(notasPartido)
          .where(and(eq(notasPartido.id, nid), eq(notasPartido.partidoId, pid)))
          .returning({ id: notasPartido.id })
        if (borradas.length === 0) throw noEncontrada()
        return c.json(await notasDelPartido(pid), 200)
      },
    )
