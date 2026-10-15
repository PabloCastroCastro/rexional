import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import {
  type AnyColumn,
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { db } from '../db/cliente.js'
import {
  clubes,
  convocados,
  estadoPartido,
  eventosPartido,
  fichas,
  jugadores,
  origenDato,
  participaciones,
  partidos,
  tipoEvento,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { hoy, textoDia } from '../fechas.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import {
  EsquemaFecha,
  EsquemaHora,
  EsquemaTexto,
  EsquemaUuid,
  restriccionViolada,
} from '../validacion.js'
import { EsquemaPosicion, porNombre } from './jugadores.js'

// Partidos y convocatorias (secciones 2.4 y 7). La convocatoria, el resultado y lo que pasa en el
// partido son información del equipo: lo ve cualquier miembro. Convocar exige ficha activa en la plantilla; quien ya estaba convocado y causa
// baja después puede seguir en la lista.

export const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

export const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamPlantilla = z.object({ id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }) })
export const ParamPartido = ParamPlantilla.extend({
  pid: EsquemaUuid.openapi({ param: { name: 'pid', in: 'path' } }),
})

const datosPartido = {
  id: z.uuid(),
  rival: z.string().openapi({ example: 'SD Compostela' }),
  competicion: z.string().nullable().openapi({ example: 'Preferente' }),
  fecha: z.string().openapi({ example: '2026-10-18' }),
  hora: z.string().nullable().openapi({ example: '17:00' }),
  horaCitacion: z.string().nullable().openapi({ example: '16:00' }),
  lugar: z.string().nullable(),
  local: z
    .boolean()
    .nullable()
    .openapi({ description: 'true en casa, false fuera, null sin decidir' }),
  estado: z.enum(estadoPartido.enumValues),
  golesFavor: z.int().nullable().openapi({ description: 'Solo en los jugados', example: 7 }),
  golesContra: z.int().nullable().openapi({ example: 1 }),
}

const EsquemaResumenPartido = z
  .object({ ...datosPartido, convocados: z.int() })
  .openapi('ResumenPartido')

const EsquemaJugadorConvocatoria = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable(),
    dorsal: z.number().int().nullable(),
    posicion: EsquemaPosicion.nullable(),
    activo: z.boolean(),
    convocado: z.boolean(),
    titular: z
      .boolean()
      .nullable()
      .openapi({ description: 'true titular, false suplente; null si no se ha registrado' }),
    minutos: z.int().nullable().openapi({ description: 'Minutos jugados, calculados' }),
  })
  .openapi('JugadorConvocatoria')

export const EsquemaEvento = z
  .object({
    id: z.uuid(),
    jugadorId: z
      .uuid()
      .nullable()
      .openapi({ description: 'null solo en un gol en propia puerta del rival' }),
    tipo: z.enum(tipoEvento.enumValues),
    minuto: z.int().nullable(),
    origen: z.enum(origenDato.enumValues),
  })
  .openapi('EventoPartido')

export const EsquemaPartido = z
  .object({
    ...datosPartido,
    jugadores: z.array(EsquemaJugadorConvocatoria),
    eventos: z.array(EsquemaEvento).openapi({ description: 'Por minuto' }),
  })
  .openapi('Partido')

// Horas sin segundos ("17:00")
const hhmm = (columna: AnyColumn) => sql<string | null>`to_char(${columna}, 'HH24:MI')`

const columnasPartido = {
  id: partidos.id,
  rival: partidos.rival,
  competicion: partidos.competicion,
  fecha: partidos.fecha,
  hora: hhmm(partidos.hora),
  horaCitacion: hhmm(partidos.horaCitacion),
  lugar: partidos.lugar,
  local: partidos.local,
  estado: partidos.estado,
  golesFavor: partidos.golesFavor,
  golesContra: partidos.golesContra,
}

export const noEncontrado = () =>
  new ErrorApi(404, 'no_encontrado', 'No existe ese partido en la plantilla')

export async function buscarPartido(plantillaId: string, partidoId: string) {
  const [partido] = await db
    .select(columnasPartido)
    .from(partidos)
    .where(and(eq(partidos.id, partidoId), eq(partidos.plantillaId, plantillaId)))
  if (!partido) throw noEncontrado()
  return partido
}

// El partido, la lista para convocar (los activos y los de baja que ya estaban convocados) con la
// participación de cada uno, y los eventos
export async function detallePartido(plantillaId: string, partidoId: string) {
  const partido = await buscarPartido(plantillaId, partidoId)
  const filas = await db
    .select({
      jugadorId: jugadores.id,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
      dorsal: fichas.dorsal,
      posicion: fichas.posicion,
      activo: fichas.activo,
      convocado: sql<boolean>`${convocados.jugadorId} is not null`,
      titular: participaciones.titular,
      minutos: participaciones.minutos,
    })
    .from(fichas)
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .leftJoin(
      convocados,
      and(eq(convocados.jugadorId, fichas.jugadorId), eq(convocados.partidoId, partido.id)),
    )
    .leftJoin(
      participaciones,
      and(
        eq(participaciones.jugadorId, fichas.jugadorId),
        eq(participaciones.partidoId, partido.id),
      ),
    )
    .where(
      and(
        eq(fichas.plantillaId, plantillaId),
        or(eq(fichas.activo, true), sql`${convocados.jugadorId} is not null`),
      ),
    )
    .orderBy(sql`${fichas.dorsal} asc nulls last`, ...porNombre, asc(jugadores.id))
  const eventos = await db
    .select({
      id: eventosPartido.id,
      jugadorId: eventosPartido.jugadorId,
      tipo: eventosPartido.tipo,
      minuto: eventosPartido.minuto,
      origen: eventosPartido.origen,
    })
    .from(eventosPartido)
    .where(eq(eventosPartido.partidoId, partido.id))
    .orderBy(sql`${eventosPartido.minuto} asc nulls last`, asc(eventosPartido.createdAt))
  return { ...partido, jugadores: filas, eventos }
}

type Detalle = Awaited<ReturnType<typeof detallePartido>>

// Mensaje de convocatoria con el formato de WhatsApp (*negrita*); las líneas sin datos no salen
export function mensajeConvocatoria(club: string, plantilla: string, partido: Detalle) {
  const lineas = [`⚽ *${club} · ${plantilla}*`]
  lineas.push(
    `Convocatoria contra *${partido.rival}*${partido.competicion ? ` (${partido.competicion})` : ''}`,
    '',
    `📅 ${textoDia(partido.fecha)}`,
  )
  const horas = [
    partido.horaCitacion && `Citación ${partido.horaCitacion}`,
    partido.hora && `Partido ${partido.hora}`,
  ].filter(Boolean)
  if (horas.length) lineas.push(`⏰ ${horas.join(' · ')}`)
  const donde = partido.local === true ? 'en casa' : partido.local === false ? 'fuera' : null
  if (partido.lugar || donde) {
    lineas.push(
      partido.lugar
        ? `📍 ${partido.lugar}${donde ? ` (${donde})` : ''}`
        : `📍 ${donde === 'en casa' ? 'En casa' : 'Fuera'}`,
    )
  }
  const lista = partido.jugadores.filter((j) => j.convocado)
  lineas.push('')
  if (lista.length === 0) {
    lineas.push('_Convocatoria pendiente_')
  } else {
    lineas.push(`*Convocados (${lista.length})*`)
    for (const j of lista) {
      lineas.push(`${j.dorsal ?? '–'} · ${j.apellidos ? `${j.nombre} ${j.apellidos}` : j.nombre}`)
    }
  }
  return lineas.join('\n')
}

const CuerpoPartido = z.object({
  rival: EsquemaTexto('El rival'),
  fecha: EsquemaFecha,
  competicion: EsquemaTexto('La competición').nullish(),
  hora: EsquemaHora.nullish(),
  horaCitacion: EsquemaHora.nullish(),
  lugar: EsquemaTexto('El lugar', 120).nullish(),
  local: z.boolean().nullish(),
  // A «jugado» solo se llega con el resultado
  estado: z
    .enum(['programado', 'aplazado'])
    .optional()
    .openapi({ description: 'Programado o aplazado; un partido jugado se marca con su resultado' }),
})

const citacionTarde = () => {
  const mensaje = 'La citación no puede ser después de la hora del partido'
  return new ErrorApi(400, 'validacion', mensaje, [{ campo: 'horaCitacion', mensaje }])
}

const traducirError = (error: unknown) => {
  if (restriccionViolada(error) === 'partidos_citacion_antes') return citacionTarde()
  return error
}

export const rutasPartidos = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos',
        tags: ['Partidos'],
        summary: 'Partidos',
        description:
          'Próximos (desde hoy, el más cercano primero; un partido de hoy es próximo) o pasados (el más reciente primero), con el número de convocados.',
        middleware: [requireRol('jugador')] as const,
        request: {
          params: ParamPlantilla,
          query: z.object({
            cuando: z
              .enum(['proximos', 'pasados'])
              .default('proximos')
              .openapi({ param: { name: 'cuando', in: 'query' } }),
          }),
        },
        responses: { 200: json(z.array(EsquemaResumenPartido), 'Partidos'), ...errores },
      }),
      async (c) => {
        const { cuando } = c.req.valid('query')
        const proximos = cuando === 'proximos'
        const filas = await db
          .select({ ...columnasPartido, convocados: count(convocados.jugadorId) })
          .from(partidos)
          .leftJoin(convocados, eq(convocados.partidoId, partidos.id))
          .where(
            and(
              eq(partidos.plantillaId, c.var.plantilla.id),
              proximos ? gte(partidos.fecha, hoy()) : lt(partidos.fecha, hoy()),
            ),
          )
          .groupBy(partidos.id)
          .orderBy(
            proximos ? asc(partidos.fecha) : desc(partidos.fecha),
            proximos ? sql`${partidos.hora} asc nulls last` : sql`${partidos.hora} desc nulls last`,
          )
        return c.json(filas, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos',
        tags: ['Partidos'],
        summary: 'Crear un partido',
        description:
          'Delegado o superior. También en fechas pasadas, para apuntar partidos ya jugados.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoPartido.strict() } } },
        },
        responses: {
          201: json(EsquemaPartido, 'Partido creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const datos = c.req.valid('json')
        try {
          const [creado] = await db
            .insert(partidos)
            .values({ ...datos, plantillaId: c.var.plantilla.id })
            .returning({ id: partidos.id })
          if (!creado) throw new Error('No se pudo crear el partido')
          return c.json(await detallePartido(c.var.plantilla.id, creado.id), 201)
        } catch (error) {
          throw traducirError(error)
        }
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}',
        tags: ['Partidos'],
        summary: 'Un partido y su convocatoria',
        description:
          'Con la lista para convocar: los jugadores activos y los de baja que ya estaban convocados, por dorsal.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPartido },
        responses: { 200: json(EsquemaPartido, 'Partido'), ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        return c.json(await detallePartido(c.var.plantilla.id, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/partidos/{pid}',
        tags: ['Partidos'],
        summary: 'Editar un partido',
        description:
          'Delegado o superior. Los campos opcionales se quitan con null. Pasar un partido jugado a programado o aplazado quita el resultado; sus estadísticas se conservan.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: CuerpoPartido.partial()
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica algún dato que cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPartido, 'Partido actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        try {
          const actualizados = await db
            .update(partidos)
            .set(cambios.estado ? { ...cambios, golesFavor: null, golesContra: null } : cambios)
            .where(and(eq(partidos.id, pid), eq(partidos.plantillaId, c.var.plantilla.id)))
            .returning({ id: partidos.id })
          if (actualizados.length === 0) throw noEncontrado()
        } catch (error) {
          throw traducirError(error)
        }
        return c.json(await detallePartido(c.var.plantilla.id, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}',
        tags: ['Partidos'],
        summary: 'Borrar un partido',
        description: 'Delegado o superior. Borra también su convocatoria.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 204: { description: 'Partido borrado' }, ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const borrados = await db
          .delete(partidos)
          .where(and(eq(partidos.id, pid), eq(partidos.plantillaId, c.var.plantilla.id)))
          .returning({ id: partidos.id })
        if (borrados.length === 0) throw noEncontrado()
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/partidos/{pid}/convocados',
        tags: ['Partidos'],
        summary: 'Convocar',
        description:
          'Delegado o superior. Guarda la lista completa de convocados. Cada jugador nuevo en la convocatoria debe tener ficha activa en la plantilla; quien ya estaba convocado puede seguir aunque haya causado baja. No se puede quitar a quien tiene estadísticas en el partido.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z.object({
                  jugadores: z
                    .array(EsquemaUuid)
                    .max(100)
                    .refine((l) => new Set(l).size === l.length, {
                      message: 'Hay jugadores repetidos en la lista',
                    }),
                }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPartido, 'Convocatoria guardada'),
          400: json(EsquemaError, 'Datos no válidos o jugador que no se puede convocar'),
          409: json(EsquemaError, 'Se quita a un jugador con estadísticas en el partido'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const { jugadores: lista } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)

        await db.transaction(async (tx) => {
          // Bloquea el partido: dos guardados a la vez van uno detrás de otro
          const [bloqueado] = await tx
            .select({ id: partidos.id })
            .from(partidos)
            .where(eq(partidos.id, pid))
            .for('update')
          if (!bloqueado) throw noEncontrado()

          if (lista.length > 0) {
            const convocables = await tx
              .select({ jugadorId: fichas.jugadorId })
              .from(fichas)
              .leftJoin(
                convocados,
                and(eq(convocados.jugadorId, fichas.jugadorId), eq(convocados.partidoId, pid)),
              )
              .where(
                and(
                  eq(fichas.plantillaId, plantillaId),
                  inArray(fichas.jugadorId, lista),
                  or(eq(fichas.activo, true), sql`${convocados.jugadorId} is not null`),
                ),
              )
            if (convocables.length !== lista.length) {
              throw new ErrorApi(
                400,
                'jugador_no_convocable',
                'Solo se convoca a jugadores con ficha activa en la plantilla',
              )
            }
          }
          // Quitarlo borraría sus minutos y sus goles: antes hay que quitar sus estadísticas
          const conEstadisticas = await tx
            .selectDistinct({ nombre: jugadores.nombre, apellidos: jugadores.apellidos })
            .from(jugadores)
            .where(
              and(
                lista.length > 0 ? notInArray(jugadores.id, lista) : undefined,
                or(
                  sql`exists (select 1 from ${participaciones} where ${participaciones.partidoId} = ${pid} and ${participaciones.jugadorId} = ${jugadores.id})`,
                  sql`exists (select 1 from ${eventosPartido} where ${eventosPartido.partidoId} = ${pid} and ${eventosPartido.jugadorId} = ${jugadores.id})`,
                ),
              ),
            )
          const [primero] = conEstadisticas
          if (primero) {
            const nombre = primero.apellidos
              ? `${primero.nombre} ${primero.apellidos}`
              : primero.nombre
            throw new ErrorApi(
              409,
              'convocado_con_estadisticas',
              `${nombre} tiene estadísticas en este partido: quítalas antes de sacarlo de la convocatoria`,
            )
          }
          await tx.delete(convocados).where(eq(convocados.partidoId, pid))
          if (lista.length > 0) {
            await tx
              .insert(convocados)
              .values(lista.map((jugadorId) => ({ partidoId: pid, jugadorId, plantillaId })))
          }
        })
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/mensaje',
        tags: ['Partidos'],
        summary: 'Mensaje de convocatoria',
        description:
          'Texto de la convocatoria con el formato de WhatsApp, y el enlace wa.me para compartirlo.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPartido },
        responses: {
          200: json(
            z
              .object({
                texto: z.string(),
                whatsapp: z.string().openapi({ example: 'https://wa.me/?text=…' }),
              })
              .openapi('MensajeConvocatoria'),
            'Mensaje',
          ),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const partido = await detallePartido(c.var.plantilla.id, pid)
        const [club] = await db
          .select({ nombre: clubes.nombre })
          .from(clubes)
          .where(eq(clubes.id, c.var.plantilla.clubId))
        const texto = mensajeConvocatoria(club?.nombre ?? '', c.var.plantilla.nombre, partido)
        return c.json({ texto, whatsapp: `https://wa.me/?text=${encodeURIComponent(texto)}` }, 200)
      },
    )
