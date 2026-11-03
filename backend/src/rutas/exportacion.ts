import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import writeXlsxFile, { type Cell, type Sheet } from 'write-excel-file/node'
import { db } from '../db/cliente.js'
import {
  asistencias,
  entrenos,
  eventosPartido,
  fichas,
  jugadores,
  participaciones,
  partidos,
} from '../db/schema/index.js'
import { validacionFallida } from '../errores.js'
import type { TipoEvento } from '../estadisticas.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { estadisticasDePlantilla } from './estadisticas.js'
import { porNombre } from './jugadores.js'
import { errores, ParamPlantilla } from './partidos.js'

// Exportación de los datos de la temporada en Excel (GH-170): un .xlsx con una hoja por tabla
// (partidos, eventos, participaciones, jugadores y asistencia), en filas planas para analizarlas
// fuera de la app. Solo el cuerpo técnico. El motivo de las ausencias no sale.

type Fila = Cell[]

const TIPOS: Record<TipoEvento, string> = {
  gol: 'Gol',
  asistencia: 'Asistencia',
  amarilla: 'Amarilla',
  roja: 'Roja',
  entra: 'Entra',
  sale: 'Sale',
  gol_propia: 'Gol en propia',
  gol_rival: 'Gol del rival',
}

const ESTADOS_PARTIDO = { programado: 'Programado', jugado: 'Jugado', aplazado: 'Aplazado' }
const ESTADOS_ASISTENCIA = { asiste: 'Asiste', falta: 'Falta', justificada: 'Justificada' }

// Las fechas de la base son 'AAAA-MM-DD': como fecha de Excel, sin zona horaria
const fecha = (texto: string) => new Date(`${texto}T00:00:00Z`)
const hora = (texto: string | null) => texto?.slice(0, 5) ?? null
const nombre = (j: { nombre: string | null; apellidos: string | null }) =>
  j.nombre === null ? null : j.apellidos ? `${j.nombre} ${j.apellidos}` : j.nombre

const cabecera = (textos: string[]): Fila =>
  textos.map((value) => ({ value, fontWeight: 'bold' as const }))

const hoja = (nombreHoja: string, columnas: [string, number][], filas: Fila[]): Sheet<never> => ({
  sheet: nombreHoja,
  data: [cabecera(columnas.map(([texto]) => texto)), ...filas],
  columns: columnas.map(([, width]) => ({ width })),
  stickyRowsCount: 1,
  dateFormat: 'dd/mm/yyyy',
})

// Nombre del archivo: «senior-2026-27.xlsx», sin tildes ni espacios
export const nombreArchivo = (plantilla: { nombre: string; temporada: string }) =>
  `${`${plantilla.nombre}-${plantilla.temporada}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.xlsx`

export async function libroTemporada(plantillaId: string) {
  const delPartido = {
    fecha: partidos.fecha,
    rival: partidos.rival,
  }
  const jugado = and(eq(partidos.plantillaId, plantillaId), eq(partidos.estado, 'jugado'))
  const ordenPartido = [asc(partidos.fecha), sql`${partidos.hora} asc nulls last`, asc(partidos.id)]

  const listaPartidos = await db
    .select({
      ...delPartido,
      hora: partidos.hora,
      competicion: partidos.competicion,
      local: partidos.local,
      estado: partidos.estado,
      golesFavor: partidos.golesFavor,
      golesContra: partidos.golesContra,
    })
    .from(partidos)
    .where(eq(partidos.plantillaId, plantillaId))
    .orderBy(...ordenPartido)

  // Ficha del jugador en esta plantilla, para su dorsal
  const ficha = alias(fichas, 'ficha')
  const listaEventos = await db
    .select({
      ...delPartido,
      minuto: eventosPartido.minuto,
      tipo: eventosPartido.tipo,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
      dorsal: ficha.dorsal,
    })
    .from(eventosPartido)
    .innerJoin(partidos, eq(partidos.id, eventosPartido.partidoId))
    .leftJoin(jugadores, eq(jugadores.id, eventosPartido.jugadorId))
    .leftJoin(
      ficha,
      and(eq(ficha.plantillaId, plantillaId), eq(ficha.jugadorId, eventosPartido.jugadorId)),
    )
    .where(jugado)
    .orderBy(...ordenPartido, sql`${eventosPartido.minuto} asc nulls last`, asc(eventosPartido.id))

  const listaParticipaciones = await db
    .select({
      ...delPartido,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
      dorsal: fichas.dorsal,
      titular: participaciones.titular,
      minutos: participaciones.minutos,
    })
    .from(participaciones)
    .innerJoin(partidos, eq(partidos.id, participaciones.partidoId))
    .innerJoin(jugadores, eq(jugadores.id, participaciones.jugadorId))
    .leftJoin(
      fichas,
      and(eq(fichas.plantillaId, plantillaId), eq(fichas.jugadorId, participaciones.jugadorId)),
    )
    .where(jugado)
    .orderBy(
      ...ordenPartido,
      sql`${participaciones.titular} desc`,
      sql`${fichas.dorsal} asc nulls last`,
      ...porNombre,
    )

  const listaAsistencia = await db
    .select({
      fecha: entrenos.fecha,
      hora: entrenos.hora,
      nombre: jugadores.nombre,
      apellidos: jugadores.apellidos,
      dorsal: fichas.dorsal,
      estado: asistencias.estado,
    })
    .from(asistencias)
    .innerJoin(entrenos, eq(entrenos.id, asistencias.entrenoId))
    .innerJoin(jugadores, eq(jugadores.id, asistencias.jugadorId))
    .innerJoin(
      fichas,
      and(
        eq(fichas.plantillaId, asistencias.plantillaId),
        eq(fichas.jugadorId, asistencias.jugadorId),
      ),
    )
    .where(eq(asistencias.plantillaId, plantillaId))
    .orderBy(
      asc(entrenos.fecha),
      sql`${entrenos.hora} asc nulls last`,
      asc(entrenos.id),
      sql`${fichas.dorsal} asc nulls last`,
      ...porNombre,
    )

  const { jugadores: estadisticas } = await estadisticasDePlantilla(plantillaId)

  const hojas: Sheet<never>[] = [
    hoja(
      'Partidos',
      [
        ['Fecha', 12],
        ['Hora', 7],
        ['Rival', 30],
        ['Competición', 24],
        ['Campo', 10],
        ['Estado', 12],
        ['Goles a favor', 13],
        ['Goles en contra', 15],
      ],
      listaPartidos.map((p) => [
        fecha(p.fecha),
        hora(p.hora),
        p.rival,
        p.competicion,
        p.local ? 'Local' : 'Visitante',
        ESTADOS_PARTIDO[p.estado],
        p.golesFavor,
        p.golesContra,
      ]),
    ),
    hoja(
      'Eventos',
      [
        ['Fecha', 12],
        ['Rival', 30],
        ['Minuto', 8],
        ['Tipo', 14],
        ['Jugador', 28],
        ['Dorsal', 8],
      ],
      listaEventos.map((e) => [
        fecha(e.fecha),
        e.rival,
        e.minuto,
        TIPOS[e.tipo],
        nombre(e),
        e.dorsal,
      ]),
    ),
    hoja(
      'Participaciones',
      [
        ['Fecha', 12],
        ['Rival', 30],
        ['Jugador', 28],
        ['Dorsal', 8],
        ['Titular', 10],
        ['Minutos', 9],
      ],
      listaParticipaciones.map((p) => [
        fecha(p.fecha),
        p.rival,
        nombre(p),
        p.dorsal,
        p.titular ? 'Titular' : 'Suplente',
        p.minutos,
      ]),
    ),
    hoja(
      'Jugadores',
      [
        ['Dorsal', 8],
        ['Jugador', 28],
        ['Baja', 6],
        ['Partidos', 9],
        ['Titularidades', 13],
        ['Minutos', 9],
        ['Goles', 7],
        ['Asistencias', 11],
        ['Amarillas', 10],
        ['Rojas', 7],
        ['Goles en propia', 15],
        ['Entrenos', 9],
        ['Goles a favor en el campo', 24],
        ['Minutos con goles a favor', 24],
        ['Goles en contra en el campo', 26],
        ['Minutos con goles en contra', 26],
      ],
      estadisticas.map((j) => [
        j.dorsal,
        nombre(j),
        j.activo ? null : 'Sí',
        j.partidos,
        j.titularidades,
        j.minutos,
        j.goles,
        j.asistencias,
        j.amarillas,
        j.rojas,
        j.golesPropia,
        j.entrenos,
        j.golesFavorEnCampo,
        j.minutosConFavor,
        j.golesEncajados,
        j.minutosConEncajados,
      ]),
    ),
    hoja(
      'Asistencia',
      [
        ['Fecha', 12],
        ['Hora', 7],
        ['Jugador', 28],
        ['Dorsal', 8],
        ['Estado', 12],
      ],
      listaAsistencia.map((a) => [
        fecha(a.fecha),
        hora(a.hora),
        nombre(a),
        a.dorsal,
        ESTADOS_ASISTENCIA[a.estado],
      ]),
    ),
  ]
  return writeXlsxFile(hojas).toBuffer()
}

export const rutasExportacion = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida }).openapi(
    createRoute({
      method: 'get',
      path: '/plantillas/{id}/exportacion.xlsx',
      tags: ['Estadísticas'],
      summary: 'Exportar la temporada a Excel',
      description:
        'Delegado o superior. Un .xlsx con una hoja por tabla: partidos, eventos, participaciones, jugadores (las cifras de las estadísticas) y asistencia a los entrenos, sin el motivo de las ausencias. Los partidos sin jugar solo salen en Partidos.',
      middleware: [requireRol('delegado')] as const,
      request: { params: ParamPlantilla },
      responses: {
        200: {
          description: 'El archivo de Excel',
          content: {
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
              schema: z.string().openapi({ format: 'binary' }),
            },
          },
        },
        ...errores,
      },
    }),
    async (c) => {
      const plantilla = c.var.plantilla
      const libro = await libroTemporada(plantilla.id)
      return c.body(new Uint8Array(libro), 200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${nombreArchivo(plantilla)}"`,
        'cache-control': 'private, no-store',
      }) as never
    },
  )
