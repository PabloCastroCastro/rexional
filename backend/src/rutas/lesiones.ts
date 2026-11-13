import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { fichas, lesiones } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { hoy } from '../fechas.js'
import { type EnvPlantilla, requireRol, rolAlcanza } from '../permisos.js'
import { EsquemaFecha, EsquemaUuid, restriccionViolada } from '../validacion.js'

// Lesiones de un jugador (GH-230), desde su ficha en una plantilla. Son del jugador en el club: la
// misma lesión se ve en todas las plantillas en las que juega. Es un dato de salud: el cuerpo
// técnico (delegado o superior) las gestiona y ve la nota; el rol jugador solo ve si él está
// lesionado, sin la nota ni el historial.

const EsquemaNota = z
  .string()
  .trim()
  .min(1, 'Escribe la nota o déjala vacía')
  .max(140, 'La nota admite como máximo 140 caracteres')

const camposLesion = z.object({
  id: z.uuid(),
  desde: z.string().openapi({ example: '2026-11-03' }),
  vueltaPrevista: z.string().nullable().openapi({ example: '2026-11-17' }),
  alta: z.string().nullable().openapi({ description: 'null mientras dura' }),
  nota: z.string().nullable().openapi({ description: 'Solo para el cuerpo técnico' }),
})

const EsquemaLesion = camposLesion.openapi('Lesion')

const EsquemaLesiones = z
  .object({
    // La que dura, sin alta. Con el objeto sin registrar: el .nullable() de un componente lo vuelve
    // nullable en todas partes
    actual: camposLesion.nullable(),
    historial: z.array(EsquemaLesion).openapi({
      description: 'Las que ya tienen alta, la más reciente primero. Vacío para el rol jugador',
    }),
  })
  .openapi('LesionesJugador')

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamJugador = z.object({
  id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }),
  jid: EsquemaUuid.openapi({ param: { name: 'jid', in: 'path' } }),
})

const ParamLesion = ParamJugador.extend({
  lid: EsquemaUuid.openapi({ param: { name: 'lid', in: 'path' } }),
})

const errorCampo = (campo: string, mensaje: string, codigo = 'validacion') =>
  new ErrorApi(400, codigo, mensaje, [{ campo, mensaje }])

// No se registra el futuro: la lesión empieza y termina en días que ya han llegado
function comprobarFechas(d: { desde?: string; alta?: string | null }) {
  const actual = hoy()
  if (d.desde && d.desde > actual) {
    throw errorCampo('desde', 'La lesión no puede empezar después de hoy')
  }
  if (d.alta && d.alta > actual) throw errorCampo('alta', 'El alta no puede ser después de hoy')
}

// Las restricciones de la tabla, como errores que se entienden
function traducirError(error: unknown): never {
  const restriccion = restriccionViolada(error)
  if (restriccion === 'lesiones_una_abierta') {
    throw new ErrorApi(
      409,
      'lesion_abierta',
      'Ya tiene una lesión sin alta: dale el alta antes de registrar otra',
    )
  }
  if (restriccion === 'lesiones_vuelta_posterior') {
    throw errorCampo('vueltaPrevista', 'La vuelta prevista no puede ser antes del inicio')
  }
  if (restriccion === 'lesiones_alta_posterior') {
    throw errorCampo('alta', 'El alta no puede ser antes del inicio de la lesión')
  }
  throw error
}

// El jugador tiene ficha en la plantilla; el rol jugador, solo puede consultar la suya
async function comprobarJugador(
  c: { var: EnvPlantilla['Variables'] },
  jugadorId: string,
): Promise<void> {
  if (!rolAlcanza(c.var.rol, 'delegado') && c.var.jugadorId !== jugadorId) {
    throw new ErrorApi(403, 'sin_permiso', 'Solo puedes ver tus propias lesiones')
  }
  const [ficha] = await db
    .select({ jugadorId: fichas.jugadorId })
    .from(fichas)
    .where(and(eq(fichas.plantillaId, c.var.plantilla.id), eq(fichas.jugadorId, jugadorId)))
  if (!ficha) throw new ErrorApi(404, 'no_encontrado', 'Ese jugador no está en esta plantilla')
}

const columnas = {
  id: lesiones.id,
  desde: lesiones.desde,
  vueltaPrevista: lesiones.vueltaPrevista,
  alta: lesiones.alta,
  nota: lesiones.nota,
}

async function lesionesDe(clubId: string, jugadorId: string, conTodo: boolean) {
  const delJugador = and(eq(lesiones.clubId, clubId), eq(lesiones.jugadorId, jugadorId))
  const [actual] = await db
    .select(columnas)
    .from(lesiones)
    .where(and(delJugador, isNull(lesiones.alta)))
  if (!conTodo) return { actual: actual ? { ...actual, nota: null } : null, historial: [] }
  const historial = await db
    .select(columnas)
    .from(lesiones)
    .where(and(delJugador, isNotNull(lesiones.alta)))
    .orderBy(desc(lesiones.desde), desc(lesiones.createdAt))
  return { actual: actual ?? null, historial }
}

async function buscarLesion(clubId: string, jugadorId: string, lesionId: string) {
  const [lesion] = await db
    .select({ id: lesiones.id, desde: lesiones.desde, alta: lesiones.alta })
    .from(lesiones)
    .where(
      and(
        eq(lesiones.id, lesionId),
        eq(lesiones.clubId, clubId),
        eq(lesiones.jugadorId, jugadorId),
      ),
    )
  if (!lesion) throw new ErrorApi(404, 'no_encontrada', 'No existe esa lesión del jugador')
  return lesion
}

export const rutasLesiones = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/jugadores/{jid}/lesiones',
        tags: ['Jugadores'],
        summary: 'Lesiones del jugador',
        description:
          'La que dura y el historial. El cuerpo técnico (delegado o superior) ve las de cualquier jugador de la plantilla, con la nota; el rol jugador, solo la suya en curso, sin nota ni historial.',
        middleware: [requireRol('jugador')] as const,
        request: { params: ParamJugador },
        responses: { 200: json(EsquemaLesiones, 'Lesiones'), ...errores },
      }),
      async (c) => {
        const { jid } = c.req.valid('param')
        await comprobarJugador(c, jid)
        const conTodo = rolAlcanza(c.var.rol, 'delegado')
        return c.json(await lesionesDe(c.var.plantilla.clubId, jid, conTodo), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/jugadores/{jid}/lesiones',
        tags: ['Jugadores'],
        summary: 'Marcar una lesión',
        description:
          'Delegado o superior. Desde hoy si no se indica; ni el inicio ni el alta pueden ser después de hoy. Solo una lesión sin alta a la vez.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamJugador,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    desde: EsquemaFecha.optional(),
                    vueltaPrevista: EsquemaFecha.nullish(),
                    nota: EsquemaNota.nullish(),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaLesiones, 'Lesión registrada; devuelve todas las del jugador'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya tiene una lesión sin alta'),
          ...errores,
        },
      }),
      async (c) => {
        const { jid } = c.req.valid('param')
        const datos = c.req.valid('json')
        await comprobarJugador(c, jid)
        const desde = datos.desde ?? hoy()
        comprobarFechas({ desde })
        await db
          .insert(lesiones)
          .values({
            clubId: c.var.plantilla.clubId,
            jugadorId: jid,
            desde,
            vueltaPrevista: datos.vueltaPrevista ?? null,
            nota: datos.nota ?? null,
          })
          .catch(traducirError)
        return c.json(await lesionesDe(c.var.plantilla.clubId, jid, true), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/plantillas/{id}/jugadores/{jid}/lesiones/{lid}',
        tags: ['Jugadores'],
        summary: 'Corregir una lesión o darle el alta',
        description:
          'Delegado o superior. Con `alta` se da el alta (el jugador está recuperado ese día); `alta: null` la vuelve a abrir. `vueltaPrevista` y `nota` se quitan con null.',
        middleware: [requireRol('delegado')] as const,
        request: {
          params: ParamLesion,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    desde: EsquemaFecha.optional(),
                    vueltaPrevista: EsquemaFecha.nullish(),
                    alta: EsquemaFecha.nullish(),
                    nota: EsquemaNota.nullish(),
                  })
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica qué cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaLesiones, 'Lesión cambiada; devuelve todas las del jugador'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya tiene otra lesión sin alta'),
          ...errores,
        },
      }),
      async (c) => {
        const { jid, lid } = c.req.valid('param')
        const cambios = c.req.valid('json')
        await comprobarJugador(c, jid)
        await buscarLesion(c.var.plantilla.clubId, jid, lid)
        comprobarFechas(cambios)
        await db.update(lesiones).set(cambios).where(eq(lesiones.id, lid)).catch(traducirError)
        return c.json(await lesionesDe(c.var.plantilla.clubId, jid, true), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/jugadores/{jid}/lesiones/{lid}',
        tags: ['Jugadores'],
        summary: 'Borrar una lesión',
        description:
          'Delegado o superior. Para las registradas por error: las que terminan con un alta se quedan en el historial.',
        middleware: [requireRol('delegado')] as const,
        request: { params: ParamLesion },
        responses: {
          200: json(EsquemaLesiones, 'Lesión borrada; devuelve las que quedan'),
          ...errores,
        },
      }),
      async (c) => {
        const { jid, lid } = c.req.valid('param')
        await comprobarJugador(c, jid)
        await buscarLesion(c.var.plantilla.clubId, jid, lid)
        await db.delete(lesiones).where(eq(lesiones.id, lid))
        return c.json(await lesionesDe(c.var.plantilla.clubId, jid, true), 200)
      },
    )
