import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { ajustesSancion, tipoSancion } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { calcularDePlantilla, estadoDeJugadores } from '../sanciones.js'
import { EsquemaUuid } from '../validacion.js'

// Sanciones de los jugadores de la plantilla (GH-231): se calculan con las tarjetas de los partidos y
// las reglas de la plantilla. No son un dato de salud y la federación las publica: las ve cualquier
// miembro. El cuerpo técnico corrige el número de partidos de una sanción concreta.

const EsquemaTipoSancion = z.enum(tipoSancion.enumValues).openapi('TipoSancion')

const EsquemaSancion = z
  .object({
    partidoId: z.uuid().openapi({ description: 'Partido de la tarjeta que la causa' }),
    rival: z.string(),
    fecha: z.string(),
    competicion: z.string(),
    tipo: EsquemaTipoSancion,
    calculados: z.int().openapi({ description: 'Partidos según las reglas de la plantilla' }),
    partidos: z.int().openapi({ description: 'Partidos que cuentan, con el ajuste si lo hay' }),
    cumplidos: z.int(),
    ajustada: z.boolean().openapi({ description: 'true si el cuerpo técnico la ha corregido' }),
    nota: z.string().nullable(),
  })
  .openapi('Sancion')

const EsquemaSancionesJugador = z
  .object({
    jugadorId: z.uuid(),
    pendientes: z
      .array(z.object({ competicion: z.string(), partidos: z.int() }))
      .openapi({ description: 'Partidos que le quedan por cumplir, por competición' }),
    apercibido: z
      .array(z.object({ competicion: z.string(), amarillas: z.int() }))
      .openapi({ description: 'Competiciones en las que está a una amarilla de cerrar el ciclo' }),
    sanciones: z.array(EsquemaSancion).openapi({ description: 'La más reciente primero' }),
  })
  .openapi('SancionesJugador')

const EsquemaSanciones = z
  .object({
    jugadores: z.array(EsquemaSancionesJugador).openapi({
      description: 'Solo los que tienen alguna sanción o están apercibidos',
    }),
  })
  .openapi('SancionesPlantilla')

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

async function sancionesDe(plantillaId: string) {
  const { reglas, calculo } = await calcularDePlantilla(plantillaId)
  return { jugadores: estadoDeJugadores(calculo, reglas) }
}

export const rutasSanciones = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/sanciones',
        tags: ['Partidos'],
        summary: 'Sanciones de los jugadores',
        description:
          'Calculadas con las tarjetas de los partidos jugados y las reglas de la plantilla: lo que le queda a cada uno por cumplir, si está apercibido y sus sanciones. Cualquier miembro.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(EsquemaSanciones, 'Sanciones'), ...errores },
      }),
      async (c) => c.json(await sancionesDe(c.var.plantilla.id), 200),
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/sanciones/ajuste',
        tags: ['Partidos'],
        summary: 'Corregir una sanción',
        description:
          'Delegado o superior. Cambia los partidos de una sanción (0 la anula), como decida el comité de competición; con `partidos: null` vuelve a los de las reglas.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    partidoId: EsquemaUuid,
                    jugadorId: EsquemaUuid,
                    tipo: EsquemaTipoSancion,
                    partidos: z
                      .int('Los partidos son un número entero')
                      .min(0, 'Los partidos van de 0 a 20')
                      .max(20, 'Los partidos van de 0 a 20')
                      .nullable(),
                    nota: z
                      .string()
                      .trim()
                      .min(1, 'Escribe la nota o déjala vacía')
                      .max(140, 'La nota admite como máximo 140 caracteres')
                      .nullish(),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaSanciones, 'Sanción corregida; devuelve todas'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const plantillaId = c.var.plantilla.id
        const { partidoId, jugadorId, tipo, partidos, nota } = c.req.valid('json')
        // Solo se corrige una sanción que existe según las tarjetas
        const { calculo } = await calcularDePlantilla(plantillaId)
        const existe = calculo.sanciones.some(
          (s) => s.partidoId === partidoId && s.jugadorId === jugadorId && s.tipo === tipo,
        )
        if (!existe) {
          throw new ErrorApi(404, 'no_encontrada', 'No hay esa sanción en la plantilla')
        }
        const delAjuste = and(
          eq(ajustesSancion.partidoId, partidoId),
          eq(ajustesSancion.jugadorId, jugadorId),
          eq(ajustesSancion.tipo, tipo),
        )
        if (partidos === null) {
          await db.delete(ajustesSancion).where(delAjuste)
        } else {
          await db
            .insert(ajustesSancion)
            .values({ plantillaId, partidoId, jugadorId, tipo, partidos, nota: nota ?? null })
            .onConflictDoUpdate({
              target: [ajustesSancion.partidoId, ajustesSancion.jugadorId, ajustesSancion.tipo],
              set: { partidos, nota: nota ?? null },
            })
        }
        return c.json(await sancionesDe(plantillaId), 200)
      },
    )
