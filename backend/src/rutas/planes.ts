import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import {
  categoriaEjercicio,
  ejercicioMedios,
  ejercicios,
  entrenoEjercicios,
  entrenos,
  modeloEjercicios,
  modelosSesion,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvClub, type EnvPlantilla, requireRol, requireRolEnClub } from '../permisos.js'
import { EsquemaFecha, EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'

// Planificación de sesiones (secciones 2.8 y 7, GH-41): el plan de cada entreno (objetivo, notas y
// lista ordenada de ejercicios de la biblioteca del club), duplicarlo en otra fecha y los modelos de
// sesión del club. La asistencia del mismo entreno va por su lado: el plan no la toca.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamEntreno = z.object({
  id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }),
  eid: EsquemaUuid.openapi({ param: { name: 'eid', in: 'path' } }),
})

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((t) => t || null)

const EsquemaPaso = z.object({
  ejercicioId: EsquemaUuid,
  duracionMin: z.int().min(1).max(240).nullish(),
  indicaciones: textoOpcional(1000),
})

const EsquemaEjercicioPlan = z
  .object({
    ejercicioId: z.uuid(),
    nombre: z.string(),
    categoria: z.enum(categoriaEjercicio.enumValues).nullable(),
    archivado: z.boolean(),
    urlMiniatura: z.string().nullable(),
    duracionMin: z.int().nullable(),
    indicaciones: z.string().nullable(),
  })
  .openapi('EjercicioPlan')

const EsquemaPlan = z
  .object({
    entrenoId: z.uuid(),
    fecha: z.string(),
    hora: z.string().nullable(),
    horaFin: z.string().nullable(),
    objetivo: z.string().nullable(),
    notas: z.string().nullable(),
    duracionPrevista: z
      .int()
      .nullable()
      .openapi({ description: 'Minutos de la hora de inicio a la de fin; null sin las dos' }),
    duracionTotal: z.int().openapi({ description: 'Suma de las duraciones de los ejercicios' }),
    ejercicios: z.array(EsquemaEjercicioPlan),
  })
  .openapi('Plan')

const EsquemaModelo = z
  .object({
    id: z.uuid(),
    nombre: z.string(),
    objetivo: z.string().nullable(),
    ejercicios: z.int(),
    duracionTotal: z.int(),
  })
  .openapi('ModeloSesion')

const hhmm = (columna: typeof entrenos.hora | typeof entrenos.horaFin) =>
  sql<string | null>`to_char(${columna}, 'HH24:MI')`

const minutos = (hora: string) => {
  const [h, m] = hora.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

async function buscarEntreno(plantillaId: string, entrenoId: string) {
  const [entreno] = await db
    .select({
      id: entrenos.id,
      fecha: entrenos.fecha,
      hora: hhmm(entrenos.hora),
      horaFin: hhmm(entrenos.horaFin),
      objetivo: entrenos.objetivo,
      notas: entrenos.notas,
    })
    .from(entrenos)
    .where(and(eq(entrenos.id, entrenoId), eq(entrenos.plantillaId, plantillaId)))
  if (!entreno) throw new ErrorApi(404, 'no_encontrado', 'No existe ese entreno en la plantilla')
  return entreno
}

// La miniatura del primer medio listo de cada ejercicio
const miniaturaDe = db
  .select({ id: ejercicioMedios.id })
  .from(ejercicioMedios)
  .where(
    and(
      eq(ejercicioMedios.ejercicioId, ejercicios.id),
      eq(ejercicioMedios.estado, 'listo'),
      sql`${ejercicioMedios.miniatura} is not null`,
    ),
  )
  .orderBy(asc(ejercicioMedios.orden))
  .limit(1)

export async function leerPlan(plantillaId: string, entrenoId: string) {
  const e = await buscarEntreno(plantillaId, entrenoId)
  const filas = await db
    .select({
      ejercicioId: ejercicios.id,
      nombre: ejercicios.nombre,
      categoria: ejercicios.categoria,
      archivado: ejercicios.archivado,
      miniatura: sql<string | null>`(${miniaturaDe})`,
      duracionMin: entrenoEjercicios.duracionMin,
      indicaciones: entrenoEjercicios.indicaciones,
    })
    .from(entrenoEjercicios)
    .innerJoin(ejercicios, eq(ejercicios.id, entrenoEjercicios.ejercicioId))
    .where(eq(entrenoEjercicios.entrenoId, e.id))
    .orderBy(asc(entrenoEjercicios.orden))
  return {
    entrenoId: e.id,
    fecha: e.fecha,
    hora: e.hora,
    horaFin: e.horaFin,
    objetivo: e.objetivo,
    notas: e.notas,
    duracionPrevista: e.hora && e.horaFin ? minutos(e.horaFin) - minutos(e.hora) : null,
    duracionTotal: filas.reduce((total, f) => total + (f.duracionMin ?? 0), 0),
    ejercicios: filas.map(({ miniatura, ...f }) => ({
      ...f,
      urlMiniatura: miniatura ? `/api/medios/${miniatura}/miniatura` : null,
    })),
  }
}

type Paso = { ejercicioId: string; duracionMin?: number | null; indicaciones?: string | null }

// Los ejercicios de un plan o un modelo tienen que ser de la biblioteca del club
async function comprobarEjercicios(tx: Tx, clubId: string, pasos: Paso[]) {
  const ids = [...new Set(pasos.map((p) => p.ejercicioId))]
  if (ids.length === 0) return
  const delClub = await tx
    .select({ id: ejercicios.id })
    .from(ejercicios)
    .where(and(eq(ejercicios.clubId, clubId), inArray(ejercicios.id, ids)))
  if (delClub.length !== ids.length) {
    throw new ErrorApi(
      400,
      'ejercicio_ajeno',
      'Los ejercicios tienen que ser de la biblioteca del club',
    )
  }
}

// Sustituye el plan de un entreno
async function guardarPlan(
  tx: Tx,
  clubId: string,
  entrenoId: string,
  plan: { objetivo: string | null; notas: string | null; ejercicios: Paso[] },
) {
  await comprobarEjercicios(tx, clubId, plan.ejercicios)
  await tx
    .update(entrenos)
    .set({ objetivo: plan.objetivo, notas: plan.notas })
    .where(eq(entrenos.id, entrenoId))
  await tx.delete(entrenoEjercicios).where(eq(entrenoEjercicios.entrenoId, entrenoId))
  if (plan.ejercicios.length > 0) {
    await tx.insert(entrenoEjercicios).values(
      plan.ejercicios.map((p, orden) => ({
        entrenoId,
        ejercicioId: p.ejercicioId,
        orden,
        duracionMin: p.duracionMin ?? null,
        indicaciones: p.indicaciones ?? null,
      })),
    )
  }
}

async function pasosDelEntreno(entrenoId: string) {
  return db
    .select({
      ejercicioId: entrenoEjercicios.ejercicioId,
      duracionMin: entrenoEjercicios.duracionMin,
      indicaciones: entrenoEjercicios.indicaciones,
    })
    .from(entrenoEjercicios)
    .where(eq(entrenoEjercicios.entrenoId, entrenoId))
    .orderBy(asc(entrenoEjercicios.orden))
}

const tienePlan = (e: { objetivo: string | null }, pasos: number) =>
  Boolean(e.objetivo) || pasos > 0

export const rutasPlanes = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos/{eid}/plan',
        tags: ['Planificación'],
        summary: 'Plan de un entreno',
        description:
          'Cualquier miembro. Objetivo, notas y ejercicios en orden, con la duración total y la prevista.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamEntreno },
        responses: { 200: json(EsquemaPlan, 'Plan'), ...errores },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        return c.json(await leerPlan(c.var.plantilla.id, eid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/entrenos/{eid}/plan',
        tags: ['Planificación'],
        summary: 'Guardar el plan de un entreno',
        description:
          'Delegado o superior. Objetivo, notas y la lista completa de ejercicios en orden, en una transacción. No toca la asistencia.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    objetivo: textoOpcional(300),
                    notas: textoOpcional(2000),
                    ejercicios: z.array(EsquemaPaso).max(40),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPlan, 'Plan guardado'),
          400: json(EsquemaError, 'Datos no válidos o ejercicio de otro club'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const { objetivo, notas, ejercicios: pasos } = c.req.valid('json')
        const { id: plantillaId, clubId } = c.var.plantilla
        await buscarEntreno(plantillaId, eid)
        await db.transaction((tx) =>
          guardarPlan(tx, clubId, eid, { objetivo, notas, ejercicios: pasos }),
        )
        return c.json(await leerPlan(plantillaId, eid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/entrenos/{eid}/plan/duplicar',
        tags: ['Planificación'],
        summary: 'Duplicar el plan en otra fecha',
        description:
          'Delegado o superior. Va al primer entreno de esa fecha que no tenga plan; si ese día no hay ninguno, se crea uno suelto con las mismas horas. Si todos los de ese día tienen plan, 409.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: {
            content: { 'application/json': { schema: z.object({ fecha: EsquemaFecha }).strict() } },
          },
        },
        responses: {
          201: json(EsquemaPlan, 'Plan copiado'),
          409: json(EsquemaError, 'Todos los entrenos de ese día ya tienen plan'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const { fecha } = c.req.valid('json')
        const { id: plantillaId, clubId } = c.var.plantilla
        const origen = await buscarEntreno(plantillaId, eid)
        const pasos = await pasosDelEntreno(eid)
        const destino = await db.transaction(async (tx) => {
          const delDia = await tx
            .select({
              id: entrenos.id,
              objetivo: entrenos.objetivo,
              // Con el constructor: en un sql a mano, «id» sería el de entreno_ejercicios
              pasos: sql<number>`(${tx
                .select({ n: sql`count(*)::int` })
                .from(entrenoEjercicios)
                .where(eq(entrenoEjercicios.entrenoId, entrenos.id))})`,
            })
            .from(entrenos)
            .where(and(eq(entrenos.plantillaId, plantillaId), eq(entrenos.fecha, fecha)))
            .orderBy(sql`${entrenos.hora} asc nulls first`)
          let id = delDia.find((e) => !tienePlan(e, e.pasos))?.id
          if (!id && delDia.length > 0) {
            throw new ErrorApi(
              409,
              'ya_planificado',
              'Todos los entrenos de ese día ya tienen plan',
            )
          }
          if (!id) {
            const [nuevo] = await tx
              .insert(entrenos)
              .values({ plantillaId, fecha, hora: origen.hora, horaFin: origen.horaFin })
              .returning({ id: entrenos.id })
            id = nuevo?.id
          }
          if (!id) throw new Error('No se ha podido crear el entreno')
          await guardarPlan(tx, clubId, id, {
            objetivo: origen.objetivo,
            notas: origen.notas,
            ejercicios: pasos,
          })
          return id
        })
        return c.json(await leerPlan(plantillaId, destino), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/entrenos/{eid}/plan/guardar-modelo',
        tags: ['Planificación'],
        summary: 'Guardar el plan como modelo del club',
        description:
          'Delegado o superior. El nombre no puede repetirse en el club (sin distinguir mayúsculas).',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: {
            content: {
              'application/json': {
                schema: z.object({ nombre: EsquemaTexto('El nombre', 80) }).strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaModelo, 'Modelo guardado'),
          400: json(EsquemaError, 'Sin ejercicios en el plan'),
          409: json(EsquemaError, 'Ya hay un modelo con ese nombre'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const { nombre } = c.req.valid('json')
        const { id: plantillaId, clubId } = c.var.plantilla
        const origen = await buscarEntreno(plantillaId, eid)
        const pasos = await pasosDelEntreno(eid)
        if (pasos.length === 0) {
          throw new ErrorApi(
            400,
            'plan_vacio',
            'Añade algún ejercicio al plan antes de guardarlo como modelo',
          )
        }
        try {
          const modelo = await db.transaction(async (tx) => {
            const [creado] = await tx
              .insert(modelosSesion)
              .values({
                clubId,
                nombre,
                objetivo: origen.objetivo,
                notas: origen.notas,
                creadoPor: c.var.usuario.id,
              })
              .returning({
                id: modelosSesion.id,
                nombre: modelosSesion.nombre,
                objetivo: modelosSesion.objetivo,
              })
            if (!creado) throw new Error('No se ha podido guardar el modelo')
            await tx
              .insert(modeloEjercicios)
              .values(pasos.map((p, orden) => ({ modeloId: creado.id, ...p, orden })))
            return creado
          })
          return c.json(
            {
              ...modelo,
              ejercicios: pasos.length,
              duracionTotal: pasos.reduce((t, p) => t + (p.duracionMin ?? 0), 0),
            },
            201,
          )
        } catch (error) {
          if (restriccionViolada(error) === 'modelos_sesion_nombre_unico') {
            throw new ErrorApi(409, 'modelo_duplicado', `Ya hay un modelo llamado «${nombre}»`)
          }
          throw error
        }
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/entrenos/{eid}/plan/desde-modelo/{mid}',
        tags: ['Planificación'],
        summary: 'Aplicar un modelo al entreno',
        description:
          'Delegado o superior. Sustituye el plan del entreno por el del modelo (objetivo, notas y ejercicios).',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno.extend({
            mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
          }),
        },
        responses: { 200: json(EsquemaPlan, 'Plan del modelo aplicado'), ...errores },
      }),
      async (c) => {
        const { eid, mid } = c.req.valid('param')
        const { id: plantillaId, clubId } = c.var.plantilla
        await buscarEntreno(plantillaId, eid)
        const [modelo] = await db
          .select()
          .from(modelosSesion)
          .where(and(eq(modelosSesion.id, mid), eq(modelosSesion.clubId, clubId)))
        if (!modelo) throw new ErrorApi(404, 'no_encontrado', 'No existe ese modelo en el club')
        const pasos = await db
          .select({
            ejercicioId: modeloEjercicios.ejercicioId,
            duracionMin: modeloEjercicios.duracionMin,
            indicaciones: modeloEjercicios.indicaciones,
          })
          .from(modeloEjercicios)
          .where(eq(modeloEjercicios.modeloId, mid))
          .orderBy(asc(modeloEjercicios.orden))
        await db.transaction((tx) =>
          guardarPlan(tx, clubId, eid, {
            objetivo: modelo.objetivo,
            notas: modelo.notas,
            ejercicios: pasos,
          }),
        )
        return c.json(await leerPlan(plantillaId, eid), 200)
      },
    )

export const rutasModelosSesion = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/modelos-sesion',
        tags: ['Planificación'],
        summary: 'Modelos de sesión del club',
        description: 'Cualquier miembro de una plantilla del club.',
        middleware: [requireRolEnClub('jugador')] as const,
        request: {
          params: z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) }),
        },
        responses: { 200: json(z.array(EsquemaModelo), 'Modelos, por nombre'), ...errores },
      }),
      async (c) => {
        const { cid } = c.req.valid('param')
        const filas = await db
          .select({
            id: modelosSesion.id,
            nombre: modelosSesion.nombre,
            objetivo: modelosSesion.objetivo,
            ejercicios: sql<number>`count(${modeloEjercicios.id})::int`,
            duracionTotal: sql<number>`coalesce(sum(${modeloEjercicios.duracionMin}), 0)::int`,
          })
          .from(modelosSesion)
          .leftJoin(modeloEjercicios, eq(modeloEjercicios.modeloId, modelosSesion.id))
          .where(eq(modelosSesion.clubId, cid))
          .groupBy(modelosSesion.id)
          .orderBy(sql`lower(${modelosSesion.nombre})`)
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/modelos-sesion/{mid}',
        tags: ['Planificación'],
        summary: 'Borrar un modelo de sesión',
        description:
          'Delegado o superior en alguna plantilla del club. Los planes creados con él no cambian.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: z.object({
            cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }),
            mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
          }),
        },
        responses: { 204: { description: 'Modelo borrado' }, ...errores },
      }),
      async (c) => {
        const { cid, mid } = c.req.valid('param')
        const borrados = await db
          .delete(modelosSesion)
          .where(and(eq(modelosSesion.id, mid), eq(modelosSesion.clubId, cid)))
          .returning({ id: modelosSesion.id })
        if (borrados.length === 0)
          throw new ErrorApi(404, 'no_encontrado', 'No existe ese modelo en el club')
        return c.body(null, 204)
      },
    )
