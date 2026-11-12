import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { adminsClub, fichas, jugadores, membresias, rol, user } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { registrarEvento } from '../seguridad.js'
import { EsquemaUuid } from '../validacion.js'
import { porNombre } from './jugadores.js'

// Miembros de la plantilla (GH-51): quién tiene acceso y con qué rol. Los administradores del club
// tienen acceso a todas sus plantillas sin membresía: salen como heredados y no se tocan desde aquí.

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamMiembro = z.object({
  id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }),
  uid: EsquemaUuid.openapi({ param: { name: 'uid', in: 'path' } }),
})

const EsquemaMiembro = z
  .object({
    usuarioId: z.uuid(),
    nombre: z.string(),
    email: z.string(),
    rol: z.enum(rol.enumValues),
    heredado: z.boolean().openapi({
      description: 'Administrador del club: es admin de todas sus plantillas sin membresía',
    }),
    jugador: z
      .string()
      .nullable()
      .openapi({ description: 'Jugador del club vinculado a su cuenta', example: 'Brais Pazos' }),
  })
  .openapi('MiembroPlantilla')

const EsquemaMiembros = z
  .object({
    miembros: z.array(EsquemaMiembro).openapi({
      description: 'Primero los administradores del club; después, por nombre',
    }),
    jugadoresSinCuenta: z.array(z.object({ jugadorId: z.uuid(), nombre: z.string() })).openapi({
      description: 'Jugadores con ficha propia activa y sin cuenta: a los que se puede invitar',
    }),
  })
  .openapi('MiembrosPlantilla')

const nombreJugador = sql<
  string | null
>`concat_ws(' ', ${jugadores.nombre}, ${jugadores.apellidos})`

const noEsMiembro = () =>
  new ErrorApi(
    404,
    'no_encontrado',
    'No es miembro de esta plantilla (los administradores del club no se cambian desde aquí)',
  )

export const rutasMiembros = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/miembros',
        tags: ['Miembros'],
        summary: 'Miembros de la plantilla',
        description:
          'Admin. Los miembros con su rol y el jugador vinculado, y los administradores del club como heredados. También los jugadores sin cuenta, para invitarlos.',
        middleware: [requireRol('admin')] as const,
        request: { params: ParamMiembro.pick({ id: true }) },
        responses: { 200: json(EsquemaMiembros, 'Miembros'), ...errores },
      }),
      async (c) => {
        const { id, clubId } = c.var.plantilla
        // El jugador vinculado, del club de la plantilla
        const vinculado = sql<string | null>`(select concat_ws(' ', j.nombre, j.apellidos)
          from jugadores j where j.usuario_id = ${user.id} and j.club_id = ${clubId})`
        const admins = await db
          .select({
            usuarioId: user.id,
            nombre: user.name,
            email: user.email,
            jugador: vinculado,
          })
          .from(adminsClub)
          .innerJoin(user, eq(user.id, adminsClub.usuarioId))
          .where(eq(adminsClub.clubId, clubId))
          .orderBy(asc(user.name))
        const miembros = await db
          .select({
            usuarioId: user.id,
            nombre: user.name,
            email: user.email,
            rol: membresias.rol,
            jugador: vinculado,
          })
          .from(membresias)
          .innerJoin(user, eq(user.id, membresias.usuarioId))
          .where(eq(membresias.plantillaId, id))
          .orderBy(asc(user.name))
        const esAdmin = new Set(admins.map((a) => a.usuarioId))
        const jugadoresSinCuenta = await db
          .select({ jugadorId: jugadores.id, nombre: sql<string>`${nombreJugador}` })
          .from(fichas)
          .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
          .where(
            and(
              eq(fichas.plantillaId, id),
              eq(fichas.tipo, 'propia'),
              eq(fichas.activo, true),
              isNull(jugadores.usuarioId),
            ),
          )
          .orderBy(...porNombre)
        return c.json(
          {
            miembros: [
              ...admins.map((a) => ({ ...a, rol: 'admin' as const, heredado: true })),
              // Un administrador del club con membresía ya sale arriba
              ...miembros
                .filter((m) => !esAdmin.has(m.usuarioId))
                .map((m) => ({ ...m, heredado: false })),
            ],
            jugadoresSinCuenta,
          },
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/miembros/{uid}',
        tags: ['Miembros'],
        summary: 'Cambiar el rol de un miembro',
        description:
          'Admin. Solo los miembros de la plantilla; los administradores del club, no. El jugador vinculado no cambia.',
        middleware: [requireRol('admin')] as const,
        request: {
          params: ParamMiembro,
          body: {
            content: {
              'application/json': {
                schema: z.object({ rol: z.enum(rol.enumValues) }).strict(),
              },
            },
          },
        },
        responses: {
          200: json(z.object({ rol: z.enum(rol.enumValues) }), 'Rol cambiado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { uid } = c.req.valid('param')
        const { rol: nuevo } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const [cambiado] = await db
          .update(membresias)
          .set({ rol: nuevo })
          .where(and(eq(membresias.plantillaId, plantillaId), eq(membresias.usuarioId, uid)))
          .returning({ rol: membresias.rol })
        if (!cambiado) throw noEsMiembro()
        registrarEvento('rol_cambiado', {
          usuarioId: c.var.usuario.id,
          plantillaId,
          miembroId: uid,
          rol: nuevo,
        })
        return c.json(cambiado, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/miembros/{uid}',
        tags: ['Miembros'],
        summary: 'Retirar el acceso a la plantilla',
        description:
          'Admin. Borra la membresía; el jugador sigue vinculado a su cuenta (es del club). Los administradores del club se retiran desde el club.',
        middleware: [requireRol('admin')] as const,
        request: { params: ParamMiembro },
        responses: { 204: { description: 'Acceso retirado' }, ...errores },
      }),
      async (c) => {
        const { uid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        const borradas = await db
          .delete(membresias)
          .where(and(eq(membresias.plantillaId, plantillaId), eq(membresias.usuarioId, uid)))
          .returning({ usuarioId: membresias.usuarioId })
        if (borradas.length === 0) throw noEsMiembro()
        registrarEvento('acceso_retirado', {
          usuarioId: c.var.usuario.id,
          plantillaId,
          miembroId: uid,
        })
        return c.body(null, 204)
      },
    )
