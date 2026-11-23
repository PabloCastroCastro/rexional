import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/cliente.js'
import { clubes, entrenos, fichas, respuestasEntreno } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvPlantilla, requireRol } from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'
import { buscarEntreno, cierre, EsquemaRespuesta, horasLimite } from './entrenos.js'

// Respuestas de los jugadores a si van a un entreno (GH-204). Es la intención de ir, no la asistencia:
// se guarda aparte y pasar lista no la toca. Cada jugador responde por sí mismo hasta la hora límite
// de la plantilla; el cuerpo técnico puede apuntar o corregir la de cualquiera, también después.

type Respuesta = z.infer<typeof EsquemaRespuesta>

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
const ParamJugador = ParamEntreno.extend({
  jid: EsquemaUuid.openapi({ param: { name: 'jid', in: 'path' } }),
})

const CuerpoRespuesta = z
  .object({
    respuesta: EsquemaRespuesta,
    motivo: z
      .string()
      .trim()
      .max(200, 'El motivo no puede tener más de 200 caracteres')
      .nullish()
      .transform((m) => m || null),
  })
  .strict()
  .refine((r) => r.respuesta !== 'voy' || r.motivo === null, {
    path: ['motivo'],
    message: 'El motivo solo acompaña a «Duda» o «No voy»',
  })

const EsquemaRespuestaJugador = z
  .object({
    jugadorId: z.uuid(),
    respuesta: EsquemaRespuesta,
    motivo: z.string().nullable(),
  })
  .openapi('RespuestaEntreno')

const cuerpo = { content: { 'application/json': { schema: CuerpoRespuesta } } }

// Ficha que puede responder: activa y en la dinámica del equipo
async function puedeResponder(plantillaId: string, jugadorId: string) {
  const [ficha] = await db
    .select({ jugadorId: fichas.jugadorId })
    .from(fichas)
    .where(
      and(
        eq(fichas.plantillaId, plantillaId),
        eq(fichas.jugadorId, jugadorId),
        eq(fichas.activo, true),
        eq(fichas.enDinamica, true),
      ),
    )
  return Boolean(ficha)
}

// El jugador solo cambia su respuesta antes del cierre: 409 si ya pasó
async function comprobarAbierto(plantillaId: string, entrenoId: string) {
  const horas = await horasLimite(plantillaId)
  const [fila] = await db
    .select({ abierto: sql<boolean>`now() < ${cierre(horas)}` })
    .from(entrenos)
    .where(eq(entrenos.id, entrenoId))
  if (!fila?.abierto) {
    throw new ErrorApi(
      409,
      'respuestas_cerradas',
      'Ya no se puede cambiar la respuesta de este entreno: pídeselo al cuerpo técnico',
    )
  }
}

async function guardar(
  plantillaId: string,
  entrenoId: string,
  jugadorId: string,
  datos: { respuesta: Respuesta; motivo: string | null },
  usuarioId: string,
) {
  const valores = { ...datos, respondidoPor: usuarioId, respondidoEn: new Date() }
  await db
    .insert(respuestasEntreno)
    .values({ entrenoId, plantillaId, jugadorId, ...valores })
    .onConflictDoUpdate({
      target: [respuestasEntreno.entrenoId, respuestasEntreno.jugadorId],
      set: valores,
    })
  return { jugadorId, ...datos }
}

const borrar = (entrenoId: string, jugadorId: string) =>
  db
    .delete(respuestasEntreno)
    .where(
      and(eq(respuestasEntreno.entrenoId, entrenoId), eq(respuestasEntreno.jugadorId, jugadorId)),
    )

const sinFicha = () =>
  new ErrorApi(
    403,
    'sin_ficha',
    'Tu cuenta no está vinculada a una ficha activa de esta plantilla: pídeselo al admin',
  )

const noResponde = () =>
  new ErrorApi(
    400,
    'jugador_no_responde',
    'Ese jugador no tiene ficha activa en la dinámica de esta plantilla',
  )

const diaSemana = new Intl.DateTimeFormat('es-ES', { weekday: 'long', timeZone: 'UTC' })
const diaCompleto = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const enUtc = (fecha: string) => new Date(`${fecha}T12:00:00Z`)

// «hasta el jueves» si el plazo acaba a medianoche (el entreno no tiene hora); si no, «antes del
// jueves a las 18:00». cierre: fecha y hora del cierre en la zona de la aplicación
function textoCierre(cierre: { fecha: string; hora: string }) {
  if (cierre.hora === '00:00') {
    const anterior = new Date(enUtc(cierre.fecha).getTime() - 86_400_000)
    return `hasta el ${diaSemana.format(anterior)}`
  }
  return `antes del ${diaSemana.format(enUtc(cierre.fecha))} a las ${cierre.hora}`
}

// Para pedir en el grupo que confirmen (GH-213): el entreno, el plazo para responder y el enlace a
// la app, donde se confirma. Sin quién va ni motivos: WhatsApp no deja crear encuestas y las
// respuestas solo cuentan en la app
export function mensajeRespuestas(
  club: string,
  plantilla: { id: string; nombre: string },
  entreno: { fecha: string; hora: string | null; horaFin: string | null },
  cierre: { fecha: string; hora: string },
) {
  const dia = diaCompleto.format(enUtc(entreno.fecha)).replace(',', '')
  const horas = entreno.hora
    ? entreno.horaFin
      ? ` de ${entreno.hora} a ${entreno.horaFin}`
      : ` a las ${entreno.hora}`
    : ''
  return [
    `🏃 *${club} · ${plantilla.nombre}*`,
    `Entreno el ${dia}${horas}`,
    '',
    `¿Vienes? Confirma en la app ${textoCierre(cierre)}:`,
    `${config.urlPublica}/plantillas/${plantilla.id}/entrenos`,
  ].join('\n')
}

export const rutasRespuestas = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/entrenos/{eid}/respuesta',
        tags: ['Entrenos'],
        summary: 'Responder si voy a un entreno',
        description:
          'El jugador vinculado al usuario, con ficha activa en la dinámica de la plantilla, hasta la hora límite. Motivo opcional con «duda» o «no_voy».',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamEntreno, body: cuerpo },
        responses: {
          200: json(EsquemaRespuestaJugador, 'Respuesta guardada'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Respuestas cerradas'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarEntreno(plantillaId, eid)
        const jugadorId = c.var.jugadorId
        if (!jugadorId || !(await puedeResponder(plantillaId, jugadorId))) throw sinFicha()
        await comprobarAbierto(plantillaId, eid)
        const guardada = await guardar(
          plantillaId,
          eid,
          jugadorId,
          c.req.valid('json'),
          c.var.usuario.id,
        )
        return c.json(guardada, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/entrenos/{eid}/respuesta',
        tags: ['Entrenos'],
        summary: 'Quitar mi respuesta a un entreno',
        description: 'Como responder: el propio jugador, hasta la hora límite.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamEntreno },
        responses: {
          204: { description: 'Respuesta quitada' },
          409: json(EsquemaError, 'Respuestas cerradas'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarEntreno(plantillaId, eid)
        const jugadorId = c.var.jugadorId
        if (!jugadorId || !(await puedeResponder(plantillaId, jugadorId))) throw sinFicha()
        await comprobarAbierto(plantillaId, eid)
        await borrar(eid, jugadorId)
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/plantillas/{id}/entrenos/{eid}/respuestas/{jid}',
        tags: ['Entrenos'],
        summary: 'Apuntar la respuesta de un jugador',
        description:
          'Delegado o superior, para cualquier jugador con ficha activa en la dinámica y también pasada la hora límite (por ejemplo, si avisa por teléfono).',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamJugador, body: cuerpo },
        responses: {
          200: json(EsquemaRespuestaJugador, 'Respuesta guardada'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid, jid } = c.req.valid('param')
        const plantillaId = c.var.plantilla.id
        await buscarEntreno(plantillaId, eid)
        if (!(await puedeResponder(plantillaId, jid))) throw noResponde()
        const guardada = await guardar(plantillaId, eid, jid, c.req.valid('json'), c.var.usuario.id)
        return c.json(guardada, 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/entrenos/{eid}/respuestas/{jid}',
        tags: ['Entrenos'],
        summary: 'Quitar la respuesta de un jugador',
        description: 'Delegado o superior, también pasada la hora límite.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamJugador },
        responses: { 204: { description: 'Respuesta quitada' }, ...errores },
      }),
      async (c) => {
        const { eid, jid } = c.req.valid('param')
        await buscarEntreno(c.var.plantilla.id, eid)
        await borrar(eid, jid)
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/entrenos/{eid}/respuestas/mensaje',
        tags: ['Entrenos'],
        summary: 'Mensaje para pedir que confirmen la asistencia',
        description:
          'Delegado o superior. Para el grupo del equipo: el entreno, el plazo para responder y el enlace para hacerlo en la app, y el enlace wa.me para compartirlo. 409 si el plazo ya se ha cerrado.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamEntreno },
        responses: {
          200: json(
            z
              .object({
                texto: z.string(),
                whatsapp: z.string().openapi({ example: 'https://wa.me/?text=…' }),
              })
              .openapi('MensajeRespuestas'),
            'Mensaje',
          ),
          409: json(EsquemaError, 'Respuestas cerradas'),
          ...errores,
        },
      }),
      async (c) => {
        const { eid } = c.req.valid('param')
        const plantilla = c.var.plantilla
        const entreno = await buscarEntreno(plantilla.id, eid)
        // El plazo, en la zona de la aplicación; cerrado, ya no se pide confirmación
        const horas = await horasLimite(plantilla.id)
        const [plazo] = await db
          .select({
            abierto: sql<boolean>`now() < ${cierre(horas)}`,
            fecha: sql<string>`to_char((${cierre(horas)}) at time zone 'Europe/Madrid', 'YYYY-MM-DD')`,
            hora: sql<string>`to_char((${cierre(horas)}) at time zone 'Europe/Madrid', 'HH24:MI')`,
          })
          .from(entrenos)
          .where(eq(entrenos.id, eid))
        if (!plazo?.abierto) {
          throw new ErrorApi(
            409,
            'respuestas_cerradas',
            'Ya no se puede responder a este entreno: no hace falta pedir que confirmen',
          )
        }
        const [club] = await db
          .select({ nombre: clubes.nombre })
          .from(clubes)
          .where(eq(clubes.id, plantilla.clubId))
        const texto = mensajeRespuestas(club?.nombre ?? '', plantilla, entreno, plazo)
        return c.json({ texto, whatsapp: `https://wa.me/?text=${encodeURIComponent(texto)}` }, 200)
      },
    )
