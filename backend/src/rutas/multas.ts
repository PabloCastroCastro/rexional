import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, count, eq, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { motivosMulta, multas, tipoTarjeta } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'

// Catálogo de multas de la plantilla (secciones 2.5 y 7). Los importes van en céntimos enteros. Los
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
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoMotivo.strict() } } },
        },
        responses: {
          201: json(EsquemaMotivo, 'Motivo creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya hay un motivo activo con esa descripción'),
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
        middleware: [requireRol('delegado')] as const,
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
          409: json(EsquemaError, 'Ya hay un motivo activo con esa descripción'),
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
