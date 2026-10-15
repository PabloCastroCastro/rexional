import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, count, desc, eq, isNotNull, isNull, lte, type SQL, sql } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { db } from '../db/cliente.js'
import { fichas, jugadores, motivosMulta, multas, tipoTarjeta } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { hoy } from '../fechas.js'
import { type EnvPlantilla, requireRol, rolAlcanza } from '../permisos.js'
import { EsquemaFecha, EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'
import { porNombre } from './jugadores.js'

// Catálogo de multas y multas de la plantilla (secciones 2.5 y 7). Los importes van en céntimos enteros. Los
// motivos no se borran, se desactivan; las multas guardan su propia copia del motivo y del importe,
// así que cambiar o desactivar un motivo no altera las multas ya puestas.

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
const ParamMotivo = ParamPlantilla.extend({
  mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
})

const EsquemaTipoTarjeta = z.enum(tipoTarjeta.enumValues)

const EsquemaImporte = z
  .int('El importe va en céntimos enteros')
  .min(0, 'El importe no puede ser negativo')
  .max(100_000, 'El importe no puede pasar de 1000 €')
  .openapi({ example: 500, description: 'En céntimos: 500 son 5,00 €' })

const EsquemaMotivo = z
  .object({
    id: z.uuid(),
    descripcion: z.string().openapi({ example: 'Llegar tarde al entreno' }),
    importeCentimos: z.int().openapi({ example: 200 }),
    tipoTarjeta: EsquemaTipoTarjeta.nullable().openapi({
      description: 'Tarjeta que propone este motivo al registrar las estadísticas',
    }),
    activo: z.boolean(),
    multas: z.int().openapi({ description: 'Cuántas multas se han puesto con este motivo' }),
  })
  .openapi('MotivoMulta')

const columnasMotivo = {
  id: motivosMulta.id,
  descripcion: motivosMulta.descripcion,
  importeCentimos: motivosMulta.importeCentimos,
  tipoTarjeta: motivosMulta.tipoTarjeta,
  activo: motivosMulta.activo,
  multas: count(multas.id),
}

// Con las multas desactivadas en la plantilla no se cambia nada: lo que hay se conserva y se puede
// consultar, y vuelve a usarse al reactivarlas
const sinMultas: MiddlewareHandler<EnvPlantilla> = async (c, next) => {
  if (!c.var.plantilla.multasActivas) {
    throw new ErrorApi(
      409,
      'multas_desactivadas',
      'Las multas están desactivadas en esta plantilla: actívalas en Configuración para usarlas',
    )
  }
  await next()
}

const desactivadas = json(EsquemaError, 'Las multas están desactivadas en la plantilla')

const motivoNoEncontrado = () =>
  new ErrorApi(404, 'no_encontrado', 'No existe ese motivo en el catálogo de la plantilla')

const motivoDuplicado = () => {
  const mensaje = 'Ya hay un motivo activo con esa descripción en el catálogo'
  return new ErrorApi(409, 'motivo_duplicado', mensaje, [{ campo: 'descripcion', mensaje }])
}

async function motivosDePlantilla(plantillaId: string, filtro?: ReturnType<typeof eq>) {
  return db
    .select(columnasMotivo)
    .from(motivosMulta)
    .leftJoin(multas, eq(multas.motivoId, motivosMulta.id))
    .where(and(eq(motivosMulta.plantillaId, plantillaId), filtro))
    .groupBy(motivosMulta.id)
    .orderBy(sql`${motivosMulta.descripcion} collate "es-x-icu"`, motivosMulta.id)
}

async function buscarMotivo(plantillaId: string, motivoId: string) {
  const [motivo] = await motivosDePlantilla(plantillaId, eq(motivosMulta.id, motivoId))
  if (!motivo) throw motivoNoEncontrado()
  return motivo
}

const CuerpoMotivo = z.object({
  descripcion: EsquemaTexto('La descripción'),
  importeCentimos: EsquemaImporte,
  tipoTarjeta: EsquemaTipoTarjeta.nullish(),
})

export const rutasMultas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/motivos-multa',
        tags: ['Multas'],
        summary: 'Catálogo de multas',
        description:
          'Motivos activos de la plantilla, por orden alfabético; con `inactivos=true`, también los desactivados. Lo ve cualquier miembro.',
        middleware: [requireRol('jugador')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            inactivos: z
              .enum(['true', 'false'])
              .default('false')
              .openapi({ param: { name: 'inactivos', in: 'query' } }),
          }),
        },
        responses: { 200: json(z.array(EsquemaMotivo), 'Catálogo'), ...errores },
      }),
      async (c) => {
        const { inactivos } = c.req.valid('query')
        const motivos = await motivosDePlantilla(
          c.var.plantilla.id,
          inactivos === 'true' ? undefined : eq(motivosMulta.activo, true),
        )
        return c.json(motivos, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/motivos-multa',
        tags: ['Multas'],
        summary: 'Añadir un motivo al catálogo',
        description: 'Delegado o superior. El importe va en céntimos.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoMotivo.strict() } } },
        },
        responses: {
          201: json(EsquemaMotivo, 'Motivo creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(
            EsquemaError,
            'Ya hay un motivo activo con esa descripción, o las multas están desactivadas',
          ),
          ...errores,
        },
      }),
      async (c) => {
        const datos = c.req.valid('json')
        try {
          const [creado] = await db
            .insert(motivosMulta)
            .values({ ...datos, plantillaId: c.var.plantilla.id })
            .returning({ id: motivosMulta.id })
          if (!creado) throw new Error('No se pudo crear el motivo')
          return c.json(await buscarMotivo(c.var.plantilla.id, creado.id), 201)
        } catch (error) {
          if (restriccionViolada(error) === 'motivos_multa_descripcion_unica_activos') {
            throw motivoDuplicado()
          }
          throw error
        }
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/motivos-multa/{mid}',
        tags: ['Multas'],
        summary: 'Editar, desactivar o reactivar un motivo',
        description:
          'Delegado o superior. `activo: false` lo desactiva y `true` lo reactiva; `tipoTarjeta: null` quita la tarjeta. Las multas ya puestas conservan su motivo e importe.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: {
          params: ParamMotivo,
          body: {
            content: {
              'application/json': {
                schema: CuerpoMotivo.partial()
                  .extend({ activo: z.boolean().optional() })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica algún dato que cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaMotivo, 'Motivo actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(
            EsquemaError,
            'Ya hay un motivo activo con esa descripción, o las multas están desactivadas',
          ),
          ...errores,
        },
      }),
      async (c) => {
        const { mid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        try {
          const actualizados = await db
            .update(motivosMulta)
            .set(cambios)
            .where(and(eq(motivosMulta.id, mid), eq(motivosMulta.plantillaId, c.var.plantilla.id)))
            .returning({ id: motivosMulta.id })
          if (actualizados.length === 0) throw motivoNoEncontrado()
        } catch (error) {
          if (restriccionViolada(error) === 'motivos_multa_descripcion_unica_activos') {
            throw motivoDuplicado()
          }
          throw error
        }
        return c.json(await buscarMotivo(c.var.plantilla.id, mid), 200)
      },
    )

// --- Multas (GH-24) ---

const EsquemaImporteMulta = z
  .int('El importe va en céntimos enteros')
  .min(1, 'El importe tiene que ser mayor que 0')
  .max(100_000, 'El importe no puede pasar de 1000 €')
  .openapi({ example: 500, description: 'En céntimos: 500 son 5,00 €' })

const EsquemaMulta = z
  .object({
    id: z.uuid(),
    jugadorId: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable(),
    dorsal: z.number().int().nullable(),
    motivoId: z.uuid().nullable().openapi({ description: 'null si es un motivo libre' }),
    motivo: z.string().openapi({ example: 'Llegar tarde al entreno' }),
    importeCentimos: z.int().openapi({ example: 200 }),
    fecha: z.string().openapi({ example: '2026-10-13' }),
    fechaPago: z
      .string()
      .nullable()
      .openapi({ description: 'Fecha de cobro; null si está pendiente' }),
  })
  .openapi('Multa')

const EsquemaDeuda = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable(),
    dorsal: z.number().int().nullable(),
    pendienteCentimos: z.int(),
    multasPendientes: z.int(),
  })
  .openapi('DeudaJugador')

const ParamMulta = ParamPlantilla.extend({
  mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
})

const columnasMulta = {
  id: multas.id,
  jugadorId: multas.jugadorId,
  nombre: jugadores.nombre,
  apellidos: jugadores.apellidos,
  dorsal: fichas.dorsal,
  motivoId: multas.motivoId,
  motivo: multas.motivo,
  importeCentimos: multas.importeCentimos,
  fecha: multas.fecha,
  fechaPago: multas.fechaPago,
}

const multaNoEncontrada = () =>
  new ErrorApi(404, 'no_encontrado', 'No existe esa multa en la plantilla')

const errorCampo = (estado: 400 | 404, codigo: string, campo: string, mensaje: string) =>
  new ErrorApi(estado, codigo, mensaje, [{ campo, mensaje }])

const pagoAnterior = () =>
  errorCampo(
    400,
    'validacion',
    'fechaPago',
    'La fecha de cobro no puede ser anterior a la de la multa',
  )

// Multas de la plantilla con los datos del jugador, la más reciente primero
function consultaMultas(plantillaId: string, ...filtros: (SQL | undefined)[]) {
  return db
    .select(columnasMulta)
    .from(multas)
    .innerJoin(jugadores, eq(jugadores.id, multas.jugadorId))
    .innerJoin(
      fichas,
      and(eq(fichas.plantillaId, multas.plantillaId), eq(fichas.jugadorId, multas.jugadorId)),
    )
    .where(and(eq(multas.plantillaId, plantillaId), ...filtros))
    .orderBy(desc(multas.fecha), desc(multas.createdAt), desc(multas.id))
}

async function buscarMulta(plantillaId: string, multaId: string) {
  const [multa] = await consultaMultas(plantillaId, eq(multas.id, multaId))
  if (!multa) throw multaNoEncontrada()
  return multa
}

async function exigirFicha(plantillaId: string, jugadorId: string, estado: 400 | 404) {
  const [ficha] = await db
    .select({ jugadorId: fichas.jugadorId })
    .from(fichas)
    .where(and(eq(fichas.plantillaId, plantillaId), eq(fichas.jugadorId, jugadorId)))
  if (!ficha) {
    throw errorCampo(
      estado,
      'jugador_sin_ficha',
      'jugadorId',
      'Ese jugador no tiene ficha en esta plantilla',
    )
  }
}

const sumaCentimos = (condicion: SQL) =>
  sql<number>`coalesce(sum(${multas.importeCentimos}) filter (where ${condicion}), 0)::int`

const CuerpoMultaCatalogo = z
  .object({
    jugadorId: EsquemaUuid,
    motivoId: EsquemaUuid,
    importeCentimos: EsquemaImporteMulta.optional().openapi({
      description: 'Si no se indica, el del catálogo',
    }),
    fecha: EsquemaFecha.optional(),
  })
  .strict()
  .openapi({ title: 'Multa del catálogo' })

const CuerpoMultaLibre = z
  .object({
    jugadorId: EsquemaUuid,
    motivo: EsquemaTexto('El motivo', 120),
    importeCentimos: EsquemaImporteMulta,
    fecha: EsquemaFecha.optional(),
  })
  .strict()
  .openapi({ title: 'Multa con motivo libre' })

export const rutasMultasJugadores = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/multas',
        tags: ['Multas'],
        summary: 'Multas',
        description:
          'Multas de la plantilla, la más reciente primero, con filtros por jugador y estado. El rol jugador solo recibe las suyas.',
        middleware: [requireRol('jugador')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            jugador: EsquemaUuid.optional().openapi({ param: { name: 'jugador', in: 'query' } }),
            estado: z
              .enum(['pendientes', 'cobradas'])
              .optional()
              .openapi({ param: { name: 'estado', in: 'query' } }),
          }),
        },
        responses: {
          200: json(z.array(EsquemaMulta), 'Multas'),
          400: json(EsquemaError, 'Filtros no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { jugador, estado } = c.req.valid('query')
        // El rol jugador solo ve las suyas (si su usuario es un jugador del club)
        const soloSuyas = !rolAlcanza(c.var.rol, 'delegado')
        if (soloSuyas && !c.var.jugadorId) return c.json([], 200)
        const deJugador = soloSuyas ? c.var.jugadorId : jugador
        const lista = await consultaMultas(
          c.var.plantilla.id,
          deJugador ? eq(multas.jugadorId, deJugador) : undefined,
          estado === 'pendientes'
            ? isNull(multas.fechaPago)
            : estado === 'cobradas'
              ? isNotNull(multas.fechaPago)
              : undefined,
        )
        return c.json(lista, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/multas',
        tags: ['Multas'],
        summary: 'Poner una multa',
        description:
          'Delegado o superior. Con `motivoId`, copia la descripción y el importe del motivo activo del catálogo (el importe se puede cambiar); con `motivo`, texto libre e importe obligatorio. La fecha, por defecto, es hoy.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: {
              'application/json': { schema: z.union([CuerpoMultaCatalogo, CuerpoMultaLibre]) },
            },
          },
        },
        responses: {
          409: desactivadas,
          201: json(EsquemaMulta, 'Multa puesta'),
          400: json(EsquemaError, 'Datos no válidos, motivo no válido o jugador sin ficha'),
          ...errores,
        },
      }),
      async (c) => {
        const datos = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        await exigirFicha(plantillaId, datos.jugadorId, 400)

        let motivo: string
        let importe: number | undefined = datos.importeCentimos
        let motivoId: string | null = null
        if ('motivoId' in datos) {
          const [delCatalogo] = await db
            .select({
              descripcion: motivosMulta.descripcion,
              importeCentimos: motivosMulta.importeCentimos,
            })
            .from(motivosMulta)
            .where(
              and(
                eq(motivosMulta.id, datos.motivoId),
                eq(motivosMulta.plantillaId, plantillaId),
                eq(motivosMulta.activo, true),
              ),
            )
          if (!delCatalogo) {
            throw errorCampo(
              400,
              'motivo_no_valido',
              'motivoId',
              'Ese motivo no está activo en el catálogo de la plantilla',
            )
          }
          motivo = delCatalogo.descripcion
          importe ??= delCatalogo.importeCentimos
          motivoId = datos.motivoId
        } else {
          motivo = datos.motivo
        }
        if (!importe) {
          throw errorCampo(400, 'validacion', 'importeCentimos', 'Indica un importe mayor que 0')
        }

        const [creada] = await db
          .insert(multas)
          .values({
            plantillaId,
            jugadorId: datos.jugadorId,
            motivoId,
            motivo,
            importeCentimos: importe,
            fecha: datos.fecha ?? hoy(),
            creadaPor: c.var.usuario.id,
          })
          .returning({ id: multas.id })
        if (!creada) throw new Error('No se pudo poner la multa')
        return c.json(await buscarMulta(plantillaId, creada.id), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/multas/{mid}',
        tags: ['Multas'],
        summary: 'Editar, cobrar o deshacer el cobro de una multa',
        description:
          'Delegado o superior. `fechaPago` con una fecha la cobra y `fechaPago: null` deshace el cobro; la fecha de cobro no puede ser anterior a la de la multa.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: {
          params: ParamMulta,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    motivo: EsquemaTexto('El motivo', 120).optional(),
                    importeCentimos: EsquemaImporteMulta.optional(),
                    fecha: EsquemaFecha.optional(),
                    fechaPago: EsquemaFecha.nullable().optional(),
                  })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica algún dato que cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          409: desactivadas,
          200: json(EsquemaMulta, 'Multa actualizada'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { mid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        try {
          const actualizadas = await db
            .update(multas)
            .set(cambios)
            .where(and(eq(multas.id, mid), eq(multas.plantillaId, c.var.plantilla.id)))
            .returning({ id: multas.id })
          if (actualizadas.length === 0) throw multaNoEncontrada()
        } catch (error) {
          if (restriccionViolada(error) === 'multas_pago_posterior') throw pagoAnterior()
          throw error
        }
        return c.json(await buscarMulta(c.var.plantilla.id, mid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/multas/{mid}',
        tags: ['Multas'],
        summary: 'Borrar una multa',
        description: 'Delegado o superior.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: { params: ParamMulta },
        responses: { 204: { description: 'Multa borrada' }, 409: desactivadas, ...errores },
      }),
      async (c) => {
        const { mid } = c.req.valid('param')
        const borradas = await db
          .delete(multas)
          .where(and(eq(multas.id, mid), eq(multas.plantillaId, c.var.plantilla.id)))
          .returning({ id: multas.id })
        if (borradas.length === 0) throw multaNoEncontrada()
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/jugadores/{jid}/saldar',
        tags: ['Multas'],
        summary: 'Saldar las multas de un jugador',
        description:
          'Delegado o superior. Cobra de una vez todas sus multas pendientes en la plantilla, con la fecha indicada o la de hoy.',
        middleware: [requireRol('delegado'), sinMultas] as const,
        request: {
          params: ParamPlantilla.extend({
            jid: EsquemaUuid.openapi({ param: { name: 'jid', in: 'path' } }),
          }),
          body: {
            required: false,
            content: {
              'application/json': { schema: z.object({ fecha: EsquemaFecha.optional() }).strict() },
            },
          },
        },
        responses: {
          409: desactivadas,
          200: json(
            z.object({ cobradas: z.int(), importeCentimos: z.int() }).openapi('MultasSaldadas'),
            'Multas cobradas',
          ),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { jid } = c.req.valid('param')
        const fecha = c.req.valid('json')?.fecha ?? hoy()
        const plantillaId = c.var.plantilla.id
        await exigirFicha(plantillaId, jid, 404)
        // Las de fecha posterior a la del cobro se quedan pendientes: el cobro no puede ser anterior
        const cobradas = await db
          .update(multas)
          .set({ fechaPago: fecha })
          .where(
            and(
              eq(multas.plantillaId, plantillaId),
              eq(multas.jugadorId, jid),
              isNull(multas.fechaPago),
              lte(multas.fecha, fecha),
            ),
          )
          .returning({ importeCentimos: multas.importeCentimos })
        return c.json(
          {
            cobradas: cobradas.length,
            importeCentimos: cobradas.reduce((total, m) => total + m.importeCentimos, 0),
          },
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/multas/resumen',
        tags: ['Multas'],
        summary: 'Caja y deudas',
        description:
          'Delegado o superior. Total pendiente de cobro, total en caja (cobrado) y deuda de cada jugador con algo pendiente, de mayor a menor.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPlantilla },
        responses: {
          200: json(
            z
              .object({
                pendienteCentimos: z.int(),
                cajaCentimos: z.int(),
                deudas: z.array(EsquemaDeuda),
              })
              .openapi('ResumenMultas'),
            'Resumen',
          ),
          ...errores,
        },
      }),
      async (c) => {
        const plantillaId = c.var.plantilla.id
        const [totales] = await db
          .select({
            pendienteCentimos: sumaCentimos(sql`${multas.fechaPago} is null`),
            cajaCentimos: sumaCentimos(sql`${multas.fechaPago} is not null`),
          })
          .from(multas)
          .where(eq(multas.plantillaId, plantillaId))
        const pendiente = sql<number>`coalesce(sum(${multas.importeCentimos}), 0)::int`
        const deudas = await db
          .select({
            jugadorId: jugadores.id,
            nombre: jugadores.nombre,
            apellidos: jugadores.apellidos,
            dorsal: fichas.dorsal,
            pendienteCentimos: pendiente,
            multasPendientes: count(multas.id),
          })
          .from(multas)
          .innerJoin(jugadores, eq(jugadores.id, multas.jugadorId))
          .innerJoin(
            fichas,
            and(eq(fichas.plantillaId, multas.plantillaId), eq(fichas.jugadorId, multas.jugadorId)),
          )
          .where(and(eq(multas.plantillaId, plantillaId), isNull(multas.fechaPago)))
          .groupBy(jugadores.id, fichas.plantillaId, fichas.jugadorId)
          .orderBy(desc(pendiente), ...porNombre, asc(jugadores.id))
        return c.json(
          {
            pendienteCentimos: totales?.pendienteCentimos ?? 0,
            cajaCentimos: totales?.cajaCentimos ?? 0,
            deudas,
          },
          200,
        )
      },
    )
