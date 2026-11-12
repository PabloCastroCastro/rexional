import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, isNotNull, or } from 'drizzle-orm'
import { crearCatalogo } from '../catalogoMultas.js'
import { db } from '../db/cliente.js'
import {
  adminsClub,
  clubes,
  fichas,
  jugadores,
  membresias,
  plantillas,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { borrarCarpeta, carpetaDePlantilla } from '../medios/almacen.js'
import { type EnvPlantilla, type Rol, requireRol, requireSesion } from '../permisos.js'
import { EsquemaTemporada, EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'
import { urlEscudo } from './clubes.js'
import { altaEnLote, EsquemaJugadoresLote, errorDeLote } from './fichaEquipo.js'

// Plantillas: una categoría del club en una temporada (secciones 2.1 y 7). Todas sus rutas cuelgan de
// /plantillas; al crearla, el club va en el cuerpo.

const ROLES = ['admin', 'entrenador', 'delegado', 'jugador'] as const

export const EsquemaPlantilla = z
  .object({
    id: z.uuid(),
    clubId: z.uuid(),
    nombre: z.string().openapi({ example: 'Senior' }),
    categoria: z.string().openapi({ example: 'sénior' }),
    temporada: z.string().openapi({ example: '2026-27' }),
    plantillaAnteriorId: z.uuid().nullable(),
    multasActivas: z.boolean().openapi({
      description: 'false si la plantilla no usa multas (no se ven ni se pueden poner)',
    }),
    horasLimiteRespuesta: z.int().openapi({
      description:
        'Horas antes del inicio de cada entreno hasta las que los jugadores pueden responder si van (GH-204)',
    }),
    rol: z.enum(ROLES).openapi({ description: 'Rol efectivo del usuario en la plantilla' }),
    esAdminClub: z.boolean(),
    jugadorId: z.uuid().nullable().openapi({
      description:
        'Jugador vinculado al usuario si tiene ficha (activa o de baja) en esta plantilla; si no, null',
    }),
  })
  .openapi('Plantilla')

const EsquemaPlantillaConClub = EsquemaPlantilla.extend({
  club: z.object({
    id: z.uuid(),
    nombre: z.string(),
    escudo: z.string().nullable(),
    colorPrincipal: z.string(),
    colorSecundario: z.string(),
  }),
}).openapi('PlantillaConClub')

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamPlantilla = z.object({ id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }) })

const columnasPlantilla = {
  id: plantillas.id,
  clubId: plantillas.clubId,
  nombre: plantillas.nombre,
  categoria: plantillas.categoria,
  temporada: plantillas.temporada,
  plantillaAnteriorId: plantillas.plantillaAnteriorId,
  multasActivas: plantillas.multasActivas,
  horasLimiteRespuesta: plantillas.horasLimiteRespuesta,
}

// Jugador del usuario (el vinculado en el club) si tiene ficha en la plantilla; si no, null
async function fichaDelUsuario(plantillaId: string, jugadorId: string | null) {
  if (!jugadorId) return null
  const [ficha] = await db
    .select({ jugadorId: fichas.jugadorId })
    .from(fichas)
    .where(and(eq(fichas.plantillaId, plantillaId), eq(fichas.jugadorId, jugadorId)))
  return ficha?.jugadorId ?? null
}

const plantillaDuplicada = (nombre: string, temporada: string) =>
  new ErrorApi(
    409,
    'plantilla_duplicada',
    `El club ya tiene una plantilla "${nombre}" en la temporada ${temporada}`,
  )

export const rutasPlantillas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas',
        tags: ['Plantillas'],
        summary: 'Mis plantillas',
        description:
          'Plantillas en las que el usuario tiene un rol y todas las de los clubes que administra, ordenadas por club, temporada (la más reciente primero) y nombre. Con `club`, solo las de ese club.',
        middleware: [requireSesion()] as const,
        request: {
          query: z.object({
            club: EsquemaUuid.optional().openapi({ param: { name: 'club', in: 'query' } }),
          }),
        },
        responses: {
          200: json(z.array(EsquemaPlantillaConClub), 'Plantillas'),
          400: json(EsquemaError, 'Datos no válidos'),
          401: errores[401],
        },
      }),
      async (c) => {
        const usuarioId = c.var.usuario.id
        const { club } = c.req.valid('query')
        const filas = await db
          .select({
            ...columnasPlantilla,
            rolMembresia: membresias.rol,
            adminClub: adminsClub.usuarioId,
            jugadorId: fichas.jugadorId,
            club: {
              id: clubes.id,
              nombre: clubes.nombre,
              escudo: urlEscudo,
              colorPrincipal: clubes.colorPrincipal,
              colorSecundario: clubes.colorSecundario,
            },
          })
          .from(plantillas)
          .innerJoin(clubes, eq(clubes.id, plantillas.clubId))
          .leftJoin(
            membresias,
            and(eq(membresias.plantillaId, plantillas.id), eq(membresias.usuarioId, usuarioId)),
          )
          .leftJoin(
            adminsClub,
            and(eq(adminsClub.clubId, plantillas.clubId), eq(adminsClub.usuarioId, usuarioId)),
          )
          // Su ficha en la plantilla, si su cuenta está vinculada a un jugador del club
          .leftJoin(
            jugadores,
            and(eq(jugadores.clubId, plantillas.clubId), eq(jugadores.usuarioId, usuarioId)),
          )
          .leftJoin(
            fichas,
            and(eq(fichas.plantillaId, plantillas.id), eq(fichas.jugadorId, jugadores.id)),
          )
          .where(
            and(
              or(isNotNull(membresias.usuarioId), isNotNull(adminsClub.usuarioId)),
              club ? eq(plantillas.clubId, club) : undefined,
            ),
          )
          .orderBy(
            asc(clubes.nombre),
            asc(clubes.id),
            desc(plantillas.temporada),
            asc(plantillas.nombre),
          )

        return c.json(
          filas.map(({ rolMembresia, adminClub, ...p }) => ({
            ...p,
            esAdminClub: adminClub !== null,
            rol: (adminClub !== null ? 'admin' : rolMembresia) as Rol,
          })),
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas',
        tags: ['Plantillas'],
        summary: 'Crear una plantilla',
        description:
          'Solo los administradores del club. Para la temporada siguiente, indica la plantilla anterior (del mismo club y de una temporada anterior): su catálogo de multas se copia; si no hay anterior, se crea el catálogo por defecto.',
        middleware: [requireSesion()] as const,
        request: {
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  clubId: EsquemaUuid,
                  nombre: EsquemaTexto('El nombre'),
                  categoria: EsquemaTexto('La categoría'),
                  temporada: EsquemaTemporada,
                  plantillaAnteriorId: EsquemaUuid.nullable().optional(),
                  jugadores: EsquemaJugadoresLote.optional().openapi({
                    description:
                      'Jugadores con ficha propia desde el principio (de la ficha de la federación, GH-197): del club o nuevos. Si alguno ya tiene ficha propia esa temporada, no se crea nada.',
                  }),
                }),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaPlantilla, 'Plantilla creada'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya existe una plantilla con ese nombre en la temporada'),
          ...errores,
        },
      }),
      async (c) => {
        const { jugadores, ...datos } = c.req.valid('json')
        const usuarioId = c.var.usuario.id

        const [club] = await db
          .select({ id: clubes.id, adminId: adminsClub.usuarioId })
          .from(clubes)
          .leftJoin(
            adminsClub,
            and(eq(adminsClub.clubId, clubes.id), eq(adminsClub.usuarioId, usuarioId)),
          )
          .where(eq(clubes.id, datos.clubId))
        if (!club) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')
        if (club.adminId === null) {
          throw new ErrorApi(
            403,
            'sin_permiso',
            'Solo los administradores del club pueden crear plantillas',
          )
        }

        let multasActivas = true
        if (datos.plantillaAnteriorId) {
          const [anterior] = await db
            .select({
              clubId: plantillas.clubId,
              temporada: plantillas.temporada,
              multasActivas: plantillas.multasActivas,
            })
            .from(plantillas)
            .where(eq(plantillas.id, datos.plantillaAnteriorId))
          if (
            !anterior ||
            anterior.clubId !== datos.clubId ||
            anterior.temporada >= datos.temporada
          ) {
            throw new ErrorApi(
              400,
              'plantilla_anterior_no_valida',
              'La plantilla anterior debe ser del mismo club y de una temporada anterior',
            )
          }
          // Si la anterior no usaba multas, la nueva tampoco (los alevines siguen sin multas)
          multasActivas = anterior.multasActivas
        }

        try {
          // La plantilla, su catálogo de multas y sus jugadores, en la misma transacción
          const plantilla = await db.transaction(async (tx) => {
            const [creada] = await tx
              .insert(plantillas)
              .values({
                ...datos,
                plantillaAnteriorId: datos.plantillaAnteriorId ?? null,
                multasActivas,
                creadoPor: usuarioId,
              })
              .returning(columnasPlantilla)
            if (!creada) throw new Error('No se pudo crear la plantilla')
            await crearCatalogo(tx, creada.id, creada.plantillaAnteriorId)
            if (jugadores?.length) await altaEnLote(tx, creada, jugadores)
            return creada
          })
          return c.json(
            { ...plantilla, rol: 'admin' as const, esAdminClub: true, jugadorId: null },
            201,
          )
        } catch (error) {
          if (restriccionViolada(error) === 'plantillas_nombre_unico') {
            throw plantillaDuplicada(datos.nombre, datos.temporada)
          }
          throw errorDeLote(error)
        }
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}',
        tags: ['Plantillas'],
        summary: 'Una plantilla',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(EsquemaPlantilla, 'Plantilla'), ...errores },
      }),
      async (c) => {
        const [plantilla] = await db
          .select(columnasPlantilla)
          .from(plantillas)
          .where(eq(plantillas.id, c.var.plantilla.id))
        if (!plantilla) throw new ErrorApi(404, 'no_encontrado', 'No existe la plantilla')
        return c.json(
          {
            ...plantilla,
            rol: c.var.rol,
            esAdminClub: c.var.esAdminClub,
            jugadorId: await fichaDelUsuario(plantilla.id, c.var.jugadorId),
          },
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}',
        tags: ['Plantillas'],
        summary: 'Cambiar el nombre, la categoría, si usa multas o la hora límite de respuesta',
        description:
          'Entrenador o superior. La temporada no se modifica. Desactivar las multas las oculta y bloquea sin borrar nada: al reactivarlas vuelven como estaban.',
        middleware: [requireRol('entrenador')] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    nombre: EsquemaTexto('El nombre').optional(),
                    categoria: EsquemaTexto('La categoría').optional(),
                    multasActivas: z.boolean().optional(),
                    horasLimiteRespuesta: z
                      .int('La hora límite son horas enteras')
                      .min(0, 'La hora límite va de 0 a 72 horas')
                      .max(72, 'La hora límite va de 0 a 72 horas')
                      .optional(),
                  })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message:
                      'Indica el nombre, la categoría, si usa multas o la hora límite de respuesta',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPlantilla, 'Plantilla actualizada'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya existe una plantilla con ese nombre en la temporada'),
          ...errores,
        },
      }),
      async (c) => {
        const cambios = c.req.valid('json')
        try {
          const [plantilla] = await db
            .update(plantillas)
            .set(cambios)
            .where(eq(plantillas.id, c.var.plantilla.id))
            .returning(columnasPlantilla)
          if (!plantilla) throw new ErrorApi(404, 'no_encontrado', 'No existe la plantilla')
          return c.json(
            {
              ...plantilla,
              rol: c.var.rol,
              esAdminClub: c.var.esAdminClub,
              jugadorId: await fichaDelUsuario(plantilla.id, c.var.jugadorId),
            },
            200,
          )
        } catch (error) {
          if (restriccionViolada(error) === 'plantillas_nombre_unico') {
            throw plantillaDuplicada(cambios.nombre ?? '', c.var.plantilla.temporada)
          }
          throw error
        }
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}',
        tags: ['Plantillas'],
        summary: 'Borrar una plantilla',
        description:
          'Solo los administradores del club, escribiendo el nombre de la plantilla como confirmación. Borra sus fichas, cuerpo técnico y datos; los jugadores siguen en el club.',
        middleware: [requireRol('admin')] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: { 'application/json': { schema: z.object({ confirmacion: z.string() }) } },
          },
        },
        responses: {
          204: { description: 'Plantilla borrada' },
          400: json(EsquemaError, 'La confirmación no coincide con el nombre'),
          ...errores,
        },
      }),
      async (c) => {
        // Ser admin de la plantilla no basta: borrarla es cosa del administrador del club
        if (!c.var.esAdminClub) {
          throw new ErrorApi(
            403,
            'sin_permiso',
            'Solo los administradores del club pueden borrar plantillas',
          )
        }
        const { confirmacion } = c.req.valid('json')
        if (confirmacion.trim() !== c.var.plantilla.nombre) {
          throw new ErrorApi(
            400,
            'confirmacion_incorrecta',
            `Para borrar la plantilla escribe su nombre exacto: ${c.var.plantilla.nombre}`,
          )
        }
        await db.delete(plantillas).where(eq(plantillas.id, c.var.plantilla.id))
        // La planificación de sus partidos (GH-147)
        await borrarCarpeta(carpetaDePlantilla(c.var.plantilla.id))
        return c.body(null, 204)
      },
    )
