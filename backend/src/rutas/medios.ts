import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/cliente.js'
import { ejercicioMedios, ejercicios, estadoMedio, tipoMedio } from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { absoluta, borrar, mover, nueva } from '../medios/almacen.js'
import { encolar } from '../medios/cola.js'
import { procesarFoto } from '../medios/procesar.js'
import { recibirArchivo } from '../medios/subida.js'
import {
  type EnvClub,
  type EnvSesion,
  requireRolEnClub,
  requireSesion,
  rolEnClub,
} from '../permisos.js'
import { EsquemaUuid } from '../validacion.js'

// Fotos y vídeos de los ejercicios (sección 2.8, GH-39). Se suben en streaming a un ejercicio del
// club; las fotos se procesan al momento y los vídeos en segundo plano («procesando»). Los archivos
// se sirven solo a quien es miembro de alguna plantilla del club, con caché larga (los nombres no se
// reutilizan) y con Range, para avanzar en los vídeos.

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

export const EsquemaMedio = z
  .object({
    id: z.uuid(),
    tipo: z.enum(tipoMedio.enumValues),
    estado: z.enum(estadoMedio.enumValues).openapi({
      description:
        'Un vídeo está «procesando» hasta que tiene miniatura (y, si hacía falta, se recodifica)',
    }),
    mime: z.string().nullable(),
    tamanoBytes: z.number().int().nullable(),
    duracionSeg: z.int().nullable(),
    pie: z.string().nullable(),
    orden: z.int(),
    url: z.string().nullable().openapi({ description: 'Solo en los enlaces' }),
    urlArchivo: z.string().nullable().openapi({ example: '/api/medios/…' }),
    urlMiniatura: z.string().nullable(),
  })
  .openapi('Medio')

export const columnasMedio = {
  id: ejercicioMedios.id,
  tipo: ejercicioMedios.tipo,
  estado: ejercicioMedios.estado,
  mime: ejercicioMedios.mime,
  tamanoBytes: ejercicioMedios.tamanoBytes,
  duracionSeg: ejercicioMedios.duracionSeg,
  pie: ejercicioMedios.pie,
  orden: ejercicioMedios.orden,
  url: ejercicioMedios.url,
  miniatura: ejercicioMedios.miniatura,
}

// La fila de la base de datos como la ve la API: direcciones en lugar de rutas en disco
export const aMedio = ({
  miniatura,
  ...m
}: { miniatura: string | null } & Omit<
  z.infer<typeof EsquemaMedio>,
  'urlArchivo' | 'urlMiniatura'
>) => ({
  ...m,
  urlArchivo: m.tipo !== 'enlace' && m.estado === 'listo' ? `/api/medios/${m.id}` : null,
  urlMiniatura: miniatura && m.estado === 'listo' ? `/api/medios/${m.id}/miniatura` : null,
})

const ParamEjercicio = z.object({
  cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }),
  eid: EsquemaUuid.openapi({ param: { name: 'eid', in: 'path' } }),
})
const ParamMedio = ParamEjercicio.extend({
  mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }),
})

async function ejercicioDelClub(clubId: string, ejercicioId: string) {
  const [ejercicio] = await db
    .select({ id: ejercicios.id })
    .from(ejercicios)
    .where(and(eq(ejercicios.id, ejercicioId), eq(ejercicios.clubId, clubId)))
  if (!ejercicio) throw new ErrorApi(404, 'no_encontrado', 'No existe ese ejercicio en el club')
}

// Quita un medio y sus archivos (también si su vídeo aún se está procesando)
export async function borrarMedio(medioId: string) {
  const [borrado] = await db
    .delete(ejercicioMedios)
    .where(eq(ejercicioMedios.id, medioId))
    .returning({ archivo: ejercicioMedios.archivo, miniatura: ejercicioMedios.miniatura })
  if (borrado) await borrar(borrado.archivo, borrado.miniatura)
  return Boolean(borrado)
}

export const rutasMediosClub = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/ejercicios/{eid}/medios',
        tags: ['Ejercicios'],
        summary: 'Subir una foto o un vídeo',
        description:
          'Delegado o superior en alguna plantilla del club. Cuerpo `multipart/form-data` con el archivo en `archivo` y, opcional, `pie` (no se declara aquí: validarlo leería el cuerpo entero y la subida dejaría de ir en streaming). Fotos JPEG, PNG o WebP; vídeos MP4, MOV o WebM. Límites configurables (por defecto 15 MB por foto y 150 MB por vídeo). La foto se guarda reducida, en WebP y sin metadatos; el vídeo queda «procesando» hasta tener miniatura y, si hace falta, recodificarse a MP4 H.264.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: { params: ParamEjercicio },
        responses: {
          201: json(EsquemaMedio, 'Medio añadido'),
          400: json(EsquemaError, 'Falta el archivo'),
          413: json(EsquemaError, 'Supera el límite'),
          415: json(EsquemaError, 'Tipo no admitido'),
          ...errores,
        },
      }),
      async (c) => {
        const { cid, eid } = c.req.valid('param')
        await ejercicioDelClub(cid, eid)
        const subida = await recibirArchivo(c.req.raw)
        const pie = subida.campos.pie?.trim().slice(0, 500) || null
        const [ultimo] = await db
          .select({ orden: sql<number>`coalesce(max(${ejercicioMedios.orden}), -1)::int` })
          .from(ejercicioMedios)
          .where(eq(ejercicioMedios.ejercicioId, eid))
        const orden = (ultimo?.orden ?? -1) + 1

        let datos: typeof ejercicioMedios.$inferInsert
        if (subida.tipo.tipo === 'foto') {
          datos = {
            ejercicioId: eid,
            tipo: 'foto',
            pie,
            orden,
            ...(await procesarFoto(subida.temporal, cid)),
          }
        } else {
          const pendiente = nueva('pendientes', subida.tipo.extension)
          await mover(subida.temporal, pendiente)
          datos = {
            ejercicioId: eid,
            tipo: 'video',
            estado: 'procesando',
            archivo: pendiente,
            mime: subida.tipo.mime,
            tamanoBytes: subida.bytes,
            pie,
            orden,
          }
        }
        const [medio] = await db.insert(ejercicioMedios).values(datos).returning(columnasMedio)
        if (!medio) throw new Error('No se ha podido guardar el medio')
        if (medio.estado === 'procesando') encolar(medio.id)
        return c.json(aMedio(medio), 201)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/ejercicios/{eid}/medios/{mid}',
        tags: ['Ejercicios'],
        summary: 'Quitar una foto, un vídeo o un enlace',
        description:
          'Delegado o superior en alguna plantilla del club. Borra también sus archivos.',
        middleware: [requireRolEnClub('delegado')] as const,
        request: { params: ParamMedio },
        responses: { 204: { description: 'Medio quitado' }, ...errores },
      }),
      async (c) => {
        const { cid, eid, mid } = c.req.valid('param')
        await ejercicioDelClub(cid, eid)
        const [medio] = await db
          .select({ id: ejercicioMedios.id })
          .from(ejercicioMedios)
          .where(and(eq(ejercicioMedios.id, mid), eq(ejercicioMedios.ejercicioId, eid)))
        if (!medio || !(await borrarMedio(mid))) {
          throw new ErrorApi(404, 'no_encontrado', 'No existe ese medio en el ejercicio')
        }
        return c.body(null, 204)
      },
    )

// Rango pedido ("bytes=inicio-fin", "bytes=inicio-" o "bytes=-últimos"), o null si es entero
function leerRango(cabecera: string | undefined, total: number) {
  const m = cabecera?.match(/^bytes=(\d*)-(\d*)$/)
  if (!m || (!m[1] && !m[2])) return null
  let inicio: number
  let fin: number
  if (!m[1]) {
    inicio = Math.max(0, total - Number(m[2]))
    fin = total - 1
  } else {
    inicio = Number(m[1])
    fin = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1
  }
  if (inicio > fin || inicio >= total) return 'invalido' as const
  return { inicio, fin }
}

const servir = (cual: 'archivo' | 'miniatura') =>
  createRoute({
    method: 'get',
    path: cual === 'archivo' ? '/medios/{mid}' : '/medios/{mid}/miniatura',
    tags: ['Ejercicios'],
    summary:
      cual === 'archivo' ? 'Archivo de una foto o un vídeo' : 'Miniatura de una foto o un vídeo',
    description:
      'Miembro de alguna plantilla del club del ejercicio. Admite Range (respuesta 206) para avanzar en los vídeos.',
    middleware: [requireSesion()] as const,
    request: {
      params: z.object({ mid: EsquemaUuid.openapi({ param: { name: 'mid', in: 'path' } }) }),
    },
    responses: {
      200: {
        description: 'El archivo',
        content: {
          'application/octet-stream': { schema: z.string().openapi({ format: 'binary' }) },
        },
      },
      206: { description: 'Un trozo del archivo' },
      416: { description: 'Rango no válido' },
      ...errores,
    },
  })

async function responderArchivo(
  c: import('hono').Context<EnvSesion>,
  mid: string,
  cual: 'archivo' | 'miniatura',
) {
  const [medio] = await db
    .select({
      tipo: ejercicioMedios.tipo,
      estado: ejercicioMedios.estado,
      archivo: ejercicioMedios.archivo,
      miniatura: ejercicioMedios.miniatura,
      mime: ejercicioMedios.mime,
      clubId: ejercicios.clubId,
    })
    .from(ejercicioMedios)
    .innerJoin(ejercicios, eq(ejercicios.id, ejercicioMedios.ejercicioId))
    .where(eq(ejercicioMedios.id, mid))
  const noEsta = new ErrorApi(404, 'no_encontrado', 'No existe ese archivo')
  if (!medio) throw noEsta
  if (!(await rolEnClub(c.var.usuario.id, medio.clubId))) {
    throw new ErrorApi(403, 'sin_permiso', 'No tienes acceso a este club')
  }
  const relativa = cual === 'archivo' ? medio.archivo : medio.miniatura
  if (medio.tipo === 'enlace' || medio.estado !== 'listo' || !relativa) throw noEsta
  const ruta = absoluta(relativa)
  const info = await stat(ruta).catch(() => null)
  if (!info) throw noEsta

  const cabeceras: Record<string, string> = {
    'content-type': cual === 'archivo' ? (medio.mime ?? 'application/octet-stream') : 'image/webp',
    'accept-ranges': 'bytes',
    // El archivo de un medio no cambia nunca (uno nuevo tiene otro nombre)
    'cache-control': 'private, max-age=31536000, immutable',
  }
  const rango = leerRango(c.req.header('range'), info.size)
  if (rango === 'invalido') {
    return c.body(null, 416, { 'content-range': `bytes */${info.size}` })
  }
  const { inicio, fin } = rango ?? { inicio: 0, fin: info.size - 1 }
  const flujo = Readable.toWeb(
    createReadStream(ruta, { start: inicio, end: fin }),
  ) as ReadableStream
  return c.body(flujo, rango ? 206 : 200, {
    ...cabeceras,
    'content-length': String(fin - inicio + 1),
    ...(rango ? { 'content-range': `bytes ${inicio}-${fin}/${info.size}` } : {}),
  })
}

export const rutasMedios = () =>
  new OpenAPIHono<EnvSesion>({ defaultHook: validacionFallida })
    .openapi(
      servir('archivo'),
      (c) => responderArchivo(c, c.req.valid('param').mid, 'archivo') as never,
    )
    .openapi(
      servir('miniatura'),
      (c) => responderArchivo(c, c.req.valid('param').mid, 'miniatura') as never,
    )
