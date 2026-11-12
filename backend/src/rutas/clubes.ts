import { readFile } from 'node:fs/promises'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, exists, or, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { adminsClub, clubes, membresias, plantillas, user } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { absoluta, borrar, carpetaDeEscudo } from '../medios/almacen.js'
import { procesarEscudo } from '../medios/procesar.js'
import { recibirArchivo } from '../medios/subida.js'
import { type EnvClub, requireAdminClub, requireRolEnClub, requireSesion } from '../permisos.js'
import { registrarEvento } from '../seguridad.js'
import { EsquemaTexto, EsquemaUuid } from '../validacion.js'

// Clubes y sus administradores (sección 7). Las plantillas tienen sus propias rutas en plantillas.ts.

export const EsquemaClub = z
  .object({
    id: z.uuid(),
    nombre: z.string(),
    escudo: z.string().nullable().openapi({
      description:
        'URL del escudo (cambia con cada escudo nuevo, así se puede guardar en caché); null si no tiene',
      example: '/api/clubes/0199…/escudo?v=0199…',
    }),
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

// Color en hexadecimal (#rrggbb), guardado en minúsculas; null vuelve al color por defecto (GH-27)
const EsquemaColor = (campo: string) =>
  z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, `${campo} debe ser un color en hexadecimal, como #14553d`)
    .transform((c) => c.toLowerCase())
    .nullable()
    .optional()
    .openapi({ example: '#14553d', description: `${campo}; null vuelve al de por defecto` })

const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })

// URL del escudo (GH-28): en la base de datos está la ruta del archivo, y la URL lleva su nombre como
// versión, así que cambia con cada escudo nuevo
export const urlEscudo = sql<string | null>`case when ${clubes.escudo} is null then null
  else '/api/clubes/' || ${clubes.id} || '/escudo?v=' || split_part(regexp_replace(${clubes.escudo}, '^.*/', ''), '.', 1) end`

const columnasClub = {
  id: clubes.id,
  nombre: clubes.nombre,
  escudo: urlEscudo,
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
        summary: 'Cambiar el nombre o los colores del club',
        description:
          'Solo los administradores del club. Los colores, en hexadecimal (#rrggbb), son comunes a todas las plantillas del club; con null vuelven a los de por defecto. El escudo tiene su propia ruta.',
        middleware: [requireAdminClub()] as const,
        request: {
          params: ParamClub,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    nombre: EsquemaTexto('El nombre').optional(),
                    colorPrincipal: EsquemaColor('El color principal'),
                    colorSecundario: EsquemaColor('El color secundario'),
                  })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica el nombre o algún color',
                  }),
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
        const { nombre, colorPrincipal, colorSecundario } = c.req.valid('json')
        // null restablece el valor por defecto de la columna
        const color = (valor: string | null | undefined) => (valor === null ? sql`default` : valor)
        const [club] = await db
          .update(clubes)
          .set({
            nombre,
            colorPrincipal: color(colorPrincipal),
            colorSecundario: color(colorSecundario),
          })
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
        method: 'delete',
        path: '/clubes/{cid}/admins/{uid}',
        tags: ['Clubes'],
        summary: 'Retirar un administrador',
        description:
          'Un club nunca se queda sin administradores. Para añadir uno, se le invita (`POST /clubes/{cid}/invitaciones`).',
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
        registrarEvento('admin_club_retirado', {
          usuarioId: c.var.usuario.id,
          clubId: c.var.club.id,
          retiradoId: uid,
        })
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/clubes/{cid}/escudo',
        tags: ['Clubes'],
        summary: 'Subir o cambiar el escudo del club',
        description:
          'Solo los administradores del club. Multipart, en el campo «archivo»: PNG o WebP (se comprueba el contenido, no la extensión), hasta MAX_ESCUDO_MB (2 MB por defecto). Se guarda como WebP de hasta 512 px por lado, sin recortar y sin metadatos; el anterior se borra.',
        middleware: [requireAdminClub()] as const,
        request: { params: ParamClub },
        responses: {
          200: json(EsquemaClub, 'Club con el escudo nuevo'),
          400: json(EsquemaError, 'Falta el archivo'),
          413: json(EsquemaError, 'Demasiado grande'),
          415: json(EsquemaError, 'No es PNG ni WebP'),
          ...errores,
        },
      }),
      async (c) => {
        const clubId = c.var.club.id
        const subida = await recibirArchivo(c.req.raw, 'escudo')
        const nuevo = await procesarEscudo(subida.temporal, carpetaDeEscudo(clubId))
        const [anterior] = await db
          .select({ escudo: clubes.escudo })
          .from(clubes)
          .where(eq(clubes.id, clubId))
        const [club] = await db
          .update(clubes)
          .set({ escudo: nuevo })
          .where(eq(clubes.id, clubId))
          .returning(columnasClub)
        if (!club) {
          await borrar(nuevo)
          throw new ErrorApi(404, 'no_encontrado', 'No existe el club')
        }
        await borrar(anterior?.escudo)
        return c.json({ ...club, esAdmin: true }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/escudo',
        tags: ['Clubes'],
        summary: 'Quitar el escudo del club',
        description: 'Solo los administradores del club. Vuelve el logo genérico.',
        middleware: [requireAdminClub()] as const,
        request: { params: ParamClub },
        responses: { 200: json(EsquemaClub, 'Club sin escudo'), ...errores },
      }),
      async (c) => {
        const clubId = c.var.club.id
        const [anterior] = await db
          .select({ escudo: clubes.escudo })
          .from(clubes)
          .where(eq(clubes.id, clubId))
        const [club] = await db
          .update(clubes)
          .set({ escudo: null })
          .where(eq(clubes.id, clubId))
          .returning(columnasClub)
        if (!club) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')
        await borrar(anterior?.escudo)
        return c.json({ ...club, esAdmin: true }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/escudo',
        tags: ['Clubes'],
        summary: 'Escudo del club',
        description:
          'Cualquier miembro de una plantilla del club. WebP con caché larga: la URL que dan las respuestas (con ?v=) cambia con cada escudo nuevo.',
        middleware: [requireRolEnClub('jugador')] as const,
        request: {
          params: ParamClub,
          query: z.object({
            v: z
              .string()
              .max(64)
              .optional()
              .openapi({ param: { name: 'v', in: 'query' } }),
          }),
        },
        responses: {
          200: {
            description: 'El escudo',
            content: { 'image/webp': { schema: z.string().openapi({ format: 'binary' }) } },
          },
          ...errores,
        },
      }),
      async (c) => {
        const [club] = await db
          .select({ escudo: clubes.escudo })
          .from(clubes)
          .where(eq(clubes.id, c.var.club.id))
        const contenido = club?.escudo
          ? await readFile(absoluta(club.escudo)).catch(() => null)
          : null
        if (!contenido) throw new ErrorApi(404, 'no_encontrado', 'El club no tiene escudo')
        return c.body(new Uint8Array(contenido), 200, {
          'content-type': 'image/webp',
          'cache-control': 'private, max-age=31536000, immutable',
        }) as never
      },
    )
