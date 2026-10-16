import { copyFile } from 'node:fs/promises'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, asc, eq, type SQL, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import {
  categoriaEjercicio,
  ejercicioMedios,
  ejercicios,
  entrenoEjercicios,
  modeloEjercicios,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { absoluta, borrar, carpetaDeClub, nueva } from '../medios/almacen.js'
import { type EnvClub, requireRolEnClub } from '../permisos.js'
import { EsquemaTexto, EsquemaUuid } from '../validacion.js'
import { aMedio, columnasMedio, EsquemaMedio } from './medios.js'

// Biblioteca de ejercicios del club (secciones 2.8 y 7, GH-40). La consulta cualquier miembro de
// una plantilla del club y la gestiona el delegado o superior. Un ejercicio usado en algún plan o
// modelo no se borra: se archiva. Las fotos y vídeos se suben con las rutas de medios (GH-39); aquí,
// los enlaces, el pie y el orden.

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })
const ParamEjercicio = ParamClub.extend({
  eid: EsquemaUuid.openapi({ param: { name: 'eid', in: 'path' } }),
})
const ParamMedio = ParamEjercicio.extend({
  mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
})

const EsquemaCategoria = z.enum(categoriaEjercicio.enumValues)

// Etiquetas: en minúsculas, sin espacios de sobra y sin repetir
const EsquemaEtiquetas = z
  .array(z.string().trim().toLowerCase().min(1).max(30))
  .max(10)
  .transform((l) => [...new Set(l)])

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((t) => (t ? t : t === undefined ? undefined : null))

const CuerpoEjercicio = z.object({
  nombre: EsquemaTexto('El nombre', 120),
  descripcion: textoOpcional(4000),
  categoria: EsquemaCategoria.nullish(),
  duracionMin: z.int().min(1).max(240).nullish(),
  jugadores: textoOpcional(60),
  material: textoOpcional(500),
  etiquetas: EsquemaEtiquetas.optional(),
})

const datosEjercicio = {
  id: z.uuid(),
  nombre: z.string().openapi({ example: 'Rondo 4 contra 1' }),
  categoria: EsquemaCategoria.nullable(),
  duracionMin: z.int().nullable(),
  etiquetas: z.array(z.string()),
  archivado: z.boolean(),
}

const EsquemaResumenEjercicio = z
  .object({
    ...datosEjercicio,
    medios: z.int().openapi({ description: 'Número de fotos, vídeos y enlaces' }),
    urlMiniatura: z.string().nullable().openapi({ description: 'La de su primera foto o vídeo' }),
  })
  .openapi('ResumenEjercicio')

const EsquemaEjercicio = z
  .object({
    ...datosEjercicio,
    descripcion: z.string().nullable(),
    jugadores: z.string().nullable(),
    material: z.string().nullable(),
    usos: z.int().openapi({ description: 'Planes de entreno y modelos que lo usan' }),
    medios: z.array(EsquemaMedio),
  })
  .openapi('Ejercicio')

// Sin tildes ni mayúsculas, para buscar
const plano = (expresion: SQL | typeof ejercicios.nombre) =>
  sql`translate(lower(${expresion}), 'áéíóúüñ', 'aeiouun')`
const planoTexto = (texto: string) => texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const usos = (ejercicioId: SQL | string) => sql<number>`(
  (select count(*) from ${entrenoEjercicios} where ${entrenoEjercicios.ejercicioId} = ${ejercicioId}) +
  (select count(*) from ${modeloEjercicios} where ${modeloEjercicios.ejercicioId} = ${ejercicioId})
)::int`

async function buscarEjercicio(clubId: string, ejercicioId: string) {
  const [ejercicio] = await db
    .select()
    .from(ejercicios)
    .where(and(eq(ejercicios.id, ejercicioId), eq(ejercicios.clubId, clubId)))
  if (!ejercicio) throw new ErrorApi(404, 'no_encontrado', 'No existe ese ejercicio en el club')
  return ejercicio
}

async function detalle(clubId: string, ejercicioId: string) {
  const e = await buscarEjercicio(clubId, ejercicioId)
  const medios = await db
    .select(columnasMedio)
    .from(ejercicioMedios)
    .where(eq(ejercicioMedios.ejercicioId, e.id))
    .orderBy(asc(ejercicioMedios.orden), asc(ejercicioMedios.createdAt))
  const [{ total } = { total: 0 }] = await db
    .select({ total: usos(e.id) })
    .from(ejercicios)
    .where(eq(ejercicios.id, e.id))
  return {
    id: e.id,
    nombre: e.nombre,
    categoria: e.categoria,
    duracionMin: e.duracionMin,
    etiquetas: e.etiquetas,
    archivado: e.archivado,
    descripcion: e.descripcion,
    jugadores: e.jugadores,
    material: e.material,
    usos: total,
    medios: medios.map(aMedio),
  }
}

async function siguienteOrden(ejercicioId: string) {
  const [ultimo] = await db
    .select({ orden: sql<number>`coalesce(max(${ejercicioMedios.orden}), -1)::int` })
    .from(ejercicioMedios)
    .where(eq(ejercicioMedios.ejercicioId, ejercicioId))
  return (ultimo?.orden ?? -1) + 1
}

export const rutasEjercicios = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/ejercicios',
        tags: ['Ejercicios'],
        summary: 'Biblioteca de ejercicios',
        description:
          'Cualquier miembro de una plantilla del club. Búsqueda por nombre, descripción o etiqueta (sin tildes ni mayúsculas); filtros por categoría y etiqueta. Por defecto, sin los archivados.',
        middleware: [requireRolEnClub('jugador')] as const,
        request: {
          params: ParamClub,
          query: z.object({
            q: z
              .string()
              .trim()
              .max(100)
              .optional()
              .openapi({ param: { name: 'q', in: 'query' } }),
            categoria: EsquemaCategoria.optional().openapi({
              param: { name: 'categoria', in: 'query' },
            }),
            etiqueta: z
              .string()
              .trim()
              .toLowerCase()
              .max(30)
              .optional()
              .openapi({ param: { name: 'etiqueta', in: 'query' } }),
            archivados: z
              .enum(['no', 'si', 'todos'])
              .default('no')
              .openapi({ param: { name: 'archivados', in: 'query' } }),
          }),
        },
        responses: { 200: json(z.array(EsquemaResumenEjercicio), 'Ejercicios'), ...errores },
      }),
      async (c) => {
        const { cid } = c.req.valid('param')
        const { q, categoria, etiqueta, archivados } = c.req.valid('query')
        const patron = q ? `%${planoTexto(q).replace(/[%_\\]/g, '\\$&')}%` : null
        const miniatura = db
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
        // Con el constructor de consultas: en un sql escrito a mano, «id» sería el del medio
        const numeroMedios = db
          .select({ n: sql`count(*)::int` })
          .from(ejercicioMedios)
          .where(eq(ejercicioMedios.ejercicioId, ejercicios.id))
        const filas = await db
          .select({
            id: ejercicios.id,
            nombre: ejercicios.nombre,
            categoria: ejercicios.categoria,
            duracionMin: ejercicios.duracionMin,
            etiquetas: ejercicios.etiquetas,
            archivado: ejercicios.archivado,
            medios: sql<number>`(${numeroMedios})`,
            miniatura: sql<string | null>`(${miniatura})`,
          })
          .from(ejercicios)
          .where(
            and(
              eq(ejercicios.clubId, cid),
              archivados === 'todos' ? undefined : eq(ejercicios.archivado, archivados === 'si'),
              categoria ? eq(ejercicios.categoria, categoria) : undefined,
              etiqueta ? sql`${etiqueta} = any(${ejercicios.etiquetas})` : undefined,
              patron
                ? sql`(${plano(ejercicios.nombre)} like ${patron}
                    or ${plano(sql`coalesce(${ejercicios.descripcion}, '')`)} like ${patron}
                    or ${plano(sql`array_to_string(${ejercicios.etiquetas}, ' ')`)} like ${patron})`
                : undefined,
            ),
          )
          .orderBy(sql`lower(${ejercicios.nombre})`, asc(ejercicios.id))
        return c.json(
          filas.map(({ miniatura: m, ...f }) => ({
            ...f,
            urlMiniatura: m ? `/api/medios/${m}/miniatura` : null,
          })),
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/ejercicios/etiquetas',
        tags: ['Ejercicios'],
        summary: 'Etiquetas usadas en la biblioteca',
        description: 'Para los filtros. Cualquier miembro de una plantilla del club.',
        middleware: [requireRolEnClub('jugador')] as const,
        request: { params: ParamClub },
        responses: { 200: json(z.array(z.string()), 'Etiquetas, en orden alfabético'), ...errores },
      }),
      async (c) => {
        const { cid } = c.req.valid('param')
        const filas = await db.execute<{ etiqueta: string }>(
          sql`select distinct unnest(${ejercicios.etiquetas}) as etiqueta from ${ejercicios}
              where ${ejercicios.clubId} = ${cid} order by 1`,
        )
        return c.json(
          filas.rows.map((f) => f.etiqueta),
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/ejercicios/{eid}',
        tags: ['Ejercicios'],
        summary: 'Un ejercicio con sus fotos, vídeos y enlaces',
        middleware: [requireRolEnClub('jugador')] as const,
        request: { params: ParamEjercicio },
        responses: { 200: json(EsquemaEjercicio, 'Ejercicio'), ...errores },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        return c.json(await detalle(cid, eid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/ejercicios',
        tags: ['Ejercicios'],
        summary: 'Crear un ejercicio',
        description: 'Delegado o superior en alguna plantilla del club.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamClub,
          body: { content: { 'application/json': { schema: CuerpoEjercicio.strict() } } },
        },
        responses: {
          201: json(EsquemaEjercicio, 'Ejercicio creado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid } = c.req.valid('param')
        const datos = c.req.valid('json')
        const [creado] = await db
          .insert(ejercicios)
          .values({ ...datos, clubId: cid, creadoPor: c.var.usuario.id })
          .returning({ id: ejercicios.id })
        if (!creado) throw new Error('No se ha podido crear el ejercicio')
        return c.json(await detalle(cid, creado.id), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/clubes/{cid}/ejercicios/{eid}',
        tags: ['Ejercicios'],
        summary: 'Editar o archivar un ejercicio',
        description:
          'Delegado o superior en alguna plantilla del club. Los campos opcionales se quitan con null; `archivado: true` lo archiva (sigue en los planes que lo usan) y `false` lo recupera.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamEjercicio,
          body: {
            content: {
              'application/json': {
                schema: CuerpoEjercicio.extend({ archivado: z.boolean().optional() })
                  .partial()
                  .strict()
                  .refine((d) => Object.values(d).some((v) => v !== undefined), {
                    message: 'Indica algún dato que cambiar',
                  }),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaEjercicio, 'Ejercicio actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        await buscarEjercicio(cid, eid)
        await db.update(ejercicios).set(c.req.valid('json')).where(eq(ejercicios.id, eid))
        return c.json(await detalle(cid, eid), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/ejercicios/{eid}',
        tags: ['Ejercicios'],
        summary: 'Borrar un ejercicio',
        description:
          'Delegado o superior en alguna plantilla del club. Solo si no se ha usado en ningún plan ni modelo (si no, se archiva). Borra también sus archivos.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: { params: ParamEjercicio },
        responses: {
          204: { description: 'Ejercicio borrado' },
          409: json(EsquemaError, 'Está usado en algún plan o modelo'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        const e = await detalle(cid, eid)
        if (e.usos > 0) {
          throw new ErrorApi(
            409,
            'ejercicio_usado',
            `Se usa en ${e.usos === 1 ? 'un plan o modelo' : `${e.usos} planes o modelos`}: archívalo en lugar de borrarlo`,
          )
        }
        const archivos = await db
          .select({ archivo: ejercicioMedios.archivo, miniatura: ejercicioMedios.miniatura })
          .from(ejercicioMedios)
          .where(eq(ejercicioMedios.ejercicioId, eid))
        await db.delete(ejercicios).where(eq(ejercicios.id, eid))
        await borrar(...archivos.flatMap((a) => [a.archivo, a.miniatura]))
        return c.body(null, 204)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/ejercicios/{eid}/duplicar',
        tags: ['Ejercicios'],
        summary: 'Duplicar un ejercicio',
        description:
          'Delegado o superior en alguna plantilla del club. Copia sus datos y sus fotos, vídeos y enlaces (los vídeos que aún se procesan no se copian), para crear una variante.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: { params: ParamEjercicio },
        responses: { 201: json(EsquemaEjercicio, 'Copia creada'), ...errores },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        const original = await buscarEjercicio(cid, eid)
        const medios = await db
          .select()
          .from(ejercicioMedios)
          .where(and(eq(ejercicioMedios.ejercicioId, eid), eq(ejercicioMedios.estado, 'listo')))
          .orderBy(asc(ejercicioMedios.orden))
        const copiados: string[] = []
        const copiar = async (ruta: string | null) => {
          if (!ruta) return null
          const destino = nueva(carpetaDeClub(cid), ruta.split('.').pop() ?? 'bin')
          await copyFile(absoluta(ruta), absoluta(destino))
          copiados.push(destino)
          return destino
        }
        try {
          const id = await db.transaction(async (tx) => {
            const [copia] = await tx
              .insert(ejercicios)
              .values({
                clubId: cid,
                nombre: `${original.nombre} (copia)`.slice(0, 120),
                descripcion: original.descripcion,
                categoria: original.categoria,
                duracionMin: original.duracionMin,
                jugadores: original.jugadores,
                material: original.material,
                etiquetas: original.etiquetas,
                creadoPor: c.var.usuario.id,
              })
              .returning({ id: ejercicios.id })
            if (!copia) throw new Error('No se ha podido duplicar')
            for (const [orden, m] of medios.entries()) {
              await tx.insert(ejercicioMedios).values({
                ejercicioId: copia.id,
                tipo: m.tipo,
                archivo: await copiar(m.archivo),
                miniatura: await copiar(m.miniatura),
                url: m.url,
                mime: m.mime,
                tamanoBytes: m.tamanoBytes,
                duracionSeg: m.duracionSeg,
                pie: m.pie,
                orden,
              })
            }
            return copia.id
          })
          return c.json(await detalle(cid, id), 201)
        } catch (error) {
          await borrar(...copiados)
          throw error
        }
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/ejercicios/{eid}/medios/enlace',
        tags: ['Ejercicios'],
        summary: 'Añadir un enlace',
        description:
          'Delegado o superior en alguna plantilla del club. Un vídeo externo (por ejemplo, de YouTube): no ocupa espacio en el servidor.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamEjercicio,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    url: z
                      .url({
                        protocol: /^https?$/,
                        error: 'Debe ser una dirección web (https://…)',
                      })
                      .max(2000),
                    pie: textoOpcional(500),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          201: json(EsquemaMedio, 'Enlace añadido'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        await buscarEjercicio(cid, eid)
        const { url, pie = null } = c.req.valid('json')
        const [medio] = await db
          .insert(ejercicioMedios)
          .values({ ejercicioId: eid, tipo: 'enlace', url, pie, orden: await siguienteOrden(eid) })
          .returning(columnasMedio)
        if (!medio) throw new Error('No se ha podido añadir el enlace')
        return c.json(aMedio(medio), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'patch',
        path: '/clubes/{cid}/ejercicios/{eid}/medios/{mid}',
        tags: ['Ejercicios'],
        summary: 'Cambiar el pie de un medio',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamMedio,
          body: {
            content: {
              'application/json': { schema: z.object({ pie: textoOpcional(500) }).strict() },
            },
          },
        },
        responses: {
          200: json(EsquemaMedio, 'Medio actualizado'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid, mid } = c.req.valid('param')
        await buscarEjercicio(cid, eid)
        const [medio] = await db
          .update(ejercicioMedios)
          .set({ pie: c.req.valid('json').pie ?? null })
          .where(and(eq(ejercicioMedios.id, mid), eq(ejercicioMedios.ejercicioId, eid)))
          .returning(columnasMedio)
        if (!medio) throw new ErrorApi(404, 'no_encontrado', 'No existe ese medio en el ejercicio')
        return c.json(aMedio(medio), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'put',
        path: '/clubes/{cid}/ejercicios/{eid}/medios/orden',
        tags: ['Ejercicios'],
        summary: 'Reordenar los medios',
        description:
          'Delegado o superior en alguna plantilla del club. La lista completa de sus medios, en el orden nuevo.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: {
          params: ParamEjercicio,
          body: {
            content: {
              'application/json': {
                schema: z
                  .object({
                    medios: z
                      .array(EsquemaUuid)
                      .max(100)
                      .refine((l) => new Set(l).size === l.length, {
                        message: 'Hay medios repetidos',
                      }),
                  })
                  .strict(),
              },
            },
          },
        },
        responses: {
          200: json(EsquemaEjercicio, 'Orden guardado'),
          400: json(EsquemaError, 'La lista no son exactamente sus medios'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        const { medios: lista } = c.req.valid('json')
        await buscarEjercicio(cid, eid)
        await db.transaction(async (tx) => {
          const actuales = await tx
            .select({ id: ejercicioMedios.id })
            .from(ejercicioMedios)
            .where(eq(ejercicioMedios.ejercicioId, eid))
          const ids = new Set(actuales.map((m) => m.id))
          if (ids.size !== lista.length || lista.some((id) => !ids.has(id))) {
            throw new ErrorApi(
              400,
              'validacion',
              'Indica todos los medios del ejercicio, cada uno una vez',
            )
          }
          for (const [orden, id] of lista.entries()) {
            await tx.update(ejercicioMedios).set({ orden }).where(eq(ejercicioMedios.id, id))
          }
        })
        return c.json(await detalle(cid, eid), 200)
      },
    )
