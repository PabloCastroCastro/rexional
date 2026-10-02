import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, exists, or } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { adminsClub, clubes, membresias, plantillas, user } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvClub, requireAdminClub, requireRolEnClub, requireSesion } from '../permisos.js'
import { EsquemaTexto, EsquemaUuid } from '../validacion.js'

// Clubes y sus administradores (sección 7). Las plantillas tienen sus propias rutas en plantillas.ts.

export const EsquemaClub = z
  .object({
    id: z.uuid(),
    nombre: z.string(),
    escudo: z.string().nullable(),
    colorPrincipal: z.string().openapi({ example: '#14553d' }),
    colorSecundario: z.string().openapi({ example: '#f2c230' }),
    esAdmin: z.boolean().openapi({ description: 'Si el usuario es administrador del club' }),
  })
  .openapi('Club')

const EsquemaAdministrador = z
  .object({ usuarioId: z.uuid(), nombre: z.string(), email: z.email() })
  .openapi('AdministradorClub')

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })

const columnasClub = {
  id: clubes.id,
  nombre: clubes.nombre,
  escudo: clubes.escudo,
  colorPrincipal: clubes.colorPrincipal,
  colorSecundario: clubes.colorSecundario,
}

async function listaAdministradores(clubId: string) {
  return db
    .select({ usuarioId: user.id, nombre: user.name, email: user.email })
    .from(adminsClub)
    .innerJoin(user, eq(user.id, adminsClub.usuarioId))
    .where(eq(adminsClub.clubId, clubId))
    .orderBy(asc(user.name))
}

export const rutasClubes = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes',
        tags: ['Clubes'],
        summary: 'Mis clubes',
        description:
          'Clubes que el usuario administra o en los que tiene un rol en alguna plantilla. Incluye los clubes sin plantillas que administra.',
        middleware: [requireSesion()] as const,
        responses: { 200: json(z.array(EsquemaClub), 'Clubes del usuario'), 401: errores[401] },
      }),
      async (c) => {
        const usuarioId = c.var.usuario.id
        const filas = await db
          .select({ ...columnasClub, adminId: adminsClub.usuarioId })
          .from(clubes)
          .leftJoin(
            adminsClub,
            and(eq(adminsClub.clubId, clubes.id), eq(adminsClub.usuarioId, usuarioId)),
          )
          .where(
            or(
              eq(adminsClub.usuarioId, usuarioId),
              exists(
                db
                  .select({ uno: membresias.plantillaId })
                  .from(membresias)
                  .innerJoin(plantillas, eq(plantillas.id, membresias.plantillaId))
                  .where(
                    and(eq(plantillas.clubId, clubes.id), eq(membresias.usuarioId, usuarioId)),
                  ),
              ),
            ),
          )
          .orderBy(asc(clubes.nombre))
        return c.json(
          filas.map(({ adminId, ...club }) => ({ ...club, esAdmin: adminId !== null })),
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes',
        tags: ['Clubes'],
        summary: 'Crear un club',
        description: 'Quien lo crea pasa a ser su administrador, en la misma transacción.',
        middleware: [requireSesion()] as const,
        request: {
          body: {
            content: {
              'application/json': { schema: z.object({ nombre: EsquemaTexto('El nombre') }) },
            },
          },
        },
        responses: {
          201: json(EsquemaClub, 'Club creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          401: errores[401],
        },
      }),
      async (c) => {
        const { nombre } = c.req.valid('json')
        const club = await db.transaction(async (tx) => {
          const [nuevo] = await tx
            .insert(clubes)
            .values({ nombre, creadoPor: c.var.usuario.id })
            .returning(columnasClub)
          if (!nuevo) throw new Error('No se pudo crear el club')
          await tx.insert(adminsClub).values({ clubId: nuevo.id, usuarioId: c.var.usuario.id })
          return nuevo
        })
        return c.json({ ...club, esAdmin: true }, 201)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}',
        tags: ['Clubes'],
        summary: 'Datos e identidad visual de un club',
        middleware: [requireRolEnClub('jugador')] as const,
        request: { params: ParamClub },
        responses: { 200: json(EsquemaClub, 'Club'), ...errores },
      }),
      async (c) => {
        const [club] = await db
          .select(columnasClub)
          .from(clubes)
          .where(eq(clubes.id, c.var.club.id))
        if (!club) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')
        return c.json({ ...club, esAdmin: c.var.esAdminClub }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/clubes/{cid}',
        tags: ['Clubes'],
        summary: 'Cambiar el nombre del club',
        description:
          'Solo los administradores del club. El escudo y los colores llegan en el ciclo 5.',
        middleware: [requireAdminClub()] as const,
        request: {
          params: ParamClub,
          body: {
            content: {
              'application/json': {
                schema: z.object({ nombre: EsquemaTexto('El nombre') }).strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaClub, 'Club actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { nombre } = c.req.valid('json')
        const [club] = await db
          .update(clubes)
          .set({ nombre })
          .where(eq(clubes.id, c.var.club.id))
          .returning(columnasClub)
        if (!club) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')
        return c.json({ ...club, esAdmin: true }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/admins',
        tags: ['Clubes'],
        summary: 'Administradores del club',
        middleware: [requireAdminClub()] as const,
        request: { params: ParamClub },
        responses: { 200: json(z.array(EsquemaAdministrador), 'Administradores'), ...errores },
      }),
      async (c) => c.json(await listaAdministradores(c.var.club.id), 200),
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/admins',
        tags: ['Clubes'],
        summary: 'Añadir un administrador',
        description: 'El usuario debe existir. Las invitaciones por email llegan en el ciclo 9.',
        middleware: [requireAdminClub()] as const,
        request: {
          params: ParamClub,
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  email: z.string().trim().toLowerCase().pipe(z.email('Email no válido')),
                }),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaAdministrador, 'Administrador añadido'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya es administrador'),
          ...errores,
        },
      }),
      async (c) => {
        const { email } = c.req.valid('json')
        const [usuario] = await db
          .select({ usuarioId: user.id, nombre: user.name, email: user.email })
          .from(user)
          .where(eq(user.email, email))
        if (!usuario)
          throw new ErrorApi(
            404,
            'usuario_no_encontrado',
            `No hay ningún usuario con el email ${email}`,
          )
        const insertados = await db
          .insert(adminsClub)
          .values({ clubId: c.var.club.id, usuarioId: usuario.usuarioId })
          .onConflictDoNothing()
          .returning()
        if (insertados.length === 0) {
          throw new ErrorApi(
            409,
            'ya_es_administrador',
            `${usuario.nombre} ya es administrador del club`,
          )
        }
        return c.json(usuario, 201)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/admins/{uid}',
        tags: ['Clubes'],
        summary: 'Retirar un administrador',
        description: 'Un club nunca se queda sin administradores.',
        middleware: [requireAdminClub()] as const,
        request: {
          params: ParamClub.extend({
            uid: EsquemaUuid.openapi({ param: { name: 'uid', in: 'path' } }),
          }),
        },
        responses: {
          204: { description: 'Administrador retirado' },
          409: json(EsquemaError, 'Es el último administrador'),
          ...errores,
        },
      }),
      async (c) => {
        const { uid } = c.req.valid('param')
        await db.transaction(async (tx) => {
          // Se bloquean los administradores del club para que dos retiradas a la vez no lo dejen sin ninguno
          const actuales = await tx
            .select({ usuarioId: adminsClub.usuarioId })
            .from(adminsClub)
            .where(eq(adminsClub.clubId, c.var.club.id))
            .for('update')
          if (!actuales.some((a) => a.usuarioId === uid)) {
            throw new ErrorApi(404, 'no_encontrado', 'Ese usuario no es administrador del club')
          }
          if (actuales.length === 1) {
            throw new ErrorApi(
              409,
              'ultimo_administrador',
              'Un club no puede quedarse sin administradores',
            )
          }
          await tx
            .delete(adminsClub)
            .where(and(eq(adminsClub.clubId, c.var.club.id), eq(adminsClub.usuarioId, uid)))
        })
        return c.body(null, 204)
      },
    )
