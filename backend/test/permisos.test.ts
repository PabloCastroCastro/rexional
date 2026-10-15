import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  adminsClub,
  clubes,
  jugadores,
  membresias,
  plantillas,
  user,
} from '../src/db/schema/index.js'
import {
  type Rol,
  requireAdminClub,
  requireRol,
  requireRolEnClub,
  requireSesion,
} from '../src/permisos.js'
import { crearUsuario, iniciarSesion } from './utilidades.js'

// Rutas de prueba protegidas con cada helper; devuelven lo que el middleware deja en el contexto
const app = crearApp()
const ROLES: Rol[] = ['jugador', 'delegado', 'entrenador', 'admin']
app.get('/sesion', requireSesion(), (c) => c.json({ email: c.var.usuario.email }))
for (const minimo of ROLES) {
  app.get(`/plantillas/:id/minimo-${minimo}`, requireRol(minimo), (c) =>
    c.json({
      rol: c.var.rol,
      esAdminClub: c.var.esAdminClub,
      jugadorId: c.var.jugadorId,
      plantilla: c.var.plantilla,
    }),
  )
  app.get(`/clubes/:cid/minimo-${minimo}`, requireRolEnClub(minimo), (c) =>
    c.json({ rol: c.var.rol, club: c.var.club.nombre }),
  )
}
app.get('/clubes/:cid/admin', requireAdminClub(), (c) =>
  c.json({ rol: c.var.rol, club: c.var.club.nombre }),
)

// Club A con Senior 2025-26, Senior 2026-27 y Juvenil 2026-27; club B con una plantilla
const ids = {
  clubA: '',
  clubB: '',
  senior25: '',
  senior26: '',
  juvenil26: '',
  plantillaB: '',
  jugador: '',
}
const cookies: Record<string, string> = {}
const usuarios: string[] = []

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  return u.id
}

beforeAll(async () => {
  const [clubA, clubB] = await db
    .insert(clubes)
    .values([{ nombre: 'Club A' }, { nombre: 'Club B' }])
    .returning()
  if (!clubA || !clubB) throw new Error('Sin clubes')
  ids.clubA = clubA.id
  ids.clubB = clubB.id
  const nuevas = await db
    .insert(plantillas)
    .values([
      { clubId: clubA.id, nombre: 'Senior', categoria: 'sénior', temporada: '2025-26' },
      { clubId: clubA.id, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
      { clubId: clubA.id, nombre: 'Juvenil', categoria: 'juvenil', temporada: '2026-27' },
      { clubId: clubB.id, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
    ])
    .returning()
  const [senior25, senior26, juvenil26, plantillaB] = nuevas.map((p) => p.id)
  if (!senior25 || !senior26 || !juvenil26 || !plantillaB) throw new Error('Sin plantillas')
  Object.assign(ids, { senior25, senior26, juvenil26, plantillaB })

  const adminClubA = await usuario('admin-club-a')
  const adminClubB = await usuario('admin-club-b')
  await db.insert(adminsClub).values([
    { clubId: ids.clubA, usuarioId: adminClubA },
    { clubId: ids.clubB, usuarioId: adminClubB },
  ])

  // Un usuario por rol en Senior 2026-27, y un entrenador que solo lo fue en 2025-26
  const enSenior26: [string, Rol][] = [
    ['admin-plantilla', 'admin'],
    ['entrenador', 'entrenador'],
    ['delegado', 'delegado'],
    ['jugador', 'jugador'],
  ]
  for (const [clave, rol] of enSenior26) {
    await db
      .insert(membresias)
      .values({ plantillaId: ids.senior26, usuarioId: await usuario(clave), rol })
  }
  await db.insert(membresias).values({
    plantillaId: ids.senior25,
    usuarioId: await usuario('entrenador-2025'),
    rol: 'entrenador',
  })
  await usuario('sin-relacion')

  // El usuario jugador está vinculado a su ficha de jugador del club
  const usuarioJugador = usuarios[5]
  const [jugador] = await db
    .insert(jugadores)
    .values({ clubId: ids.clubA, nombre: 'Jugador', usuarioId: usuarioJugador })
    .returning()
  ids.jugador = jugador?.id ?? ''
})

afterAll(async () => {
  await db.delete(clubes).where(inArray(clubes.id, [ids.clubA, ids.clubB]))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

const pedir = (ruta: string, quien?: string) =>
  app.request(`/api${ruta}`, { headers: quien ? { cookie: cookies[quien] ?? '' } : {} })

describe('requireSesion', () => {
  it('sin sesión: 401 con el formato de error común', async () => {
    const res = await pedir('/sesion')
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({
      error: { codigo: 'no_autenticado', mensaje: 'Tienes que iniciar sesión' },
    })
  })

  it('con sesión: deja el usuario en el contexto', async () => {
    const res = await pedir('/sesion', 'entrenador')
    expect(res.status).toBe(200)
    expect((await res.json()).email).toMatch(/^entrenador-/)
  })

  it('una cookie inventada no es una sesión', async () => {
    const res = await app.request('/api/sesion', {
      headers: { cookie: '__Secure-vestuario.session_token=falsa.firma' },
    })
    expect(res.status).toBe(401)
  })
})

describe('requireRol en /plantillas/:id', () => {
  // Rol de cada usuario en Senior 2026-27 → mínimos que alcanza
  const matriz: [string, Rol][] = [
    ['jugador', 'jugador'],
    ['delegado', 'delegado'],
    ['entrenador', 'entrenador'],
    ['admin-plantilla', 'admin'],
    ['admin-club-a', 'admin'],
  ]
  for (const [quien, rolEfectivo] of matriz) {
    for (const minimo of ROLES) {
      const alcanza = ROLES.indexOf(rolEfectivo) >= ROLES.indexOf(minimo)
      it(`${quien} con mínimo ${minimo}: ${alcanza ? '200' : '403'}`, async () => {
        const res = await pedir(`/plantillas/${ids.senior26}/minimo-${minimo}`, quien)
        expect(res.status).toBe(alcanza ? 200 : 403)
        const cuerpo = await res.json()
        if (alcanza) expect(cuerpo.rol).toBe(rolEfectivo)
        else expect(cuerpo.error.codigo).toBe('sin_permiso')
      })
    }
  }

  it('deja la plantilla y el jugador vinculado en el contexto', async () => {
    const res = await pedir(`/plantillas/${ids.senior26}/minimo-jugador`, 'jugador')
    expect(await res.json()).toEqual({
      rol: 'jugador',
      esAdminClub: false,
      jugadorId: ids.jugador,
      plantilla: { id: ids.senior26, clubId: ids.clubA, nombre: 'Senior', temporada: '2026-27' },
    })
  })

  it('el administrador del club es admin en todas sus plantillas, de cualquier temporada', async () => {
    for (const plantilla of [ids.senior25, ids.senior26, ids.juvenil26]) {
      const res = await pedir(`/plantillas/${plantilla}/minimo-admin`, 'admin-club-a')
      expect(res.status).toBe(200)
      expect((await res.json()).esAdminClub).toBe(true)
    }
  })

  it('un rol en una plantilla no da acceso a otra del mismo club ni a otra temporada', async () => {
    expect((await pedir(`/plantillas/${ids.juvenil26}/minimo-jugador`, 'entrenador')).status).toBe(
      403,
    )
    expect((await pedir(`/plantillas/${ids.senior25}/minimo-jugador`, 'entrenador')).status).toBe(
      403,
    )
    expect(
      (await pedir(`/plantillas/${ids.senior26}/minimo-jugador`, 'entrenador-2025')).status,
    ).toBe(403)
    expect(
      (await pedir(`/plantillas/${ids.senior25}/minimo-entrenador`, 'entrenador-2025')).status,
    ).toBe(200)
  })

  it('el administrador de otro club no tiene acceso', async () => {
    const res = await pedir(`/plantillas/${ids.senior26}/minimo-jugador`, 'admin-club-b')
    expect(res.status).toBe(403)
    expect((await res.json()).error.mensaje).toBe('No tienes acceso a esta plantilla')
  })

  it('un usuario sin relación: 403; sin sesión: 401', async () => {
    expect((await pedir(`/plantillas/${ids.senior26}/minimo-jugador`, 'sin-relacion')).status).toBe(
      403,
    )
    expect((await pedir(`/plantillas/${ids.senior26}/minimo-jugador`)).status).toBe(401)
  })

  it('plantilla inexistente o identificador mal formado: 404', async () => {
    for (const id of ['00000000-0000-7000-8000-000000000000', 'no-es-un-uuid', '1']) {
      const res = await pedir(`/plantillas/${id}/minimo-jugador`, 'admin-club-a')
      expect(res.status).toBe(404)
      expect((await res.json()).error.codigo).toBe('no_encontrado')
    }
  })
})

describe('rutas de club', () => {
  it('requireAdminClub: solo los administradores de ese club', async () => {
    const ok = await pedir(`/clubes/${ids.clubA}/admin`, 'admin-club-a')
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ rol: 'admin', club: 'Club A' })
    // Ser admin de una plantilla no es ser administrador del club
    for (const quien of ['admin-plantilla', 'entrenador', 'admin-club-b', 'sin-relacion']) {
      expect((await pedir(`/clubes/${ids.clubA}/admin`, quien)).status).toBe(403)
    }
    expect((await pedir(`/clubes/${ids.clubA}/admin`)).status).toBe(401)
  })

  it('requireRolEnClub: el rol más alto en cualquier plantilla del club, de cualquier temporada', async () => {
    const casos: [string, Rol, number][] = [
      ['jugador', 'jugador', 200],
      ['jugador', 'delegado', 403],
      ['delegado', 'delegado', 200],
      ['entrenador', 'entrenador', 200],
      ['entrenador-2025', 'entrenador', 200],
      ['admin-plantilla', 'admin', 200],
      ['admin-club-a', 'admin', 200],
      ['admin-club-b', 'jugador', 403],
      ['sin-relacion', 'jugador', 403],
    ]
    for (const [quien, minimo, estado] of casos) {
      const res = await pedir(`/clubes/${ids.clubA}/minimo-${minimo}`, quien)
      expect(res.status, `${quien} con mínimo ${minimo}`).toBe(estado)
    }
  })

  it('club inexistente o identificador mal formado: 404', async () => {
    expect(
      (await pedir('/clubes/00000000-0000-7000-8000-000000000000/admin', 'admin-club-a')).status,
    ).toBe(404)
    expect((await pedir('/clubes/otro/minimo-jugador', 'admin-club-a')).status).toBe(404)
  })
})
