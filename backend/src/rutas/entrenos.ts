import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, gte, inArray, lte, notExists, or, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import {
  asistencias,
  entrenoEjercicios,
  entrenos,
  estadoAsistencia,
  fichas,
  horarios,
  jugadores,
  type SesionHorario,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { hoy, sumarDias } from '../fechas.js'
import { type EnvPlantilla, requireRol, rolAlcanza } from '../permisos.js'
import { EsquemaFecha, EsquemaHora, EsquemaUuid, restriccionViolada } from '../validacion.js'
import { EsquemaPosicion, porNombre } from './jugadores.js'

// Calendario de entrenos y asistencia (secciones 2.3 y 7). Los entrenos se planifican antes de pasar
// lista: los crea el horario semanal de la plantilla o se crean sueltos, y un día puede tener varios
// (doble sesión). Solo se pasa lista de un entreno que existe y que no es futuro. El rol jugador solo
// recibe sus propios datos; los recuentos de cada entreno no identifican a nadie.

const ESTADOS = estadoAsistencia.enumValues
type Estado = (typeof ESTADOS)[number]

const EsquemaEstado = z.enum(ESTADOS)

const EsquemaRecuentos = z
  .object({ asiste: z.int(), justificada: z.int(), falta: z.int() })
  .openapi('RecuentosAsistencia')

const datosEntreno = {
  id: z.uuid(),
  fecha: z.string().openapi({ example: '2026-10-13' }),
  hora: z.string().nullable().openapi({ example: '20:00' }),
  horaFin: z.string().nullable().openapi({ example: '21:30' }),
  deHorario: z.boolean().openapi({ description: 'true si lo creó el horario; false si es suelto' }),
}

const EsquemaResumenEntreno = EsquemaRecuentos.extend(datosEntreno).openapi('ResumenEntreno')

const EsquemaEntreno = z
  .object({
    ...datosEntreno,
    recuentos: EsquemaRecuentos,
    jugadores: z.array(
      z.object({
        jugadorId: z.uuid(),
        nombre: z.string(),
        apellidos: z.string().nullable(),
        dorsal: z.number().int().nullable(),
        posicion: EsquemaPosicion.nullable(),
        activo: z.boolean(),
        estado: EsquemaEstado.nullable(),
        motivo: z.string().nullable(),
      }),
    ),
  })
  .openapi('Entreno')

const EsquemaSesion = z
  .object({
    dia: z
      .int()
      .min(1, 'El día va de 1 (lunes) a 7 (domingo)')
      .max(7, 'El día va de 1 (lunes) a 7 (domingo)'),
    hora: EsquemaHora,
    horaFin: EsquemaHora.nullish(),
  })
  .refine((s) => !s.horaFin || s.horaFin > s.hora, {
    path: ['horaFin'],
    message: 'La hora de fin debe ser posterior a la de inicio',
  })
  .openapi('SesionHorario')

const EsquemaHorario = z
  .object({ desde: EsquemaFecha, hasta: EsquemaFecha, sesiones: z.array(EsquemaSesion) })
  .openapi('Horario')

const EsquemaAsistenciaJugador = EsquemaRecuentos.extend({
  jugadorId: z.uuid(),
  nombre: z.string(),
  apellidos: z.string().nullable(),
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
const ParamEntreno = ParamPlantilla.extend({
  eid: EsquemaUuid.openapi({ param: { name: 'eid', in: 'path' } }),
})

const MAXIMO_DIAS_HORARIO = 366

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

// Día de la semana ISO: 1 lunes … 7 domingo
const diaSemana = (fecha: string) => new Date(`${fecha}T00:00:00Z`).getUTCDay() || 7

const recuento = (estado: Estado) =>
  sql<number>`(count(${asistencias.estado}) filter (where ${asistencias.estado} = ${estado}))::int`

// Las horas sin segundos ("20:00")
const horaEntreno = sql<string | null>`to_char(${entrenos.hora}, 'HH24:MI')`
const horaFinEntreno = sql<string | null>`to_char(${entrenos.horaFin}, 'HH24:MI')`

const columnasEntreno = {
  id: entrenos.id,
  fecha: entrenos.fecha,
  hora: horaEntreno,
  horaFin: horaFinEntreno,
  deHorario: entrenos.deHorario,
}

const sinAsistencias = () =>
  notExists(
    db.select({ uno: sql`1` }).from(asistencias).where(eq(asistencias.entrenoId, entrenos.id)),
  )

// Delegado o superior ve a todos; el rol jugador, solo su fila (si su usuario es un jugador del club)
const visibles = <T extends { jugadorId: string }>(
  filas: T[],
  variables: EnvPlantilla['Variables'],
) =>
  rolAlcanza(variables.rol, 'delegado')
    ? filas
    : filas.filter((f) => f.jugadorId === variables.jugadorId)

async function buscarEntreno(plantillaId: string, entrenoId: string) {
  const [entreno] = await db
    .select(columnasEntreno)
    .from(entrenos)
    .where(and(eq(entrenos.id, entrenoId), eq(entrenos.plantillaId, plantillaId)))
  if (!entreno) throw new ErrorApi(404, 'no_encontrado', 'No existe ese entreno en la plantilla')
  return entreno
}

// Un entreno con su lista: los jugadores activos y los de baja que tienen asistencia registrada en él
async function detalleEntreno(plantillaId: string, entrenoId: string) {
  const entreno = await buscarEntreno(plantillaId, entrenoId)
  const filas = await db
    .select({
      jugadorId: jugadores.id,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
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
      and(eq(asistencias.jugadorId, fichas.jugadorId), eq(asistencias.entrenoId, entreno.id)),
    )
    .where(
      and(
        eq(fichas.plantillaId, plantillaId),
        or(eq(fichas.activo, true), sql`${asistencias.estado} is not null`),
      ),
    )
    .orderBy(sql`${fichas.dorsal} asc nulls last`, ...porNombre, asc(jugadores.id))

  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const f of filas) if (f.estado) recuentos[f.estado] += 1
  return { ...entreno, recuentos, jugadores: filas }
}

// La hora de fin necesita la de inicio y es posterior a ella
function validarHoras(h: { hora?: string | null; horaFin?: string | null }, ctx: z.RefinementCtx) {
  if (!h.horaFin) return
  if (!h.hora) {
    ctx.addIssue({ code: 'custom', path: ['horaFin'], message: 'Indica también la hora de inicio' })
  } else if (h.horaFin <= h.hora) {
    ctx.addIssue({
      code: 'custom',
      path: ['horaFin'],
      message: 'La hora de fin debe ser posterior a la de inicio',
    })
  }
}

const horaFinNoValida = () => {
  const mensaje = 'La hora de fin debe ser posterior a la de inicio'
  return new ErrorApi(400, 'validacion', mensaje, [{ campo: 'horaFin', mensaje }])
}

const entrenoDuplicado = (fecha: string, hora: string | null) =>
  new ErrorApi(
    409,
    'entreno_duplicado',
    hora
      ? `Ya hay un entreno el ${fecha} a las ${hora}`
      : `Ya hay un entreno sin hora el ${fecha}: indica la hora de la otra sesión`,
    [{ campo: 'hora', mensaje: 'Ya hay un entreno ese día a esa hora' }],
  )

const CuerpoHorario = z
  .object({
    desde: EsquemaFecha,
    hasta: EsquemaFecha,
    sesiones: z.array(EsquemaSesion).min(1, 'Indica al menos un día de entreno').max(14),
  })
  .superRefine((h, ctx) => {
    if (h.hasta < h.desde) {
      ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Debe ser posterior a «desde»' })
    } else if (diasEntre(h.desde, h.hasta) > MAXIMO_DIAS_HORARIO) {
      ctx.addIssue({ code: 'custom', path: ['hasta'], message: 'Como mucho, un año' })
    }
    const vistas = new Set<string>()
    h.sesiones.forEach((s, i) => {
      const clave = `${s.dia} ${s.hora}`
      if (vistas.has(clave)) {
        ctx.addIssue({ code: 'custom', path: ['sesiones', i], message: 'Sesión repetida' })
      }
      vistas.add(clave)
    })
  })

// Fechas y horas que crea un horario a partir de un día: cada fecha de [inicio, hasta] cuyo día de la
// semana tiene sesión
function sesionesDelHorario(horario: { hasta: string; sesiones: SesionHorario[] }, inicio: string) {
  const resultado: { fecha: string; hora: string; horaFin: string | null }[] = []
  for (let fecha = inicio; fecha <= horario.hasta; fecha = sumarDias(fecha, 1)) {
    for (const s of horario.sesiones)
      if (s.dia === diaSemana(fecha))
        resultado.push({ fecha, hora: s.hora, horaFin: s.horaFin ?? null })
  }
  return resultado
}

// Sin plan: ni ejercicios ni objetivo (ciclo 7)
const sinPlan = () =>
  and(
    sql`${entrenos.objetivo} is null`,
    notExists(
      db
        .select({ uno: sql`1` })
        .from(entrenoEjercicios)
        .where(eq(entrenoEjercicios.entrenoId, entrenos.id)),
    ),
  )

// Borra los entrenos futuros del horario que aún no tienen asistencia ni plan (los que tienen algo se
// conservan)
async function borrarFuturosDelHorario(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  plantillaId: string,
) {
  const borrados = await tx
    .delete(entrenos)
    .where(
      and(
        eq(entrenos.plantillaId, plantillaId),
        eq(entrenos.deHorario, true),
        gte(entrenos.fecha, hoy()),
        sinAsistencias(),
        sinPlan(),
      ),
    )
    .returning({ id: entrenos.id })
  return borrados.length
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
        path: '/plantillas/{id}/horario',
        tags: ['Entrenos'],
        summary: 'Horario de entrenos',
        description: 'Horario semanal de la plantilla, o null si no tiene.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(EsquemaHorario.nullable(), 'Horario'), ...errores },
      }),
      async (c) => {
        const [horario] = await db
          .select({ desde: horarios.desde, hasta: horarios.hasta, sesiones: horarios.sesiones })
          .from(horarios)
          .where(eq(horarios.plantillaId, c.var.plantilla.id))
        return c.json(horario ?? null, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/horario',
        tags: ['Entrenos'],
        summary: 'Guardar el horario',
        description: `Delegado o superior. Crea los entrenos del horario entre «desde» (o hoy, si es anterior) y «hasta», como mucho un año. Al cambiarlo, se borran los entrenos futuros del horario que aún no tienen asistencia y se vuelven a crear; los que tienen asistencia, los pasados y los sueltos no se tocan, y no se crea un entreno donde ya hay uno a la misma hora.`,
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoHorario } } },
        },
        responses: {
          200: json(
            z.object({ horario: EsquemaHorario, creados: z.int(), borrados: z.int() }),
            'Horario guardado',
          ),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const horario = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const inicio = horario.desde > hoy() ? horario.desde : hoy()

        const resultado = await db.transaction(async (tx) => {
          await tx
            .insert(horarios)
            .values({ plantillaId, ...horario })
            .onConflictDoUpdate({ target: horarios.plantillaId, set: horario })
          const borrados = await borrarFuturosDelHorario(tx, plantillaId)
          const nuevos = sesionesDelHorario(horario, inicio)
          const creados = nuevos.length
            ? await tx
                .insert(entrenos)
                .values(nuevos.map((n) => ({ plantillaId, ...n, deHorario: true })))
                .onConflictDoNothing()
                .returning({ id: entrenos.id })
            : []
          return { borrados, creados: creados.length }
        })
        return c.json({ horario, ...resultado }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/horario',
        tags: ['Entrenos'],
        summary: 'Quitar el horario',
        description:
          'Delegado o superior. Borra el horario y sus entrenos futuros sin asistencia; el resto se conserva.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(z.object({ borrados: z.int() }), 'Horario quitado'), ...errores },
      }),
      async (c) => {
        const plantillaId = c.var.plantilla.id
        const borrados = await db.transaction(async (tx) => {
          await tx.delete(horarios).where(eq(horarios.plantillaId, plantillaId))
          return borrarFuturosDelHorario(tx, plantillaId)
        })
        return c.json({ borrados }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos',
        tags: ['Entrenos'],
        summary: 'Entrenos',
        description:
          'Entrenos de la plantilla entre `desde` y `hasta` (ambos opcionales), del más reciente al más antiguo y, en un mismo día, por hora. Con el recuento de cada estado: no identifica a nadie, así que lo ve cualquier miembro.',
        middleware: [requireRol('jugador')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            desde: EsquemaFecha.optional().openapi({ param: { name: 'desde', in: 'query' } }),
            hasta: EsquemaFecha.optional().openapi({ param: { name: 'hasta', in: 'query' } }),
          }),
        },
        responses: {
          200: json(z.array(EsquemaResumenEntreno), 'Entrenos'),
          400: json(EsquemaError, 'Fechas no válidas'),
          ...errores,
        },
      }),
      async (c) => {
        const { desde, hasta } = c.req.valid('query')
        const filas = await db
          .select({
            ...columnasEntreno,
            asiste: recuento('asiste'),
            justificada: recuento('justificada'),
            falta: recuento('falta'),
          })
          .from(entrenos)
          .leftJoin(asistencias, eq(asistencias.entrenoId, entrenos.id))
          .where(
            and(
              eq(entrenos.plantillaId, c.var.plantilla.id),
              desde ? gte(entrenos.fecha, desde) : undefined,
              hasta ? lte(entrenos.fecha, hasta) : undefined,
            ),
          )
          .groupBy(entrenos.id)
          .orderBy(desc(entrenos.fecha), sql`${entrenos.hora} asc nulls first`)
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/entrenos',
        tags: ['Entrenos'],
        summary: 'Crear un entreno',
        description:
          'Delegado o superior. Un entreno suelto, también en un día que ya tiene otro (doble sesión) si es a otra hora.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    fecha: EsquemaFecha,
                    hora: EsquemaHora.nullish(),
                    horaFin: EsquemaHora.nullish(),
                  })
                  .strict()
                  .superRefine(validarHoras),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaResumenEntreno, 'Entreno creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya hay un entreno ese día a esa hora'),
          ...errores,
        },
      }),
      async (c) => {
        const { fecha, hora = null, horaFin = null } = c.req.valid('json')
        try {
          const [creado] = await db
            .insert(entrenos)
            .values({ plantillaId: c.var.plantilla.id, fecha, hora, horaFin })
            .returning({ id: entrenos.id })
          if (!creado) throw new Error('No se pudo crear el entreno')
          const entreno = await buscarEntreno(c.var.plantilla.id, creado.id)
          return c.json({ ...entreno, asiste: 0, justificada: 0, falta: 0 }, 201)
        } catch (error) {
          if (restriccionViolada(error) === 'entrenos_fecha_hora_unica') {
            throw entrenoDuplicado(fecha, hora)
          }
          throw error
        }
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos/{eid}',
        tags: ['Entrenos'],
        summary: 'Un entreno y su lista',
        description:
          'Los jugadores activos y los de baja con asistencia registrada en el entreno, con su estado. El rol jugador solo recibe su fila.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamEntreno },
        responses: { 200: json(EsquemaEntreno, 'Entreno'), ...errores },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const entreno = await detalleEntreno(c.var.plantilla.id, eid)
        return c.json({ ...entreno, jugadores: visibles(entreno.jugadores, c.var) }, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/entrenos/{eid}',
        tags: ['Entrenos'],
        summary: 'Cambiar la hora de un entreno',
        description:
          'Delegado o superior. Hora de inicio y de fin (null las quita). Un entreno del horario que se cambia a mano pasa a ser suelto: al cambiar el horario ya no se rehace.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({ hora: EsquemaHora.nullable(), horaFin: EsquemaHora.nullish() })
                  .strict()
                  .superRefine(validarHoras),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaResumenEntreno, 'Entreno actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya hay un entreno ese día a esa hora'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const { hora, horaFin = null } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const actual = await buscarEntreno(plantillaId, eid)
        try {
          await db
            .update(entrenos)
            .set({ hora, horaFin, deHorario: false })
            .where(and(eq(entrenos.id, eid), eq(entrenos.plantillaId, plantillaId)))
        } catch (error) {
          const restriccion = restriccionViolada(error)
          if (restriccion === 'entrenos_fecha_hora_unica')
            throw entrenoDuplicado(actual.fecha, hora)
          if (restriccion === 'entrenos_hora_fin_posterior') throw horaFinNoValida()
          throw error
        }
        const [resumen] = await db
          .select({
            ...columnasEntreno,
            asiste: recuento('asiste'),
            justificada: recuento('justificada'),
            falta: recuento('falta'),
          })
          .from(entrenos)
          .leftJoin(asistencias, eq(asistencias.entrenoId, entrenos.id))
          .where(eq(entrenos.id, eid))
          .groupBy(entrenos.id)
        return c.json(resumen, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/entrenos/{eid}',
        tags: ['Entrenos'],
        summary: 'Cancelar un entreno',
        description: 'Delegado o superior. Borra el entreno y su asistencia, si la tiene.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamEntreno },
        responses: { 204: { description: 'Entreno cancelado' }, ...errores },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const borrados = await db
          .delete(entrenos)
          .where(and(eq(entrenos.id, eid), eq(entrenos.plantillaId, c.var.plantilla.id)))
          .returning({ id: entrenos.id })
        if (borrados.length === 0) {
          throw new ErrorApi(404, 'no_encontrado', 'No existe ese entreno en la plantilla')
        }
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/entrenos/{eid}/asistencias',
        tags: ['Entrenos'],
        summary: 'Pasar lista',
        description:
          'Delegado o superior. Guarda la lista completa del entreno: quien no aparece queda sin registrar, y una lista vacía lo deja sin asistencia (el entreno sigue en el calendario). No admite entrenos futuros.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamEntreno,
          body: { content: { 'application/json': { schema: CuerpoAsistencias } } },
        },
        responses: {
          200: json(EsquemaEntreno, 'Asistencia guardada'),
          400: json(EsquemaError, 'Datos no válidos, entreno futuro o jugador sin ficha'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const { asistencias: lista } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const entreno = await buscarEntreno(plantillaId, eid)

        if (entreno.fecha > hoy()) {
          throw new ErrorApi(
            400,
            'fecha_futura',
            'No se puede pasar lista de un entreno que no ha llegado',
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
            // Bloquea el entreno: dos guardados a la vez van uno detrás de otro, y si lo han
            // cancelado mientras tanto, no se guarda nada
            const [bloqueado] = await tx
              .select({ id: entrenos.id })
              .from(entrenos)
              .where(eq(entrenos.id, entreno.id))
              .for('update')
            if (!bloqueado) {
              throw new ErrorApi(404, 'no_encontrado', 'No existe ese entreno en la plantilla')
            }
            await tx.delete(asistencias).where(eq(asistencias.entrenoId, entreno.id))
            if (lista.length > 0) {
              await tx
                .insert(asistencias)
                .values(lista.map((a) => ({ ...a, entrenoId: entreno.id, plantillaId })))
            }
          })
        } catch (error) {
          if (restriccionViolada(error) === 'asistencias_ficha_fk') throw sinFicha()
          throw error
        }

        return c.json(await detalleEntreno(plantillaId, entreno.id), 200)
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
            apellidos: jugadores.apellidos,
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
          .orderBy(sql`${fichas.dorsal} asc nulls last`, ...porNombre, asc(jugadores.id))

        const conPorcentaje = filas.map((f) => {
          const total = f.asiste + f.justificada + f.falta
          return { ...f, porcentaje: total === 0 ? null : Math.round((100 * f.asiste) / total) }
        })
        return c.json(visibles(conPorcentaje, c.var), 200)
      },
    )
