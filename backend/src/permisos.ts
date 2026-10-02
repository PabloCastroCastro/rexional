import { and, eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { auth } from './auth.js'
import { db } from './db/cliente.js'
import {
  adminsClub,
  clubes,
  jugadores,
  membresias,
  plantillas,
  type rol,
} from './db/schema/index.js'
import { ErrorApi } from './errores.js'

// Autorización por club, plantilla y rol (sección 3). Los permisos se aplican siempre aquí, en el
// backend; el frontend solo oculta lo que el usuario no puede hacer.
//
//   app.get('/plantillas/:id/jugadores', requireRol('jugador'), (c) => ... c.var.rol ...)
//   app.post('/clubes/:cid/plantillas', requireAdminClub(), (c) => ...)

export type Rol = (typeof rol.enumValues)[number]

// Jerarquía: admin > entrenador > delegado > jugador
const NIVEL: Record<Rol, number> = { jugador: 1, delegado: 2, entrenador: 3, admin: 4 }

export const rolAlcanza = (rolUsuario: Rol, minimo: Rol) => NIVEL[rolUsuario] >= NIVEL[minimo]

const rolMayor = (roles: Rol[]): Rol | null =>
  roles.reduce<Rol | null>(
    (mayor, r) => (mayor === null || NIVEL[r] > NIVEL[mayor] ? r : mayor),
    null,
  )

type Sesion = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

export type VariablesSesion = {
  usuario: Sesion['user']
  sesion: Sesion['session']
}

// Contexto común de las rutas de plantilla y de club
type VariablesAcceso = VariablesSesion & {
  // Rol efectivo: el de su membresía, o admin si administra el club (el mayor)
  rol: Rol
  esAdminClub: boolean
  // Jugador del club vinculado al usuario, para que el rol jugador vea solo sus datos
  jugadorId: string | null
}

export type EnvSesion = { Variables: VariablesSesion }

export type EnvPlantilla = {
  Variables: VariablesAcceso & {
    plantilla: { id: string; clubId: string; nombre: string; temporada: string }
  }
}

export type EnvClub = {
  Variables: VariablesAcceso & { club: { id: string; nombre: string } }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const noAutenticado = () => new ErrorApi(401, 'no_autenticado', 'Tienes que iniciar sesión')

const sinPermiso = (mensaje: string) => new ErrorApi(403, 'sin_permiso', mensaje)

const comprobarRol = (rolUsuario: Rol, minimo: Rol) => {
  if (!rolAlcanza(rolUsuario, minimo)) {
    throw sinPermiso(
      `Tu rol (${rolUsuario}) no permite esta acción: se necesita ${minimo} o superior`,
    )
  }
}

// Sesión de Better Auth de la petición; la deja en el contexto y devuelve el id del usuario
async function cargarSesion<E extends EnvSesion>(c: Context<E>) {
  const sesion = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!sesion) throw noAutenticado()
  const contexto = c as unknown as Context<EnvSesion>
  contexto.set('usuario', sesion.user)
  contexto.set('sesion', sesion.session)
  return sesion.user.id
}

// Solo exige sesión (401 si no la hay)
export const requireSesion = (): MiddlewareHandler<EnvSesion> => async (c, next) => {
  await cargarSesion(c)
  await next()
}

// Rutas /plantillas/:id/...: 404 si la plantilla no existe, 403 si el usuario no tiene acceso o su
// rol no alcanza el mínimo
export const requireRol =
  (minimo: Rol, parametro = 'id'): MiddlewareHandler<EnvPlantilla> =>
  async (c, next) => {
    const usuarioId = await cargarSesion(c)
    const plantillaId = c.req.param(parametro) ?? ''
    if (!UUID.test(plantillaId)) throw new ErrorApi(404, 'no_encontrado', 'No existe la plantilla')

    // Una sola consulta: la plantilla, el rol del usuario en ella, si administra su club y su ficha de jugador
    const [fila] = await db
      .select({
        id: plantillas.id,
        clubId: plantillas.clubId,
        nombre: plantillas.nombre,
        temporada: plantillas.temporada,
        rolMembresia: membresias.rol,
        adminClub: adminsClub.usuarioId,
        jugadorId: jugadores.id,
      })
      .from(plantillas)
      .leftJoin(
        membresias,
        and(eq(membresias.plantillaId, plantillas.id), eq(membresias.usuarioId, usuarioId)),
      )
      .leftJoin(
        adminsClub,
        and(eq(adminsClub.clubId, plantillas.clubId), eq(adminsClub.usuarioId, usuarioId)),
      )
      .leftJoin(
        jugadores,
        and(eq(jugadores.clubId, plantillas.clubId), eq(jugadores.usuarioId, usuarioId)),
      )
      .where(eq(plantillas.id, plantillaId))

    if (!fila) throw new ErrorApi(404, 'no_encontrado', 'No existe la plantilla')

    const esAdminClub = fila.adminClub !== null
    const rolEfectivo = esAdminClub ? 'admin' : fila.rolMembresia
    if (!rolEfectivo) throw sinPermiso('No tienes acceso a esta plantilla')
    comprobarRol(rolEfectivo, minimo)

    c.set('plantilla', {
      id: fila.id,
      clubId: fila.clubId,
      nombre: fila.nombre,
      temporada: fila.temporada,
    })
    c.set('rol', rolEfectivo)
    c.set('esAdminClub', esAdminClub)
    c.set('jugadorId', fila.jugadorId)
    await next()
  }

async function cargarAccesoClub(c: Context<EnvClub>, parametro: string) {
  const usuarioId = await cargarSesion(c)
  const clubId = c.req.param(parametro) ?? ''
  if (!UUID.test(clubId)) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')

  const [club] = await db
    .select({
      id: clubes.id,
      nombre: clubes.nombre,
      adminClub: adminsClub.usuarioId,
      jugadorId: jugadores.id,
    })
    .from(clubes)
    .leftJoin(
      adminsClub,
      and(eq(adminsClub.clubId, clubes.id), eq(adminsClub.usuarioId, usuarioId)),
    )
    .leftJoin(jugadores, and(eq(jugadores.clubId, clubes.id), eq(jugadores.usuarioId, usuarioId)))
    .where(eq(clubes.id, clubId))
  if (!club) throw new ErrorApi(404, 'no_encontrado', 'No existe el club')

  // Rol más alto del usuario en cualquier plantilla del club, de cualquier temporada
  const roles = await db
    .select({ rol: membresias.rol })
    .from(membresias)
    .innerJoin(plantillas, eq(plantillas.id, membresias.plantillaId))
    .where(and(eq(plantillas.clubId, clubId), eq(membresias.usuarioId, usuarioId)))

  const esAdminClub = club.adminClub !== null
  const rolEfectivo = esAdminClub ? 'admin' : rolMayor(roles.map((r) => r.rol))

  c.set('club', { id: club.id, nombre: club.nombre })
  c.set('esAdminClub', esAdminClub)
  c.set('jugadorId', club.jugadorId)
  return rolEfectivo
}

// Rutas /clubes/:cid/... que solo pueden usar los administradores del club
export const requireAdminClub =
  (parametro = 'cid'): MiddlewareHandler<EnvClub> =>
  async (c, next) => {
    const rolEfectivo = await cargarAccesoClub(c, parametro)
    if (!c.var.esAdminClub) {
      throw sinPermiso(
        rolEfectivo
          ? 'Solo los administradores del club pueden hacer esto'
          : 'No tienes acceso a este club',
      )
    }
    c.set('rol', 'admin')
    await next()
  }

// Rutas /clubes/:cid/... para cualquiera con un rol mínimo en alguna plantilla del club (biblioteca de
// ejercicios, jugadores del club). El rol es el más alto que tenga en el club.
export const requireRolEnClub =
  (minimo: Rol, parametro = 'cid'): MiddlewareHandler<EnvClub> =>
  async (c, next) => {
    const rolEfectivo = await cargarAccesoClub(c, parametro)
    if (!rolEfectivo) throw sinPermiso('No tienes acceso a este club')
    comprobarRol(rolEfectivo, minimo)
    c.set('rol', rolEfectivo)
    await next()
  }
