import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm'
import { bodyLimit } from 'hono/body-limit'
import { emparejar } from '../acta/emparejar.js'
import { db } from '../db/cliente.js'
import { fichas, jugadores, plantillas } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { FichaNoLegible, leerFichaEquipo } from '../ficha-equipo/leer.js'
import { type EnvClub, type EnvPlantilla, requireRol, requireRolEnClub } from '../permisos.js'
import { EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'
import {
  columnasJugadorPlantilla,
  EsquemaJugadorPlantilla,
  EsquemaTipoFicha,
  nombreCompleto,
  porNombre,
} from './jugadores.js'
import { errores, json, ParamPlantilla } from './partidos.js'

// Plantilla desde la ficha del equipo de la federación (GH-197): se lee el PDF sin guardar nada y se
// devuelven los jugadores emparejados con los del club; la pantalla muestra la vista previa y, al
// confirmar, se crean la plantilla con sus jugadores (POST /plantillas) o se añaden a una que ya
// existe (lote). El PDF no se guarda.

const MAXIMO = 2 * 1024 * 1024

const limite = bodyLimit({
  maxSize: MAXIMO + 64 * 1024,
  onError: () => {
    throw new ErrorApi(413, 'ficha_demasiado_grande', 'La ficha no puede pasar de 2 MB')
  },
})

const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })

const EsquemaPersonaFicha = z.object({
  ficha: z.string().openapi({
    description: 'Como sale en la ficha, con las tildes arregladas',
    example: 'FERNÁNDEZ CASTRO, IVÁN',
  }),
  nombre: z.string().openapi({ example: 'Iván' }),
  apellidos: z.string().nullable().openapi({ example: 'Fernández Castro' }),
  funcion: z.string().nullable().openapi({
    description: 'Tipo de licencia del jugador o función en el cuerpo técnico',
    example: 'Aficionado',
  }),
})

const EsquemaFichaEquipo = z
  .object({
    equipo: z.string().nullable().openapi({ example: 'Sofan S.D. "B"' }),
    categoria: z.string().nullable().openapi({ example: '2ª Futgal' }),
    jugadores: z.array(
      EsquemaPersonaFicha.extend({
        jugadorId: z.uuid().nullable().openapi({
          description: 'El jugador del club que parece ser; null si no hay uno claro',
        }),
      }),
    ),
    cuerpoTecnico: z
      .array(EsquemaPersonaFicha)
      .openapi({ description: 'Técnicos, delegados y auxiliares; solo informativo' }),
    club: z
      .array(
        z.object({
          id: z.uuid(),
          nombre: z.string(),
          apellidos: z.string().nullable(),
          fichas: z.array(
            z.object({
              plantillaId: z.uuid(),
              plantilla: z.string(),
              temporada: z.string(),
              tipo: EsquemaTipoFicha,
            }),
          ),
        }),
      )
      .openapi({
        description:
          'Los jugadores del club con sus fichas, para saber en la vista previa si ya están en la plantilla o tienen ficha propia en otra la temporada elegida, y para emparejar a mano',
      }),
  })
  .openapi('FichaEquipoLeida')

// Los jugadores a dar de alta con ficha propia: del club o nuevos. Sin dorsal ni posición.
export const EsquemaJugadoresLote = z
  .array(
    z.union([
      z.object({ jugadorId: EsquemaUuid }).strict().openapi({ title: 'Jugador del club' }),
      z
        .object({
          nombre: EsquemaTexto('El nombre'),
          apellidos: EsquemaTexto('Los apellidos').nullish(),
        })
        .strict()
        .openapi({ title: 'Jugador nuevo en el club' }),
    ]),
  )
  .max(80, 'Como mucho 80 jugadores a la vez')
  .refine(
    (lista) => {
      const ids = lista.flatMap((j) => ('jugadorId' in j ? [j.jugadorId] : []))
      return new Set(ids).size === ids.length
    },
    { message: 'Hay un jugador repetido' },
  )

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type PlantillaLote = { id: string; clubId: string; temporada: string }

const fichaOcupada = () =>
  new ErrorApi(
    409,
    'ficha_en_temporada',
    'Alguno de los jugadores ya tiene ficha esta temporada: vuelve a leer la ficha',
  )

// Fichas propias en la plantilla para cada jugador, en la transacción en la que se crea la
// plantilla o en una aparte. Si alguno ya está en la plantilla o tiene ficha propia en otra esa
// temporada, no se guarda nada. Devuelve los ids de los jugadores.
export async function altaEnLote(
  tx: Tx,
  plantilla: PlantillaLote,
  lista: z.infer<typeof EsquemaJugadoresLote>,
) {
  const ids = lista.flatMap((j) => ('jugadorId' in j ? [j.jugadorId] : []))
  if (ids.length > 0) {
    const delClub = await tx
      .select({ id: jugadores.id })
      .from(jugadores)
      .where(and(inArray(jugadores.id, ids), eq(jugadores.clubId, plantilla.clubId)))
    if (delClub.length !== ids.length) {
      throw new ErrorApi(404, 'no_encontrado', 'Alguno de los jugadores no es del club')
    }
    const ocupadas = await tx
      .select({
        nombre: nombreCompleto,
        plantillaId: fichas.plantillaId,
        plantilla: plantillas.nombre,
      })
      .from(fichas)
      .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
      .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
      .where(
        and(
          inArray(fichas.jugadorId, ids),
          eq(fichas.temporada, plantilla.temporada),
          or(eq(fichas.plantillaId, plantilla.id), eq(fichas.tipo, 'propia')),
        ),
      )
      .orderBy(...porNombre)
    if (ocupadas.length > 0) {
      const quienes = ocupadas
        .map((o) =>
          o.plantillaId === plantilla.id ? `${o.nombre} (ya está)` : `${o.nombre} (${o.plantilla})`,
        )
        .join(', ')
      throw new ErrorApi(
        409,
        'ficha_en_temporada',
        `Ya tienen ficha en la temporada ${plantilla.temporada}: ${quienes}`,
      )
    }
  }

  const nuevos = lista.flatMap((j) => ('nombre' in j ? [j] : []))
  const creados =
    nuevos.length === 0
      ? []
      : await tx
          .insert(jugadores)
          .values(
            nuevos.map((j) => ({
              clubId: plantilla.clubId,
              nombre: j.nombre,
              apellidos: j.apellidos ?? null,
            })),
          )
          .returning({ id: jugadores.id })
  const todos = [...ids, ...creados.map((j) => j.id)]
  if (todos.length > 0) {
    await tx.insert(fichas).values(
      todos.map((jugadorId) => ({
        plantillaId: plantilla.id,
        jugadorId,
        clubId: plantilla.clubId,
        temporada: plantilla.temporada,
        tipo: 'propia' as const,
      })),
    )
  }
  return todos
}

// Otra petición ha creado alguna de las fichas entre la comprobación y la inserción
export function errorDeLote(error: unknown) {
  const restriccion = restriccionViolada(error)
  return restriccion === 'fichas_una_propia_por_temporada' || restriccion === 'fichas_pkey'
    ? fichaOcupada()
    : error
}

export const rutasFichaEquipoClub = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida }).openapi(
    createRoute({
      method: 'post',
      path: '/clubes/{cid}/ficha-federacion',
      tags: ['Plantillas'],
      summary: 'Leer la ficha del equipo de la federación',
      description:
        'Delegado o superior en alguna plantilla del club. La ficha del equipo en PDF de la Federación Gallega (como mucho 2 MB), en el campo `archivo`. Devuelve el equipo, la categoría, los jugadores emparejados con los del club y el cuerpo técnico, sin crear nada; el PDF no se guarda. Para crear la plantilla con sus jugadores, `POST /plantillas` con `jugadores`; para añadirlos a una que ya existe, `POST /plantillas/{id}/jugadores/lote`.',
      middleware: [requireRolEnClub('delegado'), limite] as const,
      request: {
        params: ParamClub,
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
        200: json(EsquemaFichaEquipo, 'Ficha leída'),
        400: json(EsquemaError, 'No es un PDF o no es la ficha de un equipo'),
        413: json(EsquemaError, 'Pasa de 2 MB'),
        ...errores,
      },
    }),
    async (c) => {
      const { archivo } = c.req.valid('form')
      if (!(archivo instanceof File)) {
        throw new ErrorApi(400, 'validacion', 'Adjunta la ficha en PDF en el campo «archivo»')
      }
      if (archivo.size > MAXIMO) {
        throw new ErrorApi(413, 'ficha_demasiado_grande', 'La ficha no puede pasar de 2 MB')
      }
      let ficha: Awaited<ReturnType<typeof leerFichaEquipo>>
      try {
        ficha = await leerFichaEquipo(new Uint8Array(await archivo.arrayBuffer()))
      } catch (error) {
        if (error instanceof FichaNoLegible) {
          throw new ErrorApi(400, 'ficha_no_legible', error.message)
        }
        throw error
      }

      const clubId = c.var.club.id
      const delClub = await db
        .select({ id: jugadores.id, nombre: jugadores.nombre, apellidos: jugadores.apellidos })
        .from(jugadores)
        .where(eq(jugadores.clubId, clubId))
        .orderBy(...porNombre, asc(jugadores.id))
      const fichasClub = await db
        .select({
          jugadorId: fichas.jugadorId,
          plantillaId: fichas.plantillaId,
          plantilla: plantillas.nombre,
          temporada: fichas.temporada,
          tipo: fichas.tipo,
        })
        .from(fichas)
        .innerJoin(plantillas, eq(plantillas.id, fichas.plantillaId))
        .where(eq(fichas.clubId, clubId))
        .orderBy(desc(fichas.temporada), asc(fichas.tipo), asc(plantillas.nombre))

      const emparejados = emparejar(
        ficha.jugadores.map((j) => ({ nombre: j.ficha, dorsal: null })),
        delClub.map((j) => ({ jugadorId: j.id, ...j, dorsal: null })),
      )
      return c.json(
        {
          ...ficha,
          jugadores: ficha.jugadores.map((j) => ({
            ...j,
            jugadorId: emparejados.get(j.ficha) ?? null,
          })),
          club: delClub.map((j) => ({
            ...j,
            fichas: fichasClub
              .filter((f) => f.jugadorId === j.id)
              .map(({ jugadorId: _, ...f }) => f),
          })),
        },
        200,
      )
    },
  )

export const rutasFichaEquipoPlantilla = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida }).openapi(
    createRoute({
      method: 'post',
      path: '/plantillas/{id}/jugadores/lote',
      tags: ['Jugadores'],
      summary: 'Añadir varios jugadores a la plantilla',
      description:
        'Delegado o superior. Con ficha propia y sin dorsal ni posición, como al importar la ficha de la federación (GH-197): jugadores del club (`jugadorId`) o nuevos (`nombre` y `apellidos`). Todos o ninguno: si alguno ya está en la plantilla o tiene ficha propia en otra esa temporada, no se añade nadie.',
      middleware: [requireRol('delegado')] as const,
      request: {
        params: ParamPlantilla,
        body: {
          content: {
            'application/json': {
              schema: z
                .object({
                  jugadores: EsquemaJugadoresLote.refine((l) => l.length > 0, {
                    message: 'Elige al menos un jugador',
                  }),
                })
                .strict(),
            },
          },
        },
      },
      responses: {
        201: json(z.array(EsquemaJugadorPlantilla), 'Los jugadores añadidos'),
        400: json(EsquemaError, 'Datos no válidos'),
        409: json(EsquemaError, 'Alguno ya tiene ficha en la temporada'),
        ...errores,
      },
    }),
    async (c) => {
      const { jugadores: lista } = c.req.valid('json')
      const plantilla = c.var.plantilla
      let ids: string[]
      try {
        ids = await db.transaction((tx) => altaEnLote(tx, plantilla, lista))
      } catch (error) {
        throw errorDeLote(error)
      }
      const resultado = await db
        .select(columnasJugadorPlantilla)
        .from(fichas)
        .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
        .where(and(eq(fichas.plantillaId, plantilla.id), inArray(fichas.jugadorId, ids)))
        .orderBy(...porNombre)
      return c.json(resultado, 201)
    },
  )
