import { createHash, randomBytes } from 'node:crypto'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/cliente.js'
import {
  adminsClub,
  fichas,
  invitaciones,
  jugadores,
  membresias,
  rol,
  user,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvClub, type EnvPlantilla, requireAdminClub, requireRol } from '../permisos.js'
import { registrarEvento, resumenEmail } from '../seguridad.js'
import { EsquemaUuid, restriccionViolada } from '../validacion.js'

// Invitaciones (sección 3 y 6, GH-49). La app no envía correos: al crear la invitación se devuelve
// el enlace una sola vez y quien invita lo comparte (por WhatsApp, por ejemplo). El token va detrás
// de «#», así no llega al servidor al abrir la página ni queda en los registros de nginx; en la base
// de datos solo se guarda su hash. Caduca a los 7 días y se usa una sola vez (GH-50).

export const DIAS_INVITACION = 7

// Hash del token, el que se guarda y con el que se busca al aceptar
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const nuevoToken = () => randomBytes(32).toString('base64url')

const enlaceDe = (token: string) => `${config.urlPublica}/invitacion#${token}`

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})

const errores = {
  401: json(EsquemaError, 'Sin sesión'),
  403: json(EsquemaError, 'Sin permiso'),
  404: json(EsquemaError, 'No existe'),
}

const EsquemaEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('El email no es válido').max(254, 'El email no es válido'))
  .openapi({ example: 'brais@example.com' })

const EsquemaInvitacion = z
  .object({
    id: z.uuid(),
    email: z.string(),
    rol: z
      .enum(rol.enumValues)
      .nullable()
      .openapi({ description: 'null en las de administrador del club' }),
    jugadorId: z.uuid().nullable(),
    jugador: z
      .string()
      .nullable()
      .openapi({ description: 'Nombre del jugador del club que se vinculará', example: 'Brais' }),
    estado: z.enum(['pendiente', 'caducada']),
    expira: z.string().openapi({ example: '2026-11-18T12:00:00.000Z' }),
    creadaEn: z.string(),
    creadaPor: z.string().nullable().openapi({ description: 'Nombre de quien invitó' }),
  })
  .openapi('Invitacion')

const EsquemaInvitacionCreada = z
  .object({
    invitacion: EsquemaInvitacion,
    enlace: z.string().openapi({
      description:
        'Enlace para aceptarla. Solo se devuelve ahora: para volver a enviarlo hay que invitar de nuevo (la anterior queda revocada)',
      example: 'https://vestuario.example/invitacion#…',
    }),
  })
  .openapi('InvitacionCreada')

const CuerpoInvitacionPlantilla = z
  .object({
    email: EsquemaEmail,
    rol: z.enum(rol.enumValues),
    jugadorId: EsquemaUuid.nullish().openapi({
      description: 'Solo con rol jugador: jugador con ficha en la plantilla, sin usuario vinculado',
    }),
  })
  .strict()

const CuerpoInvitacionClub = z.object({ email: EsquemaEmail }).strict()

const ParamPlantilla = z.object({ id: EsquemaUuid.openapi({ param: { name: 'id', in: 'path' } }) })
const ParamClub = z.object({ cid: EsquemaUuid.openapi({ param: { name: 'cid', in: 'path' } }) })
const ParamInvitacion = { iid: EsquemaUuid.openapi({ param: { name: 'iid', in: 'path' } }) }

const errorCampo = (estado: 400 | 409, codigo: string, campo: string, mensaje: string) =>
  new ErrorApi(estado, codigo, mensaje, [{ campo, mensaje }])

const noEncontrada = () => new ErrorApi(404, 'no_encontrado', 'No existe esa invitación')

// Invitaciones sin usar ni revocar (las caducadas también, marcadas), la más reciente primero
async function listar(clubId: string, plantillaId: string | null, id?: string) {
  const creador = db.select({ id: user.id, nombre: user.name }).from(user).as('creador')
  const filas = await db
    .select({
      id: invitaciones.id,
      email: invitaciones.email,
      rol: invitaciones.rol,
      jugadorId: invitaciones.jugadorId,
      jugador: sql<string | null>`concat_ws(' ', ${jugadores.nombre}, ${jugadores.apellidos})`,
      expira: invitaciones.expira,
      creadaEn: invitaciones.createdAt,
      creadaPor: creador.nombre,
    })
    .from(invitaciones)
    .leftJoin(jugadores, eq(jugadores.id, invitaciones.jugadorId))
    .leftJoin(creador, eq(creador.id, invitaciones.creadaPor))
    .where(
      and(
        eq(invitaciones.clubId, clubId),
        plantillaId ? eq(invitaciones.plantillaId, plantillaId) : isNull(invitaciones.plantillaId),
        isNull(invitaciones.usadaEn),
        isNull(invitaciones.revocadaEn),
        id ? eq(invitaciones.id, id) : undefined,
      ),
    )
    .orderBy(desc(invitaciones.createdAt), desc(invitaciones.id))
  const ahora = Date.now()
  return filas.map((f) => ({
    ...f,
    jugador: f.jugadorId ? f.jugador : null,
    estado: f.expira.getTime() > ahora ? ('pendiente' as const) : ('caducada' as const),
    expira: f.expira.toISOString(),
    creadaEn: f.creadaEn.toISOString(),
  }))
}

// Crea la invitación y revoca la pendiente que hubiera para el mismo email, en una transacción
async function crear(datos: {
  clubId: string
  plantillaId: string | null
  email: string
  rol: (typeof rol.enumValues)[number] | null
  jugadorId: string | null
  creadaPor: string
}) {
  const token = nuevoToken()
  const expira = new Date(Date.now() + DIAS_INVITACION * 24 * 60 * 60 * 1000)
  const id = await db
    .transaction(async (tx) => {
      await tx
        .update(invitaciones)
        .set({ revocadaEn: new Date() })
        .where(
          and(
            eq(invitaciones.clubId, datos.clubId),
            datos.plantillaId
              ? eq(invitaciones.plantillaId, datos.plantillaId)
              : isNull(invitaciones.plantillaId),
            eq(invitaciones.email, datos.email),
            isNull(invitaciones.usadaEn),
            isNull(invitaciones.revocadaEn),
          ),
        )
      const [nueva] = await tx
        .insert(invitaciones)
        .values({ ...datos, tokenHash: hashToken(token), expira })
        .returning({ id: invitaciones.id })
      if (!nueva) throw new Error('No se pudo crear la invitación')
      return nueva.id
    })
    .catch((error: unknown) => {
      // Otra petición ha invitado al mismo email a la vez
      if (restriccionViolada(error) === 'invitaciones_una_pendiente') {
        throw new ErrorApi(
          409,
          'invitacion_simultanea',
          'Ya se está invitando a ese email: inténtalo de nuevo',
        )
      }
      throw error
    })
  return { id, token }
}

async function revocar(clubId: string, plantillaId: string | null, iid: string) {
  const revocadas = await db
    .update(invitaciones)
    .set({ revocadaEn: new Date() })
    .where(
      and(
        eq(invitaciones.id, iid),
        eq(invitaciones.clubId, clubId),
        plantillaId ? eq(invitaciones.plantillaId, plantillaId) : isNull(invitaciones.plantillaId),
        isNull(invitaciones.usadaEn),
        isNull(invitaciones.revocadaEn),
      ),
    )
    .returning({ id: invitaciones.id, email: invitaciones.email })
  const [revocada] = revocadas
  if (!revocada) throw noEncontrada()
  return revocada
}

// Usuario con ese email, si ya tiene cuenta
async function usuarioConEmail(email: string) {
  const [u] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email}`)
  return u
}

export const rutasInvitacionesPlantilla = () =>
  new OpenAPIHono<EnvPlantilla>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/plantillas/{id}/invitaciones',
        tags: ['Invitaciones'],
        summary: 'Invitaciones pendientes de la plantilla',
        description:
          'Admin. Las que no se han usado ni revocado, la más reciente primero; las caducadas, con estado `caducada`. El enlace no se vuelve a mostrar.',
        middleware: [requireRol('admin')] as const,
        request: { params: ParamPlantilla },
        responses: { 200: json(z.array(EsquemaInvitacion), 'Invitaciones'), ...errores },
      }),
      async (c) => {
        const { clubId, id } = c.var.plantilla
        return c.json(await listar(clubId, id), 200)
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/plantillas/{id}/invitaciones',
        tags: ['Invitaciones'],
        summary: 'Invitar a la plantilla',
        description: `Admin. Invita a un email con un rol; con rol jugador se puede indicar el jugador del club (con ficha en la plantilla y sin usuario) al que se vinculará su cuenta. Devuelve el enlace, de un solo uso y válido ${DIAS_INVITACION} días; solo ahora. Invitar otra vez al mismo email revoca la invitación anterior.`,
        middleware: [requireRol('admin')] as const,
        request: {
          params: ParamPlantilla,
          body: { content: { 'application/json': { schema: CuerpoInvitacionPlantilla } } },
        },
        responses: {
          201: json(EsquemaInvitacionCreada, 'Invitación creada'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya es miembro de la plantilla o el jugador ya tiene usuario'),
          ...errores,
        },
      }),
      async (c) => {
        const { email, rol: rolInvitado, jugadorId = null } = c.req.valid('json')
        const plantilla = c.var.plantilla

        if (jugadorId) {
          if (rolInvitado !== 'jugador') {
            throw errorCampo(
              400,
              'validacion',
              'jugadorId',
              'Solo se vincula un jugador con el rol jugador',
            )
          }
          const [ficha] = await db
            .select({ usuarioId: jugadores.usuarioId })
            .from(fichas)
            .innerJoin(jugadores, eq(jugadores.id, fichas.jugadorId))
            .where(and(eq(fichas.plantillaId, plantilla.id), eq(fichas.jugadorId, jugadorId)))
          if (!ficha) {
            throw errorCampo(
              400,
              'jugador_sin_ficha',
              'jugadorId',
              'Ese jugador no tiene ficha en esta plantilla',
            )
          }
          if (ficha.usuarioId) {
            throw errorCampo(
              409,
              'jugador_con_usuario',
              'jugadorId',
              'Ese jugador ya tiene su cuenta',
            )
          }
        }

        const existente = await usuarioConEmail(email)
        if (existente) {
          const [miembro] = await db
            .select({ rol: membresias.rol })
            .from(membresias)
            .where(
              and(eq(membresias.plantillaId, plantilla.id), eq(membresias.usuarioId, existente.id)),
            )
          if (miembro) {
            throw errorCampo(
              409,
              'ya_es_miembro',
              'email',
              `Ya es miembro de la plantilla (${miembro.rol})`,
            )
          }
        }

        const { id, token } = await crear({
          clubId: plantilla.clubId,
          plantillaId: plantilla.id,
          email,
          rol: rolInvitado,
          jugadorId,
          creadaPor: c.var.usuario.id,
        })
        registrarEvento('invitacion_creada', {
          usuarioId: c.var.usuario.id,
          invitacionId: id,
          plantillaId: plantilla.id,
          rol: rolInvitado,
          emailResumen: resumenEmail(email),
        })
        const [invitacion] = await listar(plantilla.clubId, plantilla.id, id)
        if (!invitacion) throw noEncontrada()
        return c.json({ invitacion, enlace: enlaceDe(token) }, 201)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/plantillas/{id}/invitaciones/{iid}',
        tags: ['Invitaciones'],
        summary: 'Revocar una invitación',
        description: 'Admin. El enlace deja de valer. Solo las que no se han usado.',
        middleware: [requireRol('admin')] as const,
        request: { params: ParamPlantilla.extend(ParamInvitacion) },
        responses: { 204: { description: 'Invitación revocada' }, ...errores },
      }),
      async (c) => {
        const { iid } = c.req.valid('param')
        const plantilla = c.var.plantilla
        const revocada = await revocar(plantilla.clubId, plantilla.id, iid)
        registrarEvento('invitacion_revocada', {
          usuarioId: c.var.usuario.id,
          invitacionId: revocada.id,
          plantillaId: plantilla.id,
          emailResumen: resumenEmail(revocada.email),
        })
        return c.body(null, 204)
      },
    )

export const rutasInvitacionesClub = () =>
  new OpenAPIHono<EnvClub>({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'get',
        path: '/clubes/{cid}/invitaciones',
        tags: ['Invitaciones'],
        summary: 'Invitaciones pendientes como administrador del club',
        description: 'Solo administradores del club. Igual que las de la plantilla.',
        middleware: [requireAdminClub()] as const,
        request: { params: ParamClub },
        responses: { 200: json(z.array(EsquemaInvitacion), 'Invitaciones'), ...errores },
      }),
      async (c) => c.json(await listar(c.var.club.id, null), 200),
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/clubes/{cid}/invitaciones',
        tags: ['Invitaciones'],
        summary: 'Invitar como administrador del club',
        description: `Solo administradores del club. Devuelve el enlace, de un solo uso y válido ${DIAS_INVITACION} días; solo ahora. Invitar otra vez al mismo email revoca la invitación anterior.`,
        middleware: [requireAdminClub()] as const,
        request: {
          params: ParamClub,
          body: { content: { 'application/json': { schema: CuerpoInvitacionClub } } },
        },
        responses: {
          201: json(EsquemaInvitacionCreada, 'Invitación creada'),
          400: json(EsquemaError, 'Datos no válidos'),
          409: json(EsquemaError, 'Ya es administrador del club'),
          ...errores,
        },
      }),
      async (c) => {
        const { email } = c.req.valid('json')
        const club = c.var.club
        const existente = await usuarioConEmail(email)
        if (existente) {
          const [admin] = await db
            .select({ usuarioId: adminsClub.usuarioId })
            .from(adminsClub)
            .where(and(eq(adminsClub.clubId, club.id), eq(adminsClub.usuarioId, existente.id)))
          if (admin) {
            throw errorCampo(409, 'ya_es_miembro', 'email', 'Ya es administrador del club')
          }
        }
        const { id, token } = await crear({
          clubId: club.id,
          plantillaId: null,
          email,
          rol: null,
          jugadorId: null,
          creadaPor: c.var.usuario.id,
        })
        registrarEvento('invitacion_creada', {
          usuarioId: c.var.usuario.id,
          invitacionId: id,
          clubId: club.id,
          rol: 'administrador del club',
          emailResumen: resumenEmail(email),
        })
        const [invitacion] = await listar(club.id, null, id)
        if (!invitacion) throw noEncontrada()
        return c.json({ invitacion, enlace: enlaceDe(token) }, 201)
      },
    )
    .openapi(
      createRoute({
        method: 'delete',
        path: '/clubes/{cid}/invitaciones/{iid}',
        tags: ['Invitaciones'],
        summary: 'Revocar una invitación como administrador del club',
        description: 'Solo administradores del club. Solo las que no se han usado.',
        middleware: [requireAdminClub()] as const,
        request: { params: ParamClub.extend(ParamInvitacion) },
        responses: { 204: { description: 'Invitación revocada' }, ...errores },
      }),
      async (c) => {
        const { iid } = c.req.valid('param')
        const revocada = await revocar(c.var.club.id, null, iid)
        registrarEvento('invitacion_revocada', {
          usuarioId: c.var.usuario.id,
          invitacionId: revocada.id,
          clubId: c.var.club.id,
          emailResumen: resumenEmail(revocada.email),
        })
        return c.body(null, 204)
      },
    )
