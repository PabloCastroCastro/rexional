import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { type AnyColumn, and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { fichas, jugadores, plantillas, posicion, tipoFicha } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import {
  type EnvClub,
  type EnvPlantilla,
  requireRol,
  requireRolEnClub,
  rolAlcanza,
} from '../permisos.js'
import { EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'

// Jugadores del club y sus fichas en cada plantilla (secciones 2.2 y 7). El jugador es del club y
// permanente; la ficha es su participación en una plantilla, con dorsal, posición y baja lógica.

export const EsquemaPosicion = z.enum(posicion.enumValues)

export const EsquemaTipoFicha = z.enum(tipoFicha.enumValues).openapi({
  description: '`propia`: es de la plantilla; `invitado`: juega con ella sin dejar la suya',
})

const EsquemaProcedencia = z
  .string()
  .trim()
  .min(1, 'Indica de dónde viene')
  .max(80, 'La procedencia admite como máximo 80 caracteres')

const EsquemaDorsal = z
  .int('El dorsal debe ser un número entero')
  .min(0, 'El dorsal debe estar entre 0 y 99')
  .max(99, 'El dorsal debe estar entre 0 y 99')
  .nullable()

export const EsquemaJugadorPlantilla = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string().openapi({ example: 'Brais' }),
    apellidos: z.string().nullable().openapi({ example: 'Méndez' }),
    dorsal: z.number().int().nullable().openapi({ example: 7 }),
    posicion: EsquemaPosicion.nullable(),
    activo: z.boolean().openapi({ description: 'false si está de baja en la plantilla' }),
    tipo: EsquemaTipoFicha,
    enDinamica: z.boolean().openapi({
      description:
        'Si va a los entrenos y tiene multas. Siempre true en las propias; en los invitados, false si solo viene a los partidos',
    }),
    procedencia: z.string().nullable().openapi({
      description:
        'De los invitados: la plantilla del club en la que tiene ficha propia esa temporada o, si no tiene, el texto de su alta',
      example: 'Juvenil A',
    }),
  })
  .openapi('JugadorPlantilla')

const EsquemaJugadorClub = z
  .object({
    id: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable().openapi({ example: 'Méndez' }),
    temporadas: z.array(z.string()).openapi({
      description: 'Temporadas en las que tiene ficha propia, la más reciente primero',
    }),
  })
  .openapi('JugadorClub')

const EsquemaInvitable = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string().openapi({ example: 'Mateo' }),
    apellidos: z.string().nullable(),
    plantilla: z
      .string()
      .openapi({ description: 'Donde tiene ficha propia', example: 'Juvenil A' }),
  })
  .openapi('JugadorInvitable')

const EsquemaTrayectoria = z
  .object({
    id: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable().openapi({ example: 'Méndez' }),
    fichas: z.array(
      z.object({
        plantillaId: z.uuid(),
        plantilla: z.string().openapi({ example: 'Juvenil A' }),
        categoria: z.string(),
        temporada: z.string().openapi({ example: '2026-27' }),
        dorsal: z.number().int().nullable(),
        posicion: EsquemaPosicion.nullable(),
        activo: z.boolean(),
        tipo: EsquemaTipoFicha,
        enDinamica: z.boolean(),
        procedencia: z.string().nullable(),
      }),
    ),
  })
  .openapi('TrayectoriaJugador')

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
const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })
const ParamJugador = { jid: EsquemaUuid.openapi({ param: { name: 'jid', in: 'path' } }) }

// Orden alfabético en español (tildes y mayúsculas; la colación de la base ordena como C): por
// apellidos y nombre, y quien no tiene apellidos, por su nombre. Se usa como .orderBy(...porNombre)
export const porNombre = [
  sql`coalesce(${jugadores.apellidos}, ${jugadores.nombre}) collate "es-x-icu"`,
  sql`${jugadores.nombre} collate "es-x-icu"`,
]

// "Brais Méndez", o solo el nombre si no tiene apellidos
export const nombreCompleto = sql<string>`concat_ws(' ', ${jugadores.nombre}, ${jugadores.apellidos})`

// Procedencia del invitado: la plantilla de su ficha propia de la temporada o, sin ella, el texto
// de su alta. De las fichas propias, null. procedenciaDe, para un alias de fichas
export const procedenciaDe = (ficha: {
  tipo: AnyColumn
  jugadorId: AnyColumn
  temporada: AnyColumn
  procedencia: AnyColumn
}) => sql<string | null>`case when ${ficha.tipo} = 'invitado' then coalesce((
  select p.nombre from fichas f join plantillas p on p.id = f.plantilla_id
  where f.jugador_id = ${ficha.jugadorId} and f.temporada = ${ficha.temporada} and f.tipo = 'propia'
), ${ficha.procedencia}) end`

export const procedenciaFicha = procedenciaDe(fichas)

export const columnasJugadorPlantilla = {
  jugadorId: jugadores.id,
  nombre: jugadores.nombre,
  apellidos: jugadores.apellidos,
  dorsal: fichas.dorsal,
  posicion: fichas.posicion,
  activo: fichas.activo,
  tipo: fichas.tipo,
  enDinamica: fichas.enDinamica,
  procedencia: procedenciaFicha,
}

const jugadorNoEncontrado = () =>
  new ErrorApi(404, 'no_encontrado', 'Ese jugador no está en esta plantilla')

// Error del dorsal repetido, en el formato de los errores de validación para mostrarlo en el campo
async function dorsalEnUso(plantillaId: string, dorsal: number, jugadorId?: string) {
  const [titular] = await db
    .select({ nombre: nombreCompleto })
    .from(fichas)
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .where(
      and(
        eq(fichas.plantillaId, plantillaId),
        eq(fichas.dorsal, dorsal),
        eq(fichas.activo, true),
        eq(fichas.tipo, 'propia'),
        jugadorId ? ne(fichas.jugadorId, jugadorId) : undefined,
      ),
    )
  const mensaje = titular
    ? `El dorsal ${dorsal} ya lo lleva ${titular.nombre}`
    : `El dorsal ${dorsal} ya está en uso en la plantilla`
  return new ErrorApi(409, 'dorsal_en_uso', mensaje, [{ campo: 'dorsal', mensaje }])
}

// Lo que impide darle al jugador una ficha en la plantilla: cualquier ficha suya en ella o, si la
// nueva es propia, su ficha propia de la temporada en otra plantilla
async function fichaQueImpide(
  jugadorId: string,
  plantillaId: string,
  temporada: string,
  tipo: 'propia' | 'invitado',
) {
  const [ficha] = await db
    .select({
      plantillaId: fichas.plantillaId,
      plantilla: plantillas.nombre,
      activo: fichas.activo,
      tipo: fichas.tipo,
      nombre: nombreCompleto,
    })
    .from(fichas)
    .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .where(
      and(
        eq(fichas.jugadorId, jugadorId),
        eq(fichas.temporada, temporada),
        tipo === 'propia'
          ? or(eq(fichas.plantillaId, plantillaId), eq(fichas.tipo, 'propia'))
          : eq(fichas.plantillaId, plantillaId),
      ),
    )
    // La de esta plantilla primero
    .orderBy(sql`${fichas.plantillaId} <> ${plantillaId}`)
    .limit(1)
  return ficha
}

function errorFichaEnTemporada(
  ficha: NonNullable<Awaited<ReturnType<typeof fichaQueImpide>>>,
  plantillaId: string,
  temporada: string,
) {
  const como = ficha.tipo === 'invitado' ? ' como invitado' : ''
  const mensaje =
    ficha.plantillaId === plantillaId
      ? `${ficha.nombre} ya está en esta plantilla${como}${ficha.activo ? '' : ' (de baja: puedes reactivarlo)'}`
      : `${ficha.nombre} ya tiene ficha en ${ficha.plantilla} en la temporada ${temporada}`
  return new ErrorApi(409, 'ficha_en_temporada', mensaje)
}

// Su ficha propia de la temporada (activa o de baja), si la tiene
async function fichaPropia(jugadorId: string, temporada: string) {
  const [ficha] = await db
    .select({ plantillaId: fichas.plantillaId })
    .from(fichas)
    .where(
      and(
        eq(fichas.jugadorId, jugadorId),
        eq(fichas.temporada, temporada),
        eq(fichas.tipo, 'propia'),
      ),
    )
  return ficha
}

async function jugadorDePlantilla(plantillaId: string, jugadorId: string) {
  const [jugador] = await db
    .select(columnasJugadorPlantilla)
    .from(fichas)
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .where(and(eq(fichas.plantillaId, plantillaId), eq(fichas.jugadorId, jugadorId)))
  if (!jugador) throw jugadorNoEncontrado()
  return jugador
}

const CuerpoAlta = z.union([
  z
    .object({
      nombre: EsquemaTexto('El nombre'),
      apellidos: EsquemaTexto('Los apellidos').nullish(),
      dorsal: EsquemaDorsal.optional(),
      posicion: EsquemaPosicion.nullable().optional(),
    })
    .strict()
    .openapi({ title: 'Jugador nuevo en el club' }),
  z
    .object({
      jugadorId: EsquemaUuid,
      dorsal: EsquemaDorsal.optional(),
      posicion: EsquemaPosicion.nullable().optional(),
    })
    .strict()
    .openapi({ title: 'Jugador existente del club' }),
  z
    .object({
      invitado: z.literal(true),
      jugadorId: EsquemaUuid,
      enDinamica: z.boolean().default(false),
      procedencia: EsquemaProcedencia.optional().openapi({
        description:
          'Solo si no tiene ficha propia en el club esta temporada (y entonces es obligatoria)',
      }),
      dorsal: EsquemaDorsal.optional(),
      posicion: EsquemaPosicion.nullable().optional(),
    })
    .strict()
    .openapi({ title: 'Invitado del club' }),
  z
    .object({
      invitado: z.literal(true),
      nombre: EsquemaTexto('El nombre'),
      apellidos: EsquemaTexto('Los apellidos').nullish(),
      procedencia: EsquemaProcedencia,
      enDinamica: z.boolean().default(false),
      dorsal: EsquemaDorsal.optional(),
      posicion: EsquemaPosicion.nullable().optional(),
    })
    .strict()
    .openapi({ title: 'Invitado nuevo en el club' }),
])

const CuerpoEdicion = z
  .object({
    nombre: EsquemaTexto('El nombre')
      .optional()
      .openapi({ description: 'Del jugador: cambia en todas sus temporadas' }),
    apellidos: EsquemaTexto('Los apellidos')
      .nullish()
      .openapi({ description: 'Del jugador; null los quita' }),
    dorsal: EsquemaDorsal.optional(),
    posicion: EsquemaPosicion.nullable().optional(),
    activo: z.boolean().optional().openapi({ description: 'false da de baja; true reactiva' }),
    enDinamica: z
      .boolean()
      .optional()
      .openapi({ description: 'Solo de los invitados: si va a los entrenos y tiene multas' }),
    procedencia: EsquemaProcedencia.optional().openapi({
      description: 'Solo de los invitados sin ficha propia en el club esa temporada',
    }),
  })
  .strict()
  .refine((d) => Object.values(d).some((v) => v !== undefined), {
    message: 'Indica algún dato que cambiar',
  })

export const rutasJugadoresPlantilla = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/jugadores',
        tags: ['Jugadores'],
        summary: 'Jugadores de la plantilla',
        description:
          'Fichas de la plantilla con los datos del jugador, ordenadas por dorsal (sin dorsal al final), apellidos y nombre. Por defecto, los activos; con `activos=false`, las bajas.',
        middleware: [requireRol('jugador')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            activos: z
              .enum(['true', 'false'])
              .default('true')
              .openapi({ param: { name: 'activos', in: 'query' } }),
          }),
        },
        responses: { 200: json(z.array(EsquemaJugadorPlantilla), 'Jugadores'), ...errores },
      }),
      async (c) => {
        const { activos } = c.req.valid('query')
        const filas = await db
          .select(columnasJugadorPlantilla)
          .from(fichas)
          .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
          .where(
            and(eq(fichas.plantillaId, c.var.plantilla.id), eq(fichas.activo, activos === 'true')),
          )
          .orderBy(
            asc(fichas.tipo),
            sql`${fichas.dorsal} asc nulls last`,
            ...porNombre,
            asc(jugadores.id),
          )
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/invitables',
        tags: ['Jugadores'],
        summary: 'Jugadores de otras plantillas para invitar',
        description:
          'Delegado o superior. Los jugadores con ficha propia activa en otra plantilla del club en la misma temporada y sin ficha en esta, solo con nombre y plantilla. Busca en el nombre y los apellidos sin distinguir mayúsculas.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            q: z
              .string()
              .trim()
              .max(80)
              .optional()
              .openapi({ param: { name: 'q', in: 'query' } }),
          }),
        },
        responses: {
          200: json(z.array(EsquemaInvitable), 'Jugadores de otras plantillas'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { q } = c.req.valid('query')
        const plantilla = c.var.plantilla
        const patron = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : undefined
        const filas = await db
          .select({
            jugadorId: jugadores.id,
            nombre: jugadores.nombre,
            apellidos: jugadores.apellidos,
            plantilla: plantillas.nombre,
          })
          .from(fichas)
          .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
          .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
          .where(
            and(
              eq(fichas.clubId, plantilla.clubId),
              eq(fichas.temporada, plantilla.temporada),
              eq(fichas.tipo, 'propia'),
              eq(fichas.activo, true),
              ne(fichas.plantillaId, plantilla.id),
              sql`not exists (select 1 from fichas f where f.plantilla_id = ${plantilla.id} and f.jugador_id = ${fichas.jugadorId})`,
              patron ? ilike(nombreCompleto, patron) : undefined,
            ),
          )
          .orderBy(...porNombre, asc(jugadores.id))
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/jugadores',
        tags: ['Jugadores'],
        summary: 'Añadir un jugador a la plantilla',
        description:
          'Delegado o superior. Con `nombre`, da de alta un jugador nuevo en el club; con `jugadorId`, crea la ficha de un jugador que ya es del club. Un jugador tiene como máximo una ficha propia por temporada. Con `invitado: true`, la ficha es de invitado (GH-187): juega con la plantilla sin dejar la suya; `enDinamica` (por defecto false) indica si va también a los entrenos y tiene multas, y `procedencia` es obligatoria si no tiene ficha propia en el club esa temporada. El dorsal de un invitado puede repetirse.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoAlta } } },
        },
        responses: {
          201: json(EsquemaJugadorPlantilla, 'Jugador añadido'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Dorsal en uso o el jugador ya tiene ficha en la temporada'),
          ...errores,
        },
      }),
      async (c) => {
        const datos = c.req.valid('json')
        const plantilla = c.var.plantilla
        const tipo: 'propia' | 'invitado' = 'invitado' in datos ? 'invitado' : 'propia'
        const ficha = {
          dorsal: datos.dorsal ?? null,
          posicion: datos.posicion ?? null,
          tipo,
          enDinamica: 'invitado' in datos ? datos.enDinamica : true,
          procedencia: 'invitado' in datos ? (datos.procedencia ?? null) : null,
        }

        if ('jugadorId' in datos) {
          const [jugador] = await db
            .select({ id: jugadores.id })
            .from(jugadores)
            .where(and(eq(jugadores.id, datos.jugadorId), eq(jugadores.clubId, plantilla.clubId)))
          if (!jugador) throw new ErrorApi(404, 'no_encontrado', 'Ese jugador no es del club')
          const existente = await fichaQueImpide(
            datos.jugadorId,
            plantilla.id,
            plantilla.temporada,
            tipo,
          )
          if (existente) throw errorFichaEnTemporada(existente, plantilla.id, plantilla.temporada)
          if ('invitado' in datos) {
            // Con ficha propia, la procedencia es su plantilla; sin ella, hay que indicarla
            if (await fichaPropia(datos.jugadorId, plantilla.temporada)) {
              ficha.procedencia = null
            } else if (!datos.procedencia) {
              const mensaje = 'No tiene ficha en el club esta temporada: indica de dónde viene'
              throw new ErrorApi(400, 'validacion', mensaje, [{ campo: 'procedencia', mensaje }])
            }
          }
        }

        let jugadorId: string
        try {
          jugadorId = await db.transaction(async (tx) => {
            let id: string
            if ('jugadorId' in datos) {
              id = datos.jugadorId
            } else {
              const [nuevo] = await tx
                .insert(jugadores)
                .values({
                  clubId: plantilla.clubId,
                  nombre: datos.nombre,
                  apellidos: datos.apellidos ?? null,
                })
                .returning({ id: jugadores.id })
              if (!nuevo) throw new Error('No se pudo crear el jugador')
              id = nuevo.id
            }
            await tx.insert(fichas).values({
              plantillaId: plantilla.id,
              jugadorId: id,
              clubId: plantilla.clubId,
              temporada: plantilla.temporada,
              ...ficha,
            })
            return id
          })
        } catch (error) {
          const restriccion = restriccionViolada(error)
          if (restriccion === 'fichas_dorsal_unico_activos' && ficha.dorsal !== null) {
            throw await dorsalEnUso(plantilla.id, ficha.dorsal)
          }
          // Otra petición le ha creado la ficha entre la comprobación y la inserción
          if (
            'jugadorId' in datos &&
            (restriccion === 'fichas_una_propia_por_temporada' || restriccion === 'fichas_pkey')
          ) {
            const existente = await fichaQueImpide(
              datos.jugadorId,
              plantilla.id,
              plantilla.temporada,
              tipo,
            )
            if (existente) throw errorFichaEnTemporada(existente, plantilla.id, plantilla.temporada)
          }
          throw error
        }

        return c.json(await jugadorDePlantilla(plantilla.id, jugadorId), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/jugadores/{jid}',
        tags: ['Jugadores'],
        summary: 'Editar un jugador de la plantilla',
        description:
          'Delegado o superior. El nombre es del jugador y cambia en todas sus temporadas; dorsal, posición y `activo` son de su ficha en esta plantilla. `activo: false` da de baja y `activo: true` reactiva. `enDinamica` y `procedencia`, solo en los invitados: al apagar `enDinamica` se conservan sus asistencias y multas.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla.extend(ParamJugador),
          body: { content: { 'application/json': { schema: CuerpoEdicion } } },
        },
        responses: {
          200: json(EsquemaJugadorPlantilla, 'Jugador actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Dorsal en uso'),
          ...errores,
        },
      }),
      async (c) => {
        const { jid } = c.req.valid('param')
        const { nombre, apellidos, ...cambiosFicha } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const actual = await jugadorDePlantilla(plantillaId, jid)
        if (actual.tipo === 'propia') {
          for (const campo of ['enDinamica', 'procedencia'] as const) {
            if (cambiosFicha[campo] !== undefined) {
              const mensaje = 'Solo se cambia en los invitados'
              throw new ErrorApi(400, 'validacion', mensaje, [{ campo, mensaje }])
            }
          }
        }

        try {
          await db.transaction(async (tx) => {
            if (nombre !== undefined || apellidos !== undefined) {
              await tx.update(jugadores).set({ nombre, apellidos }).where(eq(jugadores.id, jid))
            }
            if (Object.values(cambiosFicha).some((v) => v !== undefined)) {
              await tx
                .update(fichas)
                .set(cambiosFicha)
                .where(and(eq(fichas.plantillaId, plantillaId), eq(fichas.jugadorId, jid)))
            }
          })
        } catch (error) {
          // Un dorsal nuevo, o al reactivar, el suyo, que ya lleva otro jugador activo
          const dorsal = cambiosFicha.dorsal === undefined ? actual.dorsal : cambiosFicha.dorsal
          if (restriccionViolada(error) === 'fichas_dorsal_unico_activos' && dorsal !== null) {
            throw await dorsalEnUso(plantillaId, dorsal, jid)
          }
          throw error
        }

        return c.json(await jugadorDePlantilla(plantillaId, jid), 200)
      },
    )

export const rutasJugadoresClub = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/jugadores',
        tags: ['Jugadores'],
        summary: 'Buscar jugadores del club',
        description: `Para añadirlos a una plantilla. Delegado o superior en alguna plantilla del club. Busca en el nombre y los apellidos sin distinguir mayúsculas; ordenados por apellidos y nombre. Sin límite: son los jugadores de un club.`,
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamClub,
          query: z.object({
            q: z
              .string()
              .trim()
              .max(80)
              .optional()
              .openapi({ param: { name: 'q', in: 'query' } }),
          }),
        },
        responses: {
          200: json(z.array(EsquemaJugadorClub), 'Jugadores del club'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { q } = c.req.valid('query')
        const patron = q ? `%${q.replace(/[\\%_]/g, '\\$&')}%` : undefined
        const filas = await db
          .select({
            id: jugadores.id,
            nombre: jugadores.nombre,
            apellidos: jugadores.apellidos,
            temporadas: sql<string[]>`coalesce((
              select array_agg(${fichas.temporada} order by ${fichas.temporada} desc)
              from ${fichas} where ${fichas.jugadorId} = ${jugadores.id} and ${fichas.tipo} = 'propia'
            ), '{}')`,
          })
          .from(jugadores)
          .where(
            and(
              eq(jugadores.clubId, c.var.club.id),
              patron ? ilike(nombreCompleto, patron) : undefined,
            ),
          )
          .orderBy(...porNombre, asc(jugadores.id))
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/jugadores/{jid}',
        tags: ['Jugadores'],
        summary: 'Un jugador del club y su trayectoria',
        description:
          'Sus fichas por temporada, la más reciente primero. Delegado o superior en alguna plantilla del club; un jugador solo puede ver la suya.',
        middleware: [requireRolEnClub('jugador')] as const,
        request: { params: ParamClub.extend(ParamJugador) },
        responses: { 200: json(EsquemaTrayectoria, 'Jugador'), ...errores },
      }),
      async (c) => {
        const { jid } = c.req.valid('param')
        if (!rolAlcanza(c.var.rol, 'delegado') && c.var.jugadorId !== jid) {
          throw new ErrorApi(403, 'sin_permiso', 'Solo puedes ver tu propia ficha')
        }
        const [jugador] = await db
          .select({ id: jugadores.id, nombre: jugadores.nombre, apellidos: jugadores.apellidos })
          .from(jugadores)
          .where(and(eq(jugadores.id, jid), eq(jugadores.clubId, c.var.club.id)))
        if (!jugador) throw new ErrorApi(404, 'no_encontrado', 'Ese jugador no es del club')

        const fichasJugador = await db
          .select({
            plantillaId: plantillas.id,
            plantilla: plantillas.nombre,
            categoria: plantillas.categoria,
            temporada: fichas.temporada,
            dorsal: fichas.dorsal,
            posicion: fichas.posicion,
            activo: fichas.activo,
            tipo: fichas.tipo,
            enDinamica: fichas.enDinamica,
            procedencia: procedenciaFicha,
          })
          .from(fichas)
          .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
          .where(eq(fichas.jugadorId, jid))
          .orderBy(desc(fichas.temporada), asc(fichas.tipo), asc(plantillas.nombre))
        return c.json({ ...jugador, fichas: fichasJugador }, 200)
      },
    )
