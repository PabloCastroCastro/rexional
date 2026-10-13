import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/cliente.js'
import { asistencias, entrenos, estadoAsistencia, fichas, jugadores } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol, rolAlcanza } from '../permisos.js'
import { EsquemaUuid, restriccionViolada } from '../validacion.js'
import { EsquemaPosicion, porNombre } from './jugadores.js'

// Entrenos y asistencia (secciones 2.3 y 7). Pasar lista guarda la lista completa de un día; el
// entreno se crea con la primera asistencia y se borra si se queda sin ninguna. El rol jugador solo
// recibe sus propios datos; los recuentos de cada entreno no identifican a nadie.

const ESTADOS = estadoAsistencia.enumValues
type Estado = (typeof ESTADOS)[number]

const EsquemaEstado = z.enum(ESTADOS)

const EsquemaRecuentos = z
  .object({ asiste: z.int(), justificada: z.int(), falta: z.int() })
  .openapi('RecuentosAsistencia')

const EsquemaResumenEntreno = EsquemaRecuentos.extend({
  fecha: z.string().openapi({ example: '2026-10-13' }),
}).openapi('ResumenEntreno')

const EsquemaEntreno = z
  .object({
    fecha: z.string().openapi({ example: '2026-10-13' }),
    existe: z.boolean().openapi({ description: 'false si ese día aún no se ha pasado lista' }),
    recuentos: EsquemaRecuentos,
    jugadores: z.array(
      z.object({
        jugadorId: z.uuid(),
        nombre: z.string(),
        dorsal: z.number().int().nullable(),
        posicion: EsquemaPosicion.nullable(),
        activo: z.boolean(),
        estado: EsquemaEstado.nullable(),
        motivo: z.string().nullable(),
      }),
    ),
  })
  .openapi('Entreno')

const EsquemaAsistenciaJugador = EsquemaRecuentos.extend({
  jugadorId: z.uuid(),
  nombre: z.string(),
  activo: z.boolean(),
  porcentaje: z
    .int()
    .nullable()
    .openapi({ description: 'Asistencias / entrenos con estado registrado, de 0 a 100' }),
}).openapi('AsistenciaJugador')

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

const EsquemaFecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .refine(
    (f) => {
      // Zod evalúa el refine aunque falle el formato: una fecha inválida no debe lanzar
      const dia = new Date(`${f}T00:00:00Z`)
      return !Number.isNaN(dia.getTime()) && dia.toISOString().startsWith(f)
    },
    {
      message: 'La fecha no existe',
    },
  )

const ParamEntreno = ParamPlantilla.extend({
  fecha: EsquemaFecha.openapi({ param: { name: 'fecha', in: 'path' }, example: '2026-10-13' }),
})

// Día de hoy en la zona horaria de la aplicación, como AAAA-MM-DD
const hoy = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.zonaHoraria }).format(new Date())

const recuento = (estado: Estado) =>
  sql<number>`(count(*) filter (where ${asistencias.estado} = ${estado}))::int`

// Delegado o superior ve a todos; el rol jugador, solo su fila (si su usuario es un jugador del club)
const visibles = <T extends { jugadorId: string }>(
  filas: T[],
  variables: EnvPlantilla['Variables'],
) =>
  rolAlcanza(variables.rol, 'delegado')
    ? filas
    : filas.filter((f) => f.jugadorId === variables.jugadorId)

// Lista de un día: los jugadores activos y los de baja que tienen asistencia registrada ese día
async function entrenoDelDia(plantillaId: string, fecha: string) {
  const [entreno] = await db
    .select({ id: entrenos.id })
    .from(entrenos)
    .where(and(eq(entrenos.plantillaId, plantillaId), eq(entrenos.fecha, fecha)))

  const filas = await db
    .select({
      jugadorId: jugadores.id,
      nombre: jugadores.nombre,
      dorsal: fichas.dorsal,
      posicion: fichas.posicion,
      activo: fichas.activo,
      estado: asistencias.estado,
      motivo: asistencias.motivo,
    })
    .from(fichas)
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .leftJoin(
      asistencias,
      and(
        eq(asistencias.jugadorId, fichas.jugadorId),
        entreno ? eq(asistencias.entrenoId, entreno.id) : sql`false`,
      ),
    )
    .where(
      and(
        eq(fichas.plantillaId, plantillaId),
        or(eq(fichas.activo, true), sql`${asistencias.estado} is not null`),
      ),
    )
    .orderBy(sql`${fichas.dorsal} asc nulls last`, porNombre, asc(jugadores.id))

  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const f of filas) if (f.estado) recuentos[f.estado] += 1
  return { fecha, existe: entreno !== undefined, recuentos, jugadores: filas }
}

const CuerpoAsistencias = z
  .object({
    asistencias: z
      .array(
        z.object({
          jugadorId: EsquemaUuid,
          estado: EsquemaEstado,
          motivo: z
            .string()
            .trim()
            .max(200, 'El motivo no puede tener más de 200 caracteres')
            .nullish()
            .transform((m) => m || null),
        }),
      )
      .max(200),
  })
  .superRefine(({ asistencias: lista }, ctx) => {
    const vistos = new Set<string>()
    lista.forEach((a, i) => {
      if (vistos.has(a.jugadorId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['asistencias', i, 'jugadorId'],
          message: 'El jugador aparece dos veces en la lista',
        })
      }
      vistos.add(a.jugadorId)
      if (a.motivo && a.estado !== 'justificada') {
        ctx.addIssue({
          code: 'custom',
          path: ['asistencias', i, 'motivo'],
          message: 'El motivo solo se indica en una falta justificada',
        })
      }
    })
  })

const sinFicha = () =>
  new ErrorApi(
    400,
    'jugador_sin_ficha',
    'Algún jugador de la lista no tiene ficha en esta plantilla',
  )

export const rutasEntrenos = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos',
        tags: ['Entrenos'],
        summary: 'Historial de entrenos',
        description:
          'Entrenos de la plantilla, el más reciente primero, con el recuento de cada estado. Los recuentos no identifican a nadie: los ve cualquier miembro.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(z.array(EsquemaResumenEntreno), 'Entrenos'), ...errores },
      }),
      async (c) => {
        const filas = await db
          .select({
            fecha: entrenos.fecha,
            asiste: recuento('asiste'),
            justificada: recuento('justificada'),
            falta: recuento('falta'),
          })
          .from(entrenos)
          .leftJoin(asistencias, eq(asistencias.entrenoId, entrenos.id))
          .where(eq(entrenos.plantillaId, c.var.plantilla.id))
          .groupBy(entrenos.id)
          .orderBy(desc(entrenos.fecha))
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos/{fecha}',
        tags: ['Entrenos'],
        summary: 'Asistencia de un día',
        description:
          'Los jugadores activos y los de baja con asistencia registrada ese día, con su estado. Si aún no se ha pasado lista, `existe` es false y los estados están vacíos. El rol jugador solo recibe su fila.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamEntreno },
        responses: {
          200: json(EsquemaEntreno, 'Entreno'),
          400: json(EsquemaError, 'Fecha no válida'),
          ...errores,
        },
      }),
      async (c) => {
        const { fecha } = c.req.valid('param')
        const entreno = await entrenoDelDia(c.var.plantilla.id, fecha)
        return c.json({ ...entreno, jugadores: visibles(entreno.jugadores, c.var) }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/entrenos/{fecha}/asistencias',
        tags: ['Entrenos'],
        summary: 'Pasar lista',
        description:
          'Delegado o superior. Guarda la lista completa del día: quien no aparece queda sin registrar. Crea el entreno con la primera asistencia y lo borra si la lista llega vacía. No admite fechas futuras.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: { content: { 'application/json': { schema: CuerpoAsistencias } } },
        },
        responses: {
          200: json(EsquemaEntreno, 'Asistencia guardada'),
          400: json(EsquemaError, 'Datos no válidos, fecha futura o jugador sin ficha'),
          ...errores,
        },
      }),
      async (c) => {
        const { fecha } = c.req.valid('param')
        const { asistencias: lista } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id

        if (fecha > hoy()) {
          throw new ErrorApi(
            400,
            'fecha_futura',
            'No se puede pasar lista de un día que no ha llegado',
          )
        }
        if (lista.length > 0) {
          const conFicha = await db
            .select({ jugadorId: fichas.jugadorId })
            .from(fichas)
            .where(
              and(
                eq(fichas.plantillaId, plantillaId),
                inArray(
                  fichas.jugadorId,
                  lista.map((a) => a.jugadorId),
                ),
              ),
            )
          if (conFicha.length !== lista.length) throw sinFicha()
        }

        try {
          await db.transaction(async (tx) => {
            // Crea el entreno o, si existe, bloquea su fila: dos guardados a la vez van uno detrás de otro
            const [entreno] = await tx
              .insert(entrenos)
              .values({ plantillaId, fecha })
              .onConflictDoUpdate({
                target: [entrenos.plantillaId, entrenos.fecha],
                set: { fecha: sql`excluded.fecha` },
              })
              .returning({ id: entrenos.id })
            if (!entreno) throw new Error('No se pudo crear el entreno')

            await tx.delete(asistencias).where(eq(asistencias.entrenoId, entreno.id))
            if (lista.length === 0) {
              await tx.delete(entrenos).where(eq(entrenos.id, entreno.id))
              return
            }
            await tx
              .insert(asistencias)
              .values(lista.map((a) => ({ ...a, entrenoId: entreno.id, plantillaId })))
          })
        } catch (error) {
          if (restriccionViolada(error) === 'asistencias_ficha_fk') throw sinFicha()
          throw error
        }

        return c.json(await entrenoDelDia(plantillaId, fecha), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/asistencia/resumen',
        tags: ['Entrenos'],
        summary: 'Asistencia por jugador',
        description:
          'Asistencias, justificadas, faltas y porcentaje de cada jugador de la plantilla (también de las bajas). El porcentaje es asistencias / entrenos con estado registrado, y null si no tiene ninguno. El rol jugador solo recibe el suyo.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(z.array(EsquemaAsistenciaJugador), 'Asistencia'), ...errores },
      }),
      async (c) => {
        const filas = await db
          .select({
            jugadorId: jugadores.id,
            nombre: jugadores.nombre,
            activo: fichas.activo,
            asiste: recuento('asiste'),
            justificada: recuento('justificada'),
            falta: recuento('falta'),
          })
          .from(fichas)
          .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
          .leftJoin(
            asistencias,
            and(
              eq(asistencias.plantillaId, fichas.plantillaId),
              eq(asistencias.jugadorId, fichas.jugadorId),
            ),
          )
          .where(eq(fichas.plantillaId, c.var.plantilla.id))
          .groupBy(jugadores.id, fichas.plantillaId, fichas.jugadorId)
          .orderBy(sql`${fichas.dorsal} asc nulls last`, porNombre, asc(jugadores.id))

        const conPorcentaje = filas.map((f) => {
          const total = f.asiste + f.justificada + f.falta
          return { ...f, porcentaje: total === 0 ? null : Math.round((100 * f.asiste) / total) }
        })
        return c.json(visibles(conPorcentaje, c.var), 200)
      },
    )
