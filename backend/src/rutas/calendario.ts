import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { eq } from 'drizzle-orm'
import { bodyLimit } from 'hono/body-limit'
import { detectarEquipo, yaRegistrado } from '../calendario/equipos.js'
import { CalendarioNoLegible, leerCalendario } from '../calendario/leer.js'
import { db } from '../db/cliente.js'
import { clubes, partidos, plantillas } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaFecha, EsquemaTexto } from '../validacion.js'
import { errores, json, ParamPlantilla } from './partidos.js'

// Calendario de la competición (GH-127): el PDF de la federación con todas las jornadas. Se lee, el
// entrenador elige su equipo y revisa los partidos, y al confirmar se crean con la fecha de la
// jornada, el rival y si se juega en casa o fuera. El PDF no se guarda.

const MAXIMO = 2 * 1024 * 1024

const limite = bodyLimit({
  maxSize: MAXIMO + 64 * 1024,
  onError: () => {
    throw new ErrorApi(413, 'calendario_demasiado_grande', 'El calendario no puede pasar de 2 MB')
  },
})

const EsquemaCalendario = z
  .object({
    competicion: z.string().nullable().openapi({ example: 'TERCERA FUTGAL, A CORUÑA | GRUPO 1' }),
    temporada: z.string().nullable().openapi({ example: '2026-2027' }),
    equipos: z.array(z.string()).openapi({ description: 'Los equipos de la competición' }),
    equipo: z
      .string()
      .nullable()
      .openapi({ description: 'El equipo que se parece al club; null si no hay uno claro' }),
    jornadas: z.array(
      z.object({
        numero: z.int(),
        fecha: z.string(),
        enfrentamientos: z.array(z.object({ local: z.string(), visitante: z.string() })),
        descansa: z.string().nullable(),
      }),
    ),
    existentes: z
      .array(z.object({ fecha: z.string(), rival: z.string() }))
      .openapi({ description: 'Los partidos que ya tiene la plantilla, para no repetirlos' }),
  })
  .openapi('CalendarioLeido')

const CuerpoImportar = z
  .object({
    partidos: z
      .array(
        z
          .object({ fecha: EsquemaFecha, rival: EsquemaTexto('El rival'), local: z.boolean() })
          .strict(),
      )
      .min(1, 'Elige al menos un partido')
      .max(80),
  })
  .strict()

const EsquemaImportado = z
  .object({
    creados: z.int(),
    omitidos: z
      .array(z.object({ fecha: z.string(), rival: z.string() }))
      .openapi({ description: 'Los que ya estaban (mismo día, o rival parecido a pocos días)' }),
  })
  .openapi('CalendarioImportado')

const existentes = (plantillaId: string) =>
  db
    .select({ fecha: partidos.fecha, rival: partidos.rival })
    .from(partidos)
    .where(eq(partidos.plantillaId, plantillaId))

export const rutasCalendario = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/calendario/leer',
        tags: ['Partidos'],
        summary: 'Leer el calendario',
        description:
          'Delegado o superior. El calendario de la competición en PDF (como mucho 2 MB), en el campo `archivo`. Devuelve las jornadas leídas sin crear nada; el PDF no se guarda.',
        middleware: [requireRol('delegado'), limite] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: {
              'multipart/form-data': {
                schema: z.object({
                  archivo: z.any().openapi({ type: 'string', format: 'binary' }),
                }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaCalendario, 'Calendario leído'),
          400: json(EsquemaError, 'No es un PDF o no se puede leer'),
          413: json(EsquemaError, 'Pasa de 2 MB'),
          ...errores,
        },
      }),
      async (c) => {
        const { archivo } = c.req.valid('form')
        if (!(archivo instanceof File)) {
          throw new ErrorApi(
            400,
            'validacion',
            'Adjunta el calendario en PDF en el campo «archivo»',
          )
        }
        if (archivo.size > MAXIMO) {
          throw new ErrorApi(
            413,
            'calendario_demasiado_grande',
            'El calendario no puede pasar de 2 MB',
          )
        }
        let calendario: Awaited<ReturnType<typeof leerCalendario>>
        try {
          calendario = await leerCalendario(new Uint8Array(await archivo.arrayBuffer()))
        } catch (error) {
          if (error instanceof CalendarioNoLegible) {
            throw new ErrorApi(400, 'calendario_no_legible', error.message)
          }
          throw error
        }
        const [club] = await db
          .select({ nombre: clubes.nombre })
          .from(clubes)
          .where(eq(clubes.id, c.var.plantilla.clubId))
        return c.json(
          {
            ...calendario,
            equipo: detectarEquipo(calendario.equipos, club?.nombre ?? ''),
            existentes: await existentes(c.var.plantilla.id),
          },
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/calendario',
        tags: ['Partidos'],
        summary: 'Importar el calendario',
        description:
          'Delegado o superior. Crea los partidos elegidos del calendario, programados y sin hora. Omite los que ya están: otro partido el mismo día, o contra un rival parecido con 3 días o menos de diferencia.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoImportar } } },
        },
        responses: {
          200: json(EsquemaImportado, 'Partidos creados'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const plantillaId = c.var.plantilla.id
        const resultado = await db.transaction(async (tx) => {
          // Bloquea la plantilla para que dos importaciones a la vez no se dupliquen
          await tx
            .select({ id: plantillas.id })
            .from(plantillas)
            .where(eq(plantillas.id, plantillaId))
            .for('update')
          const hay = await tx
            .select({ fecha: partidos.fecha, rival: partidos.rival })
            .from(partidos)
            .where(eq(partidos.plantillaId, plantillaId))
          const nuevos: { fecha: string; rival: string; local: boolean }[] = []
          const omitidos: { fecha: string; rival: string }[] = []
          for (const p of c.req.valid('json').partidos) {
            if (yaRegistrado(p, [...hay, ...nuevos]))
              omitidos.push({ fecha: p.fecha, rival: p.rival })
            else nuevos.push(p)
          }
          if (nuevos.length > 0) {
            await tx.insert(partidos).values(nuevos.map((p) => ({ ...p, plantillaId })))
          }
          return { creados: nuevos.length, omitidos }
        })
        return c.json(resultado, 200)
      },
    )
