import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import {
  asistencias,
  convocados,
  eventosPartido,
  fichas,
  jugadores,
  participaciones,
  partidos,
  plantillas,
  tipoEvento,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { bloquearPartido, calcularEncajados, calcularMinutos, recalcular } from '../estadisticas.js'
import {
  type EnvClub,
  type EnvPlantilla,
  requireRol,
  requireRolEnClub,
  rolAlcanza,
} from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import { porNombre } from './jugadores.js'
import {
  buscarPartido,
  detallePartido,
  EsquemaPartido,
  errores,
  json,
  ParamPartido,
} from './partidos.js'

// Estadísticas de partido (secciones 2.7 y 7): resultado, titulares y suplentes y eventos de cada
// partido, que ve cualquier miembro, y los acumulados de la temporada y del club. Los acumulados
// solo cuentan partidos jugados; un jugador solo ve los suyos. Cada cambio pasa por el servicio de
// estadísticas, que comprueba el partido en conjunto y recalcula los minutos.

const EsquemaGoles = z.int().min(0).max(99)

const EsquemaNuevoEvento = z
  .object({
    jugadorId: EsquemaUuid.nullish(),
    tipo: z.enum(tipoEvento.enumValues),
    minuto: z.int().min(0).max(150).nullish(),
  })
  .strict()
  .openapi('NuevoEvento')

type NuevoEvento = z.infer<typeof EsquemaNuevoEvento>

// Registra los eventos juntos: si uno no cuadra, no se guarda ninguno
async function anadirEventos(partidoId: string, eventos: NuevoEvento[]) {
  await db.transaction(async (tx) => {
    await bloquearPartido(tx, partidoId)
    if (eventos.some((e) => !e.jugadorId && e.tipo !== 'gol_propia' && e.tipo !== 'gol_rival')) {
      throw new ErrorApi(400, 'estadisticas_incoherentes', 'Falta el jugador del evento')
    }
    if (eventos.some((e) => e.jugadorId && e.tipo === 'gol_rival')) {
      throw new ErrorApi(400, 'estadisticas_incoherentes', 'Un gol del rival no lleva jugador')
    }
    await comprobarConvocados(
      tx,
      partidoId,
      eventos.flatMap((e) => (e.jugadorId ? [e.jugadorId] : [])),
    )
    await tx.insert(eventosPartido).values(
      eventos.map((e) => ({
        partidoId,
        jugadorId: e.jugadorId ?? null,
        tipo: e.tipo,
        minuto: e.minuto ?? null,
      })),
    )
    await recalcular(tx, partidoId)
  })
}

const ParamEvento = ParamPartido.extend({
  evid: EsquemaUuid.openapi({ param: { name: 'evid', in: 'path' } }),
})

const datosEstadisticas = {
  partidos: z.int().openapi({ description: 'Partidos jugados (con algún minuto)' }),
  titularidades: z.int(),
  minutos: z.int(),
  goles: z.int(),
  asistencias: z.int(),
  amarillas: z.int(),
  rojas: z.int(),
  golesPropia: z.int().openapi({ description: 'Goles en propia puerta' }),
}

const EsquemaEstadisticasJugador = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable(),
    dorsal: z.int().nullable(),
    activo: z.boolean(),
    ...datosEstadisticas,
    entrenos: z.int().openapi({
      description: 'Entrenos de la plantilla a los que ha ido (solo se pasa lista hasta hoy)',
    }),
    golesEncajados: z.int().openapi({
      description:
        'Goles en contra con el jugador en el campo, en los partidos con todos sus goles en contra con minuto',
    }),
    minutosConEncajados: z.int().openapi({
      description: 'Minutos jugados en esos mismos partidos: la base de los goles encajados por 90',
    }),
  })
  .openapi('EstadisticasJugador')

const EsquemaEstadisticasPlantilla = z
  .object({
    equipo: z.object({
      jugados: z.int(),
      ganados: z.int(),
      empatados: z.int(),
      perdidos: z.int(),
      golesFavor: z.int(),
      golesContra: z.int(),
      sinMinutoEnContra: z.int().openapi({
        description:
          'Partidos jugados a los que les falta el minuto de algún gol en contra: no cuentan para los goles encajados',
      }),
    }),
    jugadores: z.array(EsquemaEstadisticasJugador),
  })
  .openapi('EstadisticasPlantilla')

const EsquemaTrayectoria = z
  .object({
    jugadorId: z.uuid(),
    nombre: z.string(),
    apellidos: z.string().nullable(),
    temporadas: z.array(
      z.object({
        plantillaId: z.uuid(),
        plantilla: z.string(),
        temporada: z.string(),
        dorsal: z.int().nullable(),
        ...datosEstadisticas,
      }),
    ),
    totales: z.object(datosEstadisticas),
  })
  .openapi('TrayectoriaEstadisticas')

// Acumulados por plantilla y jugador en los partidos jugados, de una plantilla o de un jugador
function acumulados(filtro: { plantillaId: string } | { jugadorId: string }) {
  const jugado = and(
    eq(partidos.estado, 'jugado'),
    'plantillaId' in filtro ? eq(partidos.plantillaId, filtro.plantillaId) : undefined,
  )
  const delJugador = (
    columna: typeof participaciones.jugadorId | typeof eventosPartido.jugadorId,
  ) => ('jugadorId' in filtro ? eq(columna, filtro.jugadorId) : undefined)
  const enCampo = db
    .select({
      plantillaId: sql<string>`${partidos.plantillaId}`.as('pp_plantilla'),
      jugadorId: sql<string>`${participaciones.jugadorId}`.as('pp_jugador'),
      partidos: sql<number>`count(*) filter (where ${participaciones.minutos} > 0)`.as('partidos'),
      titularidades: sql<number>`count(*) filter (where ${participaciones.titular})`.as(
        'titularidades',
      ),
      minutos: sql<number>`coalesce(sum(${participaciones.minutos}), 0)`.as('minutos'),
    })
    .from(participaciones)
    .innerJoin(partidos, eq(partidos.id, participaciones.partidoId))
    .where(and(jugado, delJugador(participaciones.jugadorId)))
    .groupBy(partidos.plantillaId, participaciones.jugadorId)
    .as('en_campo')
  const cuenta = (tipo: (typeof tipoEvento.enumValues)[number]) =>
    sql<number>`count(*) filter (where ${eventosPartido.tipo} = ${tipo})`
  const eventos = db
    .select({
      plantillaId: sql<string>`${partidos.plantillaId}`.as('ev_plantilla'),
      jugadorId: sql<string>`${eventosPartido.jugadorId}`.as('ev_jugador'),
      goles: cuenta('gol').as('goles'),
      asistencias: cuenta('asistencia').as('asistencias'),
      amarillas: cuenta('amarilla').as('amarillas'),
      rojas: cuenta('roja').as('rojas'),
      golesPropia: cuenta('gol_propia').as('goles_propia'),
    })
    .from(eventosPartido)
    .innerJoin(partidos, eq(partidos.id, eventosPartido.partidoId))
    .where(
      and(
        jugado,
        delJugador(eventosPartido.jugadorId),
        sql`${eventosPartido.jugadorId} is not null`,
      ),
    )
    .groupBy(partidos.plantillaId, eventosPartido.jugadorId)
    .as('eventos')
  const n = (columna: unknown) => sql<number>`coalesce(${columna}, 0)::int`
  const columnas = {
    partidos: n(enCampo.partidos),
    titularidades: n(enCampo.titularidades),
    minutos: n(enCampo.minutos),
    goles: n(eventos.goles),
    asistencias: n(eventos.asistencias),
    amarillas: n(eventos.amarillas),
    rojas: n(eventos.rojas),
    golesPropia: n(eventos.golesPropia),
  }
  return { enCampo, eventos, columnas }
}

const sumar = (filas: Record<keyof typeof datosEstadisticas, number>[]) =>
  Object.fromEntries(
    Object.keys(datosEstadisticas).map((clave) => [
      clave,
      filas.reduce((total, f) => total + f[clave as keyof typeof datosEstadisticas], 0),
    ]),
  ) as Record<keyof typeof datosEstadisticas, number>

export const rutasEstadisticas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/partidos/{pid}/resultado',
        tags: ['Estadísticas'],
        summary: 'Poner el resultado',
        description:
          'Delegado o superior. Marca el partido como jugado. Los goles registrados no pueden pasar del resultado.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z.object({ golesFavor: EsquemaGoles, golesContra: EsquemaGoles }).strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPartido, 'Resultado guardado'),
          400: json(EsquemaError, 'Datos no válidos o que no cuadran con los goles registrados'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await db.transaction(async (tx) => {
          await bloquearPartido(tx, pid)
          await tx
            .update(partidos)
            .set({ estado: 'jugado', ...c.req.valid('json') })
            .where(eq(partidos.id, pid))
          await recalcular(tx, pid)
        })
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/resultado',
        tags: ['Estadísticas'],
        summary: 'Quitar el resultado',
        description:
          'Delegado o superior. El partido vuelve a programado; titulares, suplentes y eventos se conservan.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamPartido },
        responses: { 200: json(EsquemaPartido, 'Resultado quitado'), ...errores },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await db
          .update(partidos)
          .set({ estado: 'programado', golesFavor: null, golesContra: null })
          .where(eq(partidos.id, pid))
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/partidos/{pid}/participaciones',
        tags: ['Estadísticas'],
        summary: 'Titulares y suplentes',
        description:
          'Delegado o superior. Lista completa, entre los convocados; como mucho 11 titulares. Los minutos jugados se calculan con los cambios.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    titulares: z.array(EsquemaUuid).max(11),
                    suplentes: z.array(EsquemaUuid).max(50),
                  })
                  .strict()
                  .refine(
                    (d) =>
                      new Set([...d.titulares, ...d.suplentes]).size ===
                      d.titulares.length + d.suplentes.length,
                    { message: 'Un jugador aparece dos veces entre titulares y suplentes' },
                  ),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaPartido, 'Titulares y suplentes guardados'),
          400: json(EsquemaError, 'Datos no válidos o que no cuadran con los eventos'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const { titulares, suplentes } = c.req.valid('json')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        const lista = [
          ...titulares.map((jugadorId) => ({ partidoId: pid, jugadorId, titular: true })),
          ...suplentes.map((jugadorId) => ({ partidoId: pid, jugadorId, titular: false })),
        ]
        await db.transaction(async (tx) => {
          await bloquearPartido(tx, pid)
          await comprobarConvocados(
            tx,
            pid,
            lista.map((p) => p.jugadorId),
          )
          await tx.delete(participaciones).where(eq(participaciones.partidoId, pid))
          if (lista.length > 0) await tx.insert(participaciones).values(lista)
          await recalcular(tx, pid)
        })
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/eventos',
        tags: ['Estadísticas'],
        summary: 'Registrar un evento',
        description:
          'Delegado o superior. Gol, asistencia, tarjeta, cambio (entra o sale, con minuto) o gol en propia puerta (sin jugador: del rival a nuestro favor). Solo de convocados.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': { schema: EsquemaNuevoEvento },
            },
          },
        },
        responses: {
          201: json(EsquemaPartido, 'Evento registrado'),
          400: json(EsquemaError, 'Datos no válidos o que no cuadran con el partido'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await anadirEventos(pid, [c.req.valid('json')])
        return c.json(await detallePartido(plantillaId, pid), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/partidos/{pid}/eventos/lote',
        tags: ['Estadísticas'],
        summary: 'Registrar varios eventos a la vez',
        description:
          'Delegado o superior. Todo o nada: para un cambio (entra y sale) o un gol con su asistencia. Si uno no cuadra con el partido, no se guarda ninguno.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamPartido,
          body: {
            content: {
              'application/json': {
                schema: z.object({ eventos: z.array(EsquemaNuevoEvento).min(1).max(10) }).strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaPartido, 'Eventos registrados'),
          400: json(EsquemaError, 'Datos no válidos o que no cuadran con el partido'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await anadirEventos(pid, c.req.valid('json').eventos)
        return c.json(await detallePartido(plantillaId, pid), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/partidos/{pid}/eventos/{evid}',
        tags: ['Estadísticas'],
        summary: 'Borrar un evento',
        description:
          'Delegado o superior. También los importados del acta. No se puede dejar el partido incoherente (por ejemplo, borrar la entrada de quien después sale).',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamEvento },
        responses: {
          200: json(EsquemaPartido, 'Evento borrado'),
          400: json(EsquemaError, 'El partido no cuadraría sin el evento'),
          ...errores,
        },
      }),
      async (c) => {
        const { pid, evid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarPartido(plantillaId, pid)
        await db.transaction(async (tx) => {
          await bloquearPartido(tx, pid)
          const borrados = await tx
            .delete(eventosPartido)
            .where(and(eq(eventosPartido.id, evid), eq(eventosPartido.partidoId, pid)))
            .returning({ id: eventosPartido.id })
          if (borrados.length === 0) {
            throw new ErrorApi(404, 'no_encontrado', 'No existe ese evento en el partido')
          }
          await recalcular(tx, pid)
        })
        return c.json(await detallePartido(plantillaId, pid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/estadisticas',
        tags: ['Estadísticas'],
        summary: 'Estadísticas de la temporada',
        description:
          'Resultados del equipo y, por jugador, partidos, titularidades, minutos, goles, asistencias y tarjetas en los partidos jugados de la plantilla, los entrenos a los que ha ido y los goles en contra con él en el campo. El rol jugador solo ve su fila.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamPartido.pick({ id: true }) },
        responses: { 200: json(EsquemaEstadisticasPlantilla, 'Estadísticas'), ...errores },
      }),
      async (c) => {
        const plantillaId = c.var.plantilla.id
        const soloSuyas = !rolAlcanza(c.var.rol, 'delegado')
        const [equipo] = await db
          .select({
            jugados: sql<number>`count(*)::int`,
            ganados: sql<number>`count(*) filter (where ${partidos.golesFavor} > ${partidos.golesContra})::int`,
            empatados: sql<number>`count(*) filter (where ${partidos.golesFavor} = ${partidos.golesContra})::int`,
            perdidos: sql<number>`count(*) filter (where ${partidos.golesFavor} < ${partidos.golesContra})::int`,
            golesFavor: sql<number>`coalesce(sum(${partidos.golesFavor}), 0)::int`,
            golesContra: sql<number>`coalesce(sum(${partidos.golesContra}), 0)::int`,
          })
          .from(partidos)
          .where(and(eq(partidos.plantillaId, plantillaId), eq(partidos.estado, 'jugado')))

        const a = acumulados({ plantillaId })
        // Entrenos a los que ha ido cada jugador en la plantilla (GH-155)
        const asistidos = db
          .select({
            jugadorId: sql<string>`${asistencias.jugadorId}`.as('as_jugador'),
            entrenos: sql<number>`count(*)`.as('entrenos'),
          })
          .from(asistencias)
          .where(and(eq(asistencias.plantillaId, plantillaId), eq(asistencias.estado, 'asiste')))
          .groupBy(asistencias.jugadorId)
          .as('asistidos')
        const filas = await db
          .select({
            jugadorId: jugadores.id,
            nombre: jugadores.nombre,
            apellidos: jugadores.apellidos,
            dorsal: fichas.dorsal,
            activo: fichas.activo,
            ...a.columnas,
            entrenos: sql<number>`coalesce(${asistidos.entrenos}, 0)::int`,
          })
          .from(fichas)
          .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
          .leftJoin(asistidos, eq(asistidos.jugadorId, fichas.jugadorId))
          .leftJoin(
            a.enCampo,
            and(
              eq(a.enCampo.plantillaId, fichas.plantillaId),
              eq(a.enCampo.jugadorId, fichas.jugadorId),
            ),
          )
          .leftJoin(
            a.eventos,
            and(
              eq(a.eventos.plantillaId, fichas.plantillaId),
              eq(a.eventos.jugadorId, fichas.jugadorId),
            ),
          )
          .where(
            and(
              eq(fichas.plantillaId, plantillaId),
              // Sin jugador vinculado, ninguna fila
              soloSuyas ? sql`${fichas.jugadorId} = ${c.var.jugadorId}` : undefined,
            ),
          )
          .orderBy(sql`${fichas.dorsal} asc nulls last`, ...porNombre, asc(jugadores.id))
        const encajados = await encajadosEnPlantilla(plantillaId)
        return c.json(
          {
            equipo: { ...(equipo ?? sinPartidos), sinMinutoEnContra: encajados.sinMinuto },
            jugadores: filas.map((f) => ({
              ...f,
              golesEncajados: encajados.porJugador.get(f.jugadorId)?.goles ?? 0,
              minutosConEncajados: encajados.porJugador.get(f.jugadorId)?.minutos ?? 0,
            })),
          },
          200,
        )
      },
    )

const sinPartidos = {
  jugados: 0,
  ganados: 0,
  empatados: 0,
  perdidos: 0,
  golesFavor: 0,
  golesContra: 0,
}

// Goles encajados en el campo y minutos de cada jugador en los partidos jugados de la plantilla
// que tienen todos sus goles en contra con minuto (GH-153). Se calcula con los mismos tramos que
// los minutos jugados; los partidos sin ese dato solo se cuentan.
async function encajadosEnPlantilla(plantillaId: string) {
  const jugados = await db
    .select({ id: partidos.id, golesContra: partidos.golesContra })
    .from(partidos)
    .where(and(eq(partidos.plantillaId, plantillaId), eq(partidos.estado, 'jugado')))
  const ids = jugados.map((p) => p.id)
  const porJugador = new Map<string, { goles: number; minutos: number }>()
  if (ids.length === 0) return { porJugador, sinMinuto: 0 }
  const lista = await db
    .select({
      partidoId: participaciones.partidoId,
      jugadorId: participaciones.jugadorId,
      titular: participaciones.titular,
    })
    .from(participaciones)
    .where(inArray(participaciones.partidoId, ids))
  const eventos = await db
    .select({
      partidoId: eventosPartido.partidoId,
      jugadorId: eventosPartido.jugadorId,
      tipo: eventosPartido.tipo,
      minuto: eventosPartido.minuto,
    })
    .from(eventosPartido)
    .where(inArray(eventosPartido.partidoId, ids))

  let sinMinuto = 0
  for (const p of jugados) {
    const delPartido = lista.filter((l) => l.partidoId === p.id)
    const susEventos = eventos.filter((e) => e.partidoId === p.id)
    const goles = calcularEncajados(delPartido, susEventos, p.golesContra ?? 0)
    if (!goles) {
      sinMinuto++
      continue
    }
    for (const [jugadorId, minutos] of calcularMinutos(delPartido, susEventos)) {
      const total = porJugador.get(jugadorId) ?? { goles: 0, minutos: 0 }
      total.goles += goles.get(jugadorId) ?? 0
      total.minutos += minutos
      porJugador.set(jugadorId, total)
    }
  }
  return { porJugador, sinMinuto }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Titulares, suplentes y eventos solo de convocados: un error claro antes de que lo pare la base
async function comprobarConvocados(tx: Tx, partidoId: string, lista: string[]) {
  if (lista.length === 0) return
  const filas = await tx
    .select({ jugadorId: convocados.jugadorId })
    .from(convocados)
    .where(and(eq(convocados.partidoId, partidoId), inArray(convocados.jugadorId, lista)))
  if (filas.length !== new Set(lista).size) {
    throw new ErrorApi(
      400,
      'no_convocado',
      'Las estadísticas son de jugadores convocados al partido',
    )
  }
}

export const rutasEstadisticasClub = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida }).openapi(
    createRoute({
      method: 'get',
      path: '/clubes/{cid}/jugadores/{jid}/estadisticas',
      tags: ['Estadísticas'],
      summary: 'Trayectoria de un jugador',
      description:
        'Sus estadísticas en cada temporada (plantilla con ficha) y los totales en el club, en los partidos jugados. El rol jugador solo ve la suya.',
      middleware: [requireRolEnClub('jugador')] as const,
      request: {
        params: z.object({
          cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }),
          jid: EsquemaUuid.openapi({ param: { name: 'jid', in: 'path' } }),
        }),
      },
      responses: { 200: json(EsquemaTrayectoria, 'Trayectoria'), ...errores },
    }),
    async (c) => {
      const { jid } = c.req.valid('param')
      if (!rolAlcanza(c.var.rol, 'delegado') && c.var.jugadorId !== jid) {
        throw new ErrorApi(403, 'sin_permiso', 'Solo puedes ver tus estadísticas')
      }
      const [jugador] = await db
        .select({
          jugadorId: jugadores.id,
          nombre: jugadores.nombre,
          apellidos: jugadores.apellidos,
        })
        .from(jugadores)
        .where(and(eq(jugadores.id, jid), eq(jugadores.clubId, c.var.club.id)))
      if (!jugador) throw new ErrorApi(404, 'no_encontrado', 'No existe ese jugador en el club')

      const a = acumulados({ jugadorId: jid })
      const temporadas = await db
        .select({
          plantillaId: plantillas.id,
          plantilla: plantillas.nombre,
          temporada: plantillas.temporada,
          dorsal: fichas.dorsal,
          ...a.columnas,
        })
        .from(fichas)
        .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
        .leftJoin(
          a.enCampo,
          and(
            eq(a.enCampo.plantillaId, fichas.plantillaId),
            eq(a.enCampo.jugadorId, fichas.jugadorId),
          ),
        )
        .leftJoin(
          a.eventos,
          and(
            eq(a.eventos.plantillaId, fichas.plantillaId),
            eq(a.eventos.jugadorId, fichas.jugadorId),
          ),
        )
        .where(eq(fichas.jugadorId, jid))
        .orderBy(sql`${plantillas.temporada} desc`, asc(plantillas.nombre))
      return c.json({ ...jugador, temporadas, totales: sumar(temporadas) }, 200)
    },
  )
