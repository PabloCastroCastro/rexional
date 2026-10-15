import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, notInArray } from 'drizzle-orm'
import { bodyLimit } from 'hono/body-limit'
import { aEstadisticas, type Correcciones, construirLectura } from '../acta/lectura.js'
import { ActaNoLegible, leerActa } from '../acta/leer.js'
import { db } from '../db/cliente.js'
import {
  actasPartido,
  clubes,
  convocados,
  eventosPartido,
  fichas,
  jugadores,
  partidos,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { registrar } from '../estadisticas.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import {
  buscarPartido,
  detallePartido,
  EsquemaPartido,
  errores,
  json,
  noEncontrado,
  ParamPartido,
} from './partidos.js'

// Acta del partido (sección 2.7, GH-37): la ficha en PDF que publica la federación. Se sube al
// partido, se lee y el entrenador revisa lo leído; al confirmar se registra con la fuente «acta»:
// la convocatoria pasa a ser la del acta y se guardan resultado, titulares, cambios, goles y
// tarjetas. El PDF se queda en el partido para descargarlo.

const MAXIMO = 2 * 1024 * 1024

const EsquemaTarjeta = z.enum(['amarilla', 'roja'])
const EsquemaJugadorActa = z
  .object({
    dorsal: z.int().nullable(),
    nombre: z.string().openapi({ example: 'CASTRO CASTRO, PABLO' }),
    jugadorId: z.uuid().nullable().openapi({ description: 'null si no se ha emparejado' }),
  })
  .openapi('JugadorActa')
const EsquemaGolActa = z
  .object({
    nombre: z.string(),
    jugadorId: z.uuid().nullable(),
    minuto: z.int().nullable(),
    enPropia: z.boolean().openapi({
      description: 'A favor: gol en propia puerta del rival. En contra: de uno de los nuestros',
    }),
  })
  .openapi('GolActa')

const EsquemaLectura = z
  .object({
    equipo: z.enum(['local', 'visitante']),
    nombreEquipo: z.string(),
    rival: z.string(),
    competicion: z.string().nullable(),
    jornada: z.int().nullable(),
    fecha: z.string().nullable(),
    hora: z.string().nullable(),
    estadio: z.string().nullable(),
    ciudad: z.string().nullable(),
    golesFavor: z.int(),
    golesContra: z.int(),
    titulares: z.array(EsquemaJugadorActa),
    suplentes: z.array(EsquemaJugadorActa),
    cambios: z.array(
      z.object({ entra: EsquemaJugadorActa, sale: EsquemaJugadorActa, minuto: z.int().nullable() }),
    ),
    goles: z.array(EsquemaGolActa),
    golesEnContra: z.array(EsquemaGolActa),
    tarjetas: z.array(
      EsquemaJugadorActa.extend({ minuto: z.int().nullable(), tipo: EsquemaTarjeta.nullable() }),
    ),
    avisos: z.array(z.string()),
  })
  .openapi('LecturaActa')

const EsquemaActaLeida = z
  .object({
    acta: z.object({ nombreArchivo: z.string(), tamano: z.int(), subidaEn: z.string() }),
    lectura: EsquemaLectura.nullable(),
    error: z.string().nullable().openapi({ description: 'Por qué no se ha podido leer' }),
  })
  .openapi('ActaLeida')

const EsquemaCorrecciones = z
  .object({
    jugadores: z
      .array(z.object({ nombre: z.string().min(1).max(200), jugadorId: EsquemaUuid.nullable() }))
      .max(60)
      .optional()
      .openapi({ description: 'El jugador de cada nombre del acta; null para no contarlo' }),
    tarjetas: z
      .array(z.object({ indice: z.int().min(0), tipo: EsquemaTarjeta }))
      .max(40)
      .optional()
      .openapi({ description: 'Tipo de las tarjetas, por su posición en la lectura' }),
  })
  .strict()

const limite = bodyLimit({
  maxSize: MAXIMO + 64 * 1024,
  onError: () => {
    throw new ErrorApi(413, 'acta_demasiado_grande', 'El acta no puede pasar de 2 MB')
  },
})

// Jugadores con ficha en la plantilla (también de baja), para emparejar los nombres del acta
const candidatos = (plantillaId: string) =>
  db
    .select({
      jugadorId: jugadores.id,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
      dorsal: fichas.dorsal,
    })
    .from(fichas)
    .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
    .where(eq(fichas.plantillaId, plantillaId))

async function nombreClub(clubId: string) {
  const [club] = await db
    .select({ nombre: clubes.nombre })
    .from(clubes)
    .where(eq(clubes.id, clubId))
  return club?.nombre ?? ''
}

async function cargarActa(partidoId: string) {
  const [acta] = await db.select().from(actasPartido).where(eq(actasPartido.partidoId, partidoId))
  if (!acta) throw new ErrorApi(404, 'sin_acta', 'El partido no tiene acta')
  return acta
}

// Lee el acta guardada; si no se puede, la lectura es null y se explica por qué
async function leer(
  plantilla: { id: string; clubId: string },
  partidoId: string,
  correcciones?: Correcciones,
) {
  const partido = await buscarPartido(plantilla.id, partidoId)
  const acta = await cargarActa(partidoId)
  const resumen = {
    nombreArchivo: acta.nombreArchivo,
    tamano: acta.tamano,
    subidaEn: acta.subidaEn.toISOString(),
  }
  try {
    const ficha = await leerActa(acta.pdf)
    const lectura = construirLectura(
      ficha,
      partido,
      await nombreClub(plantilla.clubId),
      await candidatos(plantilla.id),
      correcciones,
    )
    return { acta: resumen, lectura, error: null }
  } catch (error) {
    if (error instanceof ActaNoLegible)
      return { acta: resumen, lectura: null, error: error.message }
    throw error
  }
}

export const rutasActas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/acta',
        tags: ['Actas'],
        summary: 'Subir el acta',
        description:
          'Delegado o superior. La ficha del partido en PDF (como mucho 2 MB), en el campo `archivo`. Sustituye a la anterior y devuelve lo leído, sin registrar nada todavía.',
        middleware: [requireRol('delegado'), limite] as const,
        request: {
          params: ParamPartido,
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
          200: json(EsquemaActaLeida, 'Acta guardada y leída'),
          400: json(EsquemaError, 'No es un PDF'),
          413: json(EsquemaError, 'Pasa de 2 MB'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const { archivo } = c.req.valid('form')
        if (!(archivo instanceof File)) {
          throw new ErrorApi(400, 'validacion', 'Adjunta el acta en PDF en el campo «archivo»')
        }
        if (archivo.size > MAXIMO) {
          throw new ErrorApi(413, 'acta_demasiado_grande', 'El acta no puede pasar de 2 MB')
        }
        const pdf = Buffer.from(await archivo.arrayBuffer())
        if (pdf.length === 0 || !pdf.subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
          throw new ErrorApi(400, 'no_es_pdf', 'El archivo no es un PDF')
        }
        await buscarPartido(c.var.plantilla.id, pid)
        const datos = {
          pdf,
          nombreArchivo: archivo.name.trim().slice(0, 200) || 'acta.pdf',
          tamano: pdf.length,
          subidaPor: c.var.usuario.id,
          subidaEn: new Date(),
        }
        await db
          .insert(actasPartido)
          .values({ partidoId: pid, ...datos })
          .onConflictDoUpdate({ target: actasPartido.partidoId, set: datos })
        return c.json(await leer(c.var.plantilla, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/acta',
        tags: ['Actas'],
        summary: 'Descargar el acta',
        description: 'El PDF tal como se subió. Cualquier miembro.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPartido },
        responses: {
          200: {
            description: 'PDF del acta',
            content: { 'application/pdf': { schema: z.string().openapi({ format: 'binary' }) } },
          },
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        const acta = await cargarActa(pid)
        const nombre = acta.nombreArchivo.replace(/[^\w.\- ]/g, '_')
        return c.body(new Uint8Array(acta.pdf), 200, {
          'content-type': 'application/pdf',
          'content-disposition': `inline; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(acta.nombreArchivo)}`,
          'cache-control': 'private, no-store',
        }) as never
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/partidos/{pid}/acta/lectura',
        tags: ['Actas'],
        summary: 'Leer el acta guardada',
        description:
          'Delegado o superior. Lo mismo que devuelve la subida, para volver a la revisión.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 200: json(EsquemaActaLeida, 'Acta leída'), ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        return c.json(await leer(c.var.plantilla, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/acta',
        tags: ['Actas'],
        summary: 'Quitar el acta',
        description:
          'Delegado o superior. Borra el PDF; lo que se registró con él se conserva (se borra evento a evento).',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 204: { description: 'Acta quitada' }, ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        await buscarPartido(c.var.plantilla.id, pid)
        const borradas = await db
          .delete(actasPartido)
          .where(eq(actasPartido.partidoId, pid))
          .returning({ id: actasPartido.partidoId })
        if (borradas.length === 0) throw new ErrorApi(404, 'sin_acta', 'El partido no tiene acta')
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/acta/confirmar',
        tags: ['Actas'],
        summary: 'Registrar el acta',
        description:
          'Delegado o superior. Con las correcciones de la revisión, registra el acta con la fuente «acta»: la convocatoria pasa a ser la del acta (se conserva a quien tiene estadísticas a mano), se guardan resultado, titulares, cambios, goles y tarjetas, y competición, lugar y hora se rellenan si estaban vacíos. Volver a confirmar sustituye lo importado antes.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: { content: { 'application/json': { schema: EsquemaCorrecciones } } },
        },
        responses: {
          200: json(EsquemaPartido, 'Acta registrada'),
          400: json(EsquemaError, 'El acta no se puede leer o lo leído no cuadra'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const correcciones = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        const de = await candidatos(plantillaId)
        const ajenos = (correcciones.jugadores ?? []).filter(
          (j) => j.jugadorId && !de.some((d) => d.jugadorId === j.jugadorId),
        )
        if (ajenos.length > 0) {
          throw new ErrorApi(
            400,
            'jugador_ajeno',
            'Solo se eligen jugadores con ficha en la plantilla',
          )
        }
        const { lectura, error } = await leer(c.var.plantilla, pid, correcciones)
        if (!lectura)
          throw new ErrorApi(400, 'acta_no_legible', error ?? 'No se ha podido leer el acta')
        if (lectura.tarjetas.some((t) => t.jugadorId && !t.tipo)) {
          throw new ErrorApi(
            400,
            'tarjeta_sin_tipo',
            'Indica el tipo de las tarjetas que no se han podido leer',
          )
        }
        const ids = [...lectura.titulares, ...lectura.suplentes].flatMap((j) =>
          j.jugadorId ? [j.jugadorId] : [],
        )
        if (new Set(ids).size !== ids.length) {
          throw new ErrorApi(
            400,
            'jugador_repetido',
            'Un jugador está elegido para dos nombres del acta',
          )
        }

        await db.transaction(async (tx) => {
          const [partido] = await tx
            .select()
            .from(partidos)
            .where(and(eq(partidos.id, pid), eq(partidos.plantillaId, plantillaId)))
            .for('update')
          if (!partido) throw noEncontrado()

          // Convocatoria del acta; se conserva a quien tiene estadísticas registradas a mano
          const conManuales = (
            await tx
              .selectDistinct({ jugadorId: eventosPartido.jugadorId })
              .from(eventosPartido)
              .where(and(eq(eventosPartido.partidoId, pid), eq(eventosPartido.origen, 'manual')))
          ).flatMap((e) => (e.jugadorId ? [e.jugadorId] : []))
          const quedan = [...new Set([...ids, ...conManuales])]
          await tx
            .delete(convocados)
            .where(
              and(
                eq(convocados.partidoId, pid),
                quedan.length > 0 ? notInArray(convocados.jugadorId, quedan) : undefined,
              ),
            )
          if (ids.length > 0) {
            await tx
              .insert(convocados)
              .values(ids.map((jugadorId) => ({ partidoId: pid, jugadorId, plantillaId })))
              .onConflictDoNothing()
          }

          await registrar(tx, pid, 'acta', aEstadisticas(lectura))

          // Datos del partido que faltaban
          const competicion = lectura.competicion
            ? `${lectura.competicion}${lectura.jornada ? ` · Jornada ${lectura.jornada}` : ''}`
            : null
          const lugar = [lectura.estadio, lectura.ciudad].filter(Boolean).join(', ') || null
          await tx
            .update(partidos)
            .set({
              competicion: partido.competicion ?? competicion,
              lugar: partido.lugar ?? lugar,
              // La hora solo si no queda antes de la citación
              hora:
                partido.hora ??
                (lectura.hora &&
                (!partido.horaCitacion || partido.horaCitacion.slice(0, 5) <= lectura.hora)
                  ? lectura.hora
                  : null),
            })
            .where(eq(partidos.id, pid))
        })
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
