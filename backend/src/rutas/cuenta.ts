import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { session } from '../db/schema/index.js'
import { describirDispositivo } from '../dispositivo.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvSesion, requireSesion } from '../permisos.js'
import { ipDe, registrarEvento } from '../seguridad.js'
import { EsquemaUuid } from '../validacion.js'

// La cuenta del usuario con sesión (GH-177): sus sesiones abiertas, para cerrar las de un móvil
// perdido o de alguien que se haya hecho con la contraseña. El cambio de contraseña es de Better Auth
// (/api/auth/change-password). Las sesiones se cierran borrándolas: Better Auth comprueba la sesión
// en la base de datos en cada petición, así que dejan de valer al momento.

const EsquemaSesion = z
  .object({
    id: z.uuid(),
    actual: z.boolean().openapi({ description: 'Si es la sesión de esta petición' }),
    navegador: z.string().nullable().openapi({ example: 'Chrome' }),
    sistema: z.string().nullable().openapi({ example: 'Android' }),
    ip: z.string().nullable(),
    iniciada: z.iso.datetime({ offset: true }),
    ultimoUso: z.iso.datetime({ offset: true }),
    caduca: z.iso.datetime({ offset: true }),
  })
  .openapi('SesionAbierta')

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const ParamSesion = z.object({ id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }) })

export const rutasCuenta = () =>
  new OpenAPIHono<EnvSesion>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/cuenta/sesiones',
        tags: ['Cuenta'],
        summary: 'Mis sesiones abiertas',
        description:
          'Sesiones sin caducar del usuario, la actual primero y luego por último uso. Nunca incluye el token.',
        middleware: [requireSesion()] as const,
        responses: {
          200: json(z.array(EsquemaSesion), 'Sesiones abiertas'),
          401: json(EsquemaError, 'Sin sesión'),
        },
      }),
      async (c) => {
        const filas = await db
          .select({
            id: session.id,
            ip: session.ipAddress,
            userAgent: session.userAgent,
            iniciada: session.createdAt,
            ultimoUso: session.updatedAt,
            caduca: session.expiresAt,
          })
          .from(session)
          .where(eq(session.userId, c.var.usuario.id))
          .orderBy(desc(session.updatedAt))
        const ahora = Date.now()
        const actual = c.var.sesion.id
        const sesiones = filas
          .filter((s) => s.caduca.getTime() > ahora)
          .map(({ userAgent, ...s }) => ({
            ...s,
            ...describirDispositivo(userAgent),
            actual: s.id === actual,
            iniciada: s.iniciada.toISOString(),
            ultimoUso: s.ultimoUso.toISOString(),
            caduca: s.caduca.toISOString(),
          }))
          .sort((a, b) => Number(b.actual) - Number(a.actual))
        return c.json(sesiones, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/cuenta/sesiones/{id}',
        tags: ['Cuenta'],
        summary: 'Cerrar una de mis otras sesiones',
        description: 'La actual se cierra con /api/auth/sign-out.',
        middleware: [requireSesion()] as const,
        request: { params: ParamSesion },
        responses: {
          204: { description: 'Sesión cerrada' },
          400: json(EsquemaError, 'Es la sesión actual'),
          401: json(EsquemaError, 'Sin sesión'),
          404: json(EsquemaError, 'No es una sesión del usuario'),
        },
      }),
      async (c) => {
        const { id } = c.req.valid('param')
        if (id === c.var.sesion.id) {
          throw new ErrorApi(
            400,
            'sesion_actual',
            'Para cerrar la sesión de este dispositivo, usa «Cerrar sesión»',
          )
        }
        const cerradas = await db
          .delete(session)
          .where(and(eq(session.id, id), eq(session.userId, c.var.usuario.id)))
          .returning({ id: session.id })
        if (cerradas.length === 0) {
          throw new ErrorApi(404, 'no_encontrado', 'No tienes ninguna sesión abierta con ese id')
        }
        registrarEvento('sesion_cerrada', {
          usuarioId: c.var.usuario.id,
          ip: ipDe(c.req.raw.headers),
          remotas: 1,
        })
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/cuenta/sesiones/cerrar-otras',
        tags: ['Cuenta'],
        summary: 'Cerrar todas mis sesiones salvo la actual',
        middleware: [requireSesion()] as const,
        responses: {
          200: json(z.object({ cerradas: z.number().int() }), 'Sesiones cerradas'),
          401: json(EsquemaError, 'Sin sesión'),
        },
      }),
      async (c) => {
        const cerradas = await db
          .delete(session)
          .where(and(eq(session.userId, c.var.usuario.id), ne(session.id, c.var.sesion.id)))
          .returning({ id: session.id })
        if (cerradas.length > 0) {
          registrarEvento('sesion_cerrada', {
            usuarioId: c.var.usuario.id,
            ip: ipDe(c.req.raw.headers),
            remotas: cerradas.length,
          })
        }
        return c.json({ cerradas: cerradas.length }, 200)
      },
    )
