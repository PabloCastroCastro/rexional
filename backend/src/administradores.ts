import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { auth, LONGITUD_MINIMA_CONTRASENA } from './auth.js'
import { db } from './db/cliente.js'
import { account, adminsClub, clubes, user } from './db/schema/index.js'

// Alta de un usuario como administrador de un club nuevo, en una sola transacción. La usa el
// comando crear-admin para el primer acceso desde el servidor (el registro público está desactivado).

export const DatosAdministrador = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Email no válido')),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio'),
  club: z.string().trim().min(1, 'El nombre del club es obligatorio'),
  contrasena: z
    .string()
    .min(
      LONGITUD_MINIMA_CONTRASENA,
      `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres`,
    ),
})

export type DatosAdministrador = z.input<typeof DatosAdministrador>

export class ErrorAdministrador extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ErrorAdministrador'
  }
}

export async function crearAdministrador(entrada: DatosAdministrador) {
  const r = DatosAdministrador.safeParse(entrada)
  if (!r.success) throw new ErrorAdministrador(r.error.issues.map((i) => i.message).join('. '))
  const datos = r.data

  // El mismo algoritmo y parámetros con los que Better Auth comprobará la contraseña al iniciar sesión
  const hash = await (await auth.$context).password.hash(datos.contrasena)

  return db.transaction(async (tx) => {
    const existente = await tx.select({ id: user.id }).from(user).where(eq(user.email, datos.email))
    if (existente.length > 0)
      throw new ErrorAdministrador(`Ya existe un usuario con el email ${datos.email}`)

    const [usuario] = await tx
      .insert(user)
      .values({ name: datos.nombre, email: datos.email, emailVerified: true })
      .returning()
    if (!usuario) throw new Error('No se pudo crear el usuario')

    await tx.insert(account).values({
      accountId: usuario.id,
      providerId: 'credential',
      userId: usuario.id,
      password: hash,
    })

    const [club] = await tx
      .insert(clubes)
      .values({ nombre: datos.club, creadoPor: usuario.id })
      .returning()
    if (!club) throw new Error('No se pudo crear el club')

    await tx.insert(adminsClub).values({ clubId: club.id, usuarioId: usuario.id })

    return { usuario, club }
  })
}
