import { createHash, randomBytes } from 'node:crypto'
import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { auth, LONGITUD_MINIMA_CONTRASENA } from '../auth.js'
import { config } from '../config.js'
import { db } from '../db/cliente.js'
import {
  account,
  adminsClub,
  clubes,
  fichas,
  invitaciones,
  jugadores,
  membresias,
  plantillas,
  rol,
  user,
} from '../db/schema/index.js'
import { ErrorApi, EsquemaError, validacionFallida } from '../errores.js'
import { type EnvClub, type EnvPlantilla, requireAdminClub, requireRol } from '../permisos.js'
import { ipDe, normalizarEmail, registrarEvento, resumenEmail } from '../seguridad.js'
import { EsquemaTexto, EsquemaUuid, restriccionViolada } from '../validacion.js'

// Invitaciones (sección 3 y 6, GH-49). La app no envía correos: al crear la invitación se devuelve
// el enlace una sola vez y quien invita lo comparte (por WhatsApp, por ejemplo). El token va detrás
// de «#», así no llega al servidor al abrir la página ni queda en los registros de nginx; en la base
// de datos solo se guarda su hash. Caduca a los 7 días y se usa una sola vez (GH-50).

export const DIAS_INVITACION = 7

// Hash del token, el que se guarda y con el que se busca al aceptar
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

const nombreJugador = sql<string>`concat_ws(' ', ${jugadores.nombre}, ${jugadores.apellidos})`

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

// Aceptar la invitación (GH-50): rutas públicas, con el token en el cuerpo (nunca en la URL, para que
// no quede en los registros). nginx las limita por IP como el login.

const CuerpoToken = z.object({ token: z.string().min(20).max(100) }).strict()

const CuerpoAceptar = CuerpoToken.extend({
  nombre: EsquemaTexto('El nombre').optional().openapi({ description: 'Solo al crear la cuenta' }),
  contrasena: z
    .string()
    .max(128)
    .optional()
    .openapi({
      description: `Solo al crear la cuenta; mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres`,
    }),
}).strict()

const EsquemaInvitacionAbierta = z
  .object({
    email: z.string(),
    club: z.string().openapi({ example: 'CD Rexional' }),
    clubId: z.uuid(),
    plantilla: z
      .object({ id: z.uuid(), nombre: z.string(), temporada: z.string() })
      .nullable()
      .openapi({ description: 'null en las de administrador del club' }),
    rol: z.enum(rol.enumValues).nullable(),
    jugador: z.string().nullable().openapi({ description: 'Jugador del club que se vinculará' }),
    cuentaExiste: z.boolean().openapi({
      description: 'Si ya hay una cuenta con ese email: entonces hay que iniciar sesión',
    }),
  })
  .openapi('InvitacionAbierta')

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// La invitación del token, si se puede usar; si no, el error que lo explica. En la transacción de
// aceptarla, bloqueada: si llegan dos a la vez, la segunda ya la ve usada.
async function invitacionDeToken(token: string, tx?: Tx) {
  const consulta = (tx ?? db)
    .select()
    .from(invitaciones)
    .where(eq(invitaciones.tokenHash, hashToken(token)))
  const [invitacion] = tx ? await consulta.for('update') : await consulta
  if (!invitacion) {
    throw new ErrorApi(404, 'invitacion_no_valida', 'El enlace de la invitación no es válido')
  }
  const otra = 'Pide a quien te invitó que te envíe otra.'
  if (invitacion.usadaEn) {
    throw new ErrorApi(410, 'invitacion_usada', `Esta invitación ya se ha usado. ${otra}`)
  }
  if (invitacion.revocadaEn) {
    throw new ErrorApi(410, 'invitacion_revocada', `Esta invitación se ha anulado. ${otra}`)
  }
  if (invitacion.expira.getTime() <= Date.now()) {
    throw new ErrorApi(410, 'invitacion_caducada', `Esta invitación ha caducado. ${otra}`)
  }
  return invitacion
}

const iniciaSesion = (email: string) =>
  new ErrorApi(
    401,
    'inicia_sesion',
    `Ya hay una cuenta con ${email}: inicia sesión para aceptar la invitación`,
  )

const erroresPublicos = {
  404: json(EsquemaError, 'El enlace no es válido'),
  410: json(EsquemaError, 'Usada, anulada o caducada'),
}

export const rutasInvitacionesPublicas = () =>
  new OpenAPIHono({ defaultHook: validacionFallida })
    .openapi(
      createRoute({
        method: 'post',
        path: '/invitaciones/consultar',
        tags: ['Invitaciones'],
        summary: 'Ver una invitación',
        description:
          'Pública, con el token del enlace en el cuerpo. No cambia nada: dice a qué invita y si ya hay una cuenta con ese email.',
        request: { body: { content: { 'application/json': { schema: CuerpoToken } } } },
        responses: {
          200: json(EsquemaInvitacionAbierta, 'Invitación'),
          400: json(EsquemaError, 'Datos no válidos'),
          ...erroresPublicos,
        },
      }),
      async (c) => {
        const invitacion = await invitacionDeToken(c.req.valid('json').token)
        const [club] = await db
          .select({ nombre: clubes.nombre })
          .from(clubes)
          .where(eq(clubes.id, invitacion.clubId))
        const [plantilla] = invitacion.plantillaId
          ? await db
              .select({
                id: plantillas.id,
                nombre: plantillas.nombre,
                temporada: plantillas.temporada,
              })
              .from(plantillas)
              .where(eq(plantillas.id, invitacion.plantillaId))
          : []
        const [jugador] = invitacion.jugadorId
          ? await db
              .select({ nombre: nombreJugador })
              .from(jugadores)
              .where(eq(jugadores.id, invitacion.jugadorId))
          : []
        return c.json(
          {
            email: invitacion.email,
            club: club?.nombre ?? '',
            clubId: invitacion.clubId,
            plantilla: plantilla ?? null,
            rol: invitacion.rol,
            jugador: jugador?.nombre ?? null,
            cuentaExiste: (await usuarioConEmail(invitacion.email)) !== undefined,
          },
          200,
        )
      },
    )
    .openapi(
      createRoute({
        method: 'post',
        path: '/invitaciones/aceptar',
        tags: ['Invitaciones'],
        summary: 'Aceptar una invitación',
        description: `Pública, con el token del enlace en el cuerpo. La invitación es para un email: si ya hay una cuenta con él, hay que haber iniciado sesión con ella; si no, se crea con \`nombre\` y \`contrasena\` (mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres) y se inicia la sesión. Crea la membresía con el rol de la invitación (o hace administrador del club) y vincula el jugador, si lo hay. De un solo uso.`,
        request: { body: { content: { 'application/json': { schema: CuerpoAceptar } } } },
        responses: {
          200: json(
            z
              .object({ clubId: z.uuid(), plantillaId: z.uuid().nullable() })
              .openapi('InvitacionAceptada'),
            'Aceptada; si se ha creado la cuenta, con la cookie de sesión',
          ),
          400: json(EsquemaError, 'Datos no válidos'),
          401: json(EsquemaError, 'Ya hay una cuenta con ese email: inicia sesión'),
          403: json(EsquemaError, 'Has entrado con otro email'),
          409: json(EsquemaError, 'El jugador ya tiene otra cuenta'),
          ...erroresPublicos,
        },
      }),
      async (c) => {
        const { token, nombre, contrasena } = c.req.valid('json')
        const cabeceras = c.req.raw.headers
        const previa = await invitacionDeToken(token)
        const sesion = await auth.api.getSession({ headers: cabeceras })
        const existente = await usuarioConEmail(previa.email)

        if (sesion && normalizarEmail(sesion.user.email) !== previa.email) {
          throw new ErrorApi(
            403,
            'otro_email',
            `Has entrado como ${sesion.user.email} y la invitación es para ${previa.email}: cierra sesión para aceptarla`,
          )
        }
        if (existente && !sesion) throw iniciaSesion(previa.email)
        const nuevaCuenta = !existente
        if (nuevaCuenta) {
          const faltan: { campo: string; mensaje: string }[] = []
          if (!nombre) faltan.push({ campo: 'nombre', mensaje: 'Escribe tu nombre' })
          if (!contrasena || contrasena.length < LONGITUD_MINIMA_CONTRASENA) {
            faltan.push({
              campo: 'contrasena',
              mensaje: `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`,
            })
          }
          if (faltan.length > 0) throw new ErrorApi(400, 'validacion', 'Revisa los datos', faltan)
        }
        // El mismo algoritmo con el que Better Auth la comprobará al iniciar sesión
        const hash = nuevaCuenta
          ? await (await auth.$context).password.hash(contrasena ?? '')
          : null

        const { invitacion, usuarioId } = await db
          .transaction(async (tx) => {
            const invitacion = await invitacionDeToken(token, tx)
            let usuarioId = existente?.id
            if (!usuarioId) {
              const [usuario] = await tx
                .insert(user)
                .values({ name: nombre ?? '', email: invitacion.email, emailVerified: true })
                .returning({ id: user.id })
              if (!usuario) throw new Error('No se pudo crear el usuario')
              usuarioId = usuario.id
              await tx.insert(account).values({
                accountId: usuarioId,
                providerId: 'credential',
                userId: usuarioId,
                password: hash,
              })
            }

            if (invitacion.plantillaId && invitacion.rol) {
              // Si ya era miembro, se queda con el rol de la invitación
              await tx
                .insert(membresias)
                .values({ plantillaId: invitacion.plantillaId, usuarioId, rol: invitacion.rol })
                .onConflictDoUpdate({
                  target: [membresias.plantillaId, membresias.usuarioId],
                  set: { rol: invitacion.rol },
                })
            } else {
              await tx
                .insert(adminsClub)
                .values({ clubId: invitacion.clubId, usuarioId })
                .onConflictDoNothing()
            }

            if (invitacion.jugadorId) {
              const [jugador] = await tx
                .select({ usuarioId: jugadores.usuarioId })
                .from(jugadores)
                .where(eq(jugadores.id, invitacion.jugadorId))
                .for('update')
              if (jugador?.usuarioId && jugador.usuarioId !== usuarioId) {
                throw new ErrorApi(
                  409,
                  'jugador_con_usuario',
                  'Ese jugador ya está vinculado a otra cuenta: pide que te inviten de nuevo',
                )
              }
              await tx
                .update(jugadores)
                .set({ usuarioId })
                .where(eq(jugadores.id, invitacion.jugadorId))
            }

            await tx
              .update(invitaciones)
              .set({ usadaEn: new Date() })
              .where(eq(invitaciones.id, invitacion.id))
            return { invitacion, usuarioId }
          })
          .catch((error: unknown) => {
            const restriccion = restriccionViolada(error)
            if (restriccion === 'jugadores_usuario_por_club') {
              throw new ErrorApi(
                409,
                'usuario_con_jugador',
                'Tu cuenta ya está vinculada a otro jugador del club',
              )
            }
            // Alguien ha creado la cuenta con ese email mientras tanto
            if (restriccion === 'user_email_unique') throw iniciaSesion(previa.email)
            throw error
          })

        if (nuevaCuenta) {
          registrarEvento('cuenta_creada', {
            usuarioId,
            invitacionId: invitacion.id,
            ip: ipDe(cabeceras),
          })
        }
        registrarEvento('invitacion_aceptada', {
          usuarioId,
          invitacionId: invitacion.id,
          ...(invitacion.plantillaId
            ? { plantillaId: invitacion.plantillaId, rol: invitacion.rol }
            : { clubId: invitacion.clubId, rol: 'administrador del club' }),
        })

        const respuesta = c.json(
          { clubId: invitacion.clubId, plantillaId: invitacion.plantillaId },
          200,
        )
        // Cuenta nueva: se entra directamente, con la sesión que crea Better Auth
        if (nuevaCuenta) {
          const entrada = await auth.api.signInEmail({
            body: { email: invitacion.email, password: contrasena ?? '' },
            headers: cabeceras,
            asResponse: true,
          })
          for (const cookie of entrada.headers.getSetCookie()) {
            respuesta.headers.append('set-cookie', cookie)
          }
        }
        return respuesta
      },
    )
