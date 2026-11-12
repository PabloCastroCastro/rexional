import { readFileSync } from 'node:fs'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearApp } from '../src/app.js'
import { db, pool } from '../src/db/cliente.js'
import {
  adminsClub,
  asistencias,
  clubes,
  ejercicioMedios,
  ejercicios,
  entrenos,
  fichas,
  jugadores,
  membresias,
  multas,
  plantillas,
  user,
} from '../src/db/schema/index.js'
import { type Rol, rolAlcanza } from '../src/permisos.js'
import { crearUsuario, iniciarSesion, ORIGEN } from './utilidades.js'

// Matriz de permisos (GH-53): cada ruta de la API frente a la tabla de la sección 3, con un usuario
// por rol. Las escrituras van con un cuerpo no válido o con un identificador que no existe: quien
// tiene permiso recibe un 400 o un 404 (la validación va después del permiso) y nada se modifica.

const app = crearApp()

// --- Filas de la tabla de la sección 3, con el rol mínimo de cada una ---

type Minimo = Rol | 'adminClub'

const FILAS = {
  ver: { texto: 'Ver plantilla, partidos, convocatorias, catálogo de multas', minimo: 'jugador' },
  gestionar: {
    texto: 'Gestionar jugadores de la plantilla, entrenos, partidos y convocatorias',
    minimo: 'delegado',
  },
  verDatos: {
    texto: 'Ver asistencias, multas y estadísticas (el jugador, solo las suyas)',
    minimo: 'jugador',
  },
  verTodos: {
    texto: 'Ver asistencias, multas y estadísticas de todos: caja, informes y exportación',
    minimo: 'delegado',
  },
  multas: { texto: 'Registrar y cobrar multas, editar catálogo', minimo: 'delegado' },
  estadisticas: { texto: 'Registrar estadísticas de partido', minimo: 'delegado' },
  responder: {
    texto: 'Responder si va a un entreno (el jugador, solo la suya; GH-204)',
    minimo: 'jugador',
  },
  verEjercicios: { texto: 'Ver ejercicios y sesiones planificadas', minimo: 'jugador' },
  biblioteca: {
    texto: 'Gestionar biblioteca de ejercicios, medios y planificación',
    minimo: 'delegado',
  },
  datosPlantilla: {
    texto: 'Editar datos de la plantilla (nombre, categoría)',
    minimo: 'entrenador',
  },
  accesos: { texto: 'Invitar, cambiar roles y revocar accesos', minimo: 'admin' },
  club: {
    texto: 'Crear y borrar plantillas; identidad del club; administradores del club',
    minimo: 'adminClub',
  },
} satisfies Record<string, { texto: string; minimo: Minimo }>

type Fila = keyof typeof FILAS
type Ruta = [fila: Fila, metodo: string, ruta: string, cuerpo?: unknown]

// {id} es el Senior 2026-27 del club A, {cid} el club A y {jid} el jugador vinculado al usuario
// jugador; el resto de identificadores no existen
const MATRIZ: Ruta[] = [
  // Plantilla y club
  ['ver', 'GET', '/plantillas/{id}'],
  ['datosPlantilla', 'PATCH', '/plantillas/{id}'],
  ['club', 'DELETE', '/plantillas/{id}', { confirmacion: 'otro nombre' }],
  ['ver', 'GET', '/clubes/{cid}'],
  ['club', 'PATCH', '/clubes/{cid}'],
  ['club', 'PUT', '/clubes/{cid}/escudo'],
  ['club', 'DELETE', '/clubes/{cid}/escudo'],
  ['ver', 'GET', '/clubes/{cid}/escudo'],
  ['club', 'GET', '/clubes/{cid}/admins'],
  ['club', 'DELETE', '/clubes/{cid}/admins/{uid}'],

  // Jugadores
  ['ver', 'GET', '/plantillas/{id}/jugadores'],
  ['gestionar', 'GET', '/plantillas/{id}/invitables'],
  ['gestionar', 'POST', '/plantillas/{id}/jugadores'],
  ['gestionar', 'POST', '/plantillas/{id}/jugadores/lote'],
  ['gestionar', 'PATCH', '/plantillas/{id}/jugadores/{otro}'],
  ['gestionar', 'GET', '/clubes/{cid}/jugadores'],
  ['verDatos', 'GET', '/clubes/{cid}/jugadores/{jid}'],
  ['gestionar', 'POST', '/clubes/{cid}/ficha-federacion'],

  // Entrenos y asistencia
  ['verDatos', 'GET', '/plantillas/{id}/horario'],
  ['gestionar', 'PUT', '/plantillas/{id}/horario'],
  ['gestionar', 'DELETE', '/plantillas/{id}/horario'],
  ['verDatos', 'GET', '/plantillas/{id}/entrenos'],
  ['gestionar', 'POST', '/plantillas/{id}/entrenos'],
  ['verDatos', 'GET', '/plantillas/{id}/entrenos/{otro}'],
  ['gestionar', 'PATCH', '/plantillas/{id}/entrenos/{otro}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/entrenos/{otro}'],
  ['gestionar', 'PUT', '/plantillas/{id}/entrenos/{otro}/asistencias'],
  ['verDatos', 'GET', '/plantillas/{id}/asistencia/resumen'],
  ['responder', 'PUT', '/plantillas/{id}/entrenos/{otro}/respuesta'],
  ['responder', 'DELETE', '/plantillas/{id}/entrenos/{otro}/respuesta'],
  ['gestionar', 'PUT', '/plantillas/{id}/entrenos/{otro}/respuestas/{jid}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/entrenos/{otro}/respuestas/{jid}'],
  ['gestionar', 'GET', '/plantillas/{id}/entrenos/{otro}/respuestas/mensaje'],

  // Partidos y convocatorias
  ['ver', 'GET', '/plantillas/{id}/partidos'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos'],
  ['ver', 'GET', '/plantillas/{id}/partidos/{otro}'],
  ['gestionar', 'PATCH', '/plantillas/{id}/partidos/{otro}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/partidos/{otro}'],
  ['gestionar', 'PUT', '/plantillas/{id}/partidos/{otro}/convocados'],
  ['ver', 'GET', '/plantillas/{id}/partidos/{otro}/mensaje'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos/calendario/leer'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos/calendario'],
  // Notas, archivos y vídeos del partido: material del cuerpo técnico
  ['gestionar', 'GET', '/plantillas/{id}/partidos/{otro}/notas'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos/{otro}/notas'],
  ['gestionar', 'PATCH', '/plantillas/{id}/partidos/{otro}/notas/{otro}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/partidos/{otro}/notas/{otro}'],
  ['gestionar', 'GET', '/plantillas/{id}/partidos/{otro}/archivos'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos/{otro}/archivos'],
  ['gestionar', 'GET', '/plantillas/{id}/partidos/{otro}/archivos/{otro}'],
  ['gestionar', 'PATCH', '/plantillas/{id}/partidos/{otro}/archivos/{otro}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/partidos/{otro}/archivos/{otro}'],
  ['gestionar', 'POST', '/plantillas/{id}/partidos/{otro}/videos'],
  ['gestionar', 'PATCH', '/plantillas/{id}/partidos/{otro}/videos/{otro}'],
  ['gestionar', 'DELETE', '/plantillas/{id}/partidos/{otro}/videos/{otro}'],

  // Estadísticas de partido y acta
  ['verDatos', 'GET', '/plantillas/{id}/estadisticas'],
  ['verDatos', 'GET', '/clubes/{cid}/jugadores/{jid}/estadisticas'],
  ['estadisticas', 'PUT', '/plantillas/{id}/partidos/{otro}/resultado'],
  ['estadisticas', 'DELETE', '/plantillas/{id}/partidos/{otro}/resultado'],
  ['estadisticas', 'PUT', '/plantillas/{id}/partidos/{otro}/participaciones'],
  ['estadisticas', 'POST', '/plantillas/{id}/partidos/{otro}/eventos'],
  ['estadisticas', 'POST', '/plantillas/{id}/partidos/{otro}/eventos/lote'],
  ['estadisticas', 'DELETE', '/plantillas/{id}/partidos/{otro}/eventos/{otro}'],
  ['ver', 'GET', '/plantillas/{id}/partidos/{otro}/acta'],
  ['estadisticas', 'POST', '/plantillas/{id}/partidos/{otro}/acta'],
  ['estadisticas', 'GET', '/plantillas/{id}/partidos/{otro}/acta/lectura'],
  ['estadisticas', 'DELETE', '/plantillas/{id}/partidos/{otro}/acta'],
  ['estadisticas', 'POST', '/plantillas/{id}/partidos/{otro}/acta/confirmar'],

  // Multas
  ['ver', 'GET', '/plantillas/{id}/motivos-multa'],
  ['multas', 'POST', '/plantillas/{id}/motivos-multa'],
  ['multas', 'PATCH', '/plantillas/{id}/motivos-multa/{otro}'],
  ['verDatos', 'GET', '/plantillas/{id}/multas'],
  ['multas', 'POST', '/plantillas/{id}/multas'],
  ['multas', 'PATCH', '/plantillas/{id}/multas/{otro}'],
  ['multas', 'DELETE', '/plantillas/{id}/multas/{otro}'],
  ['multas', 'POST', '/plantillas/{id}/jugadores/{otro}/saldar'],
  ['verTodos', 'GET', '/plantillas/{id}/multas/resumen'],
  ['verTodos', 'GET', '/plantillas/{id}/multas/informe.pdf'],
  ['verTodos', 'GET', '/plantillas/{id}/multas/mensaje'],
  ['verTodos', 'GET', '/plantillas/{id}/exportacion.xlsx'],

  // Biblioteca de ejercicios y planificación
  ['verEjercicios', 'GET', '/clubes/{cid}/ejercicios'],
  ['verEjercicios', 'GET', '/clubes/{cid}/ejercicios/etiquetas'],
  ['verEjercicios', 'GET', '/clubes/{cid}/ejercicios/{otro}'],
  ['biblioteca', 'POST', '/clubes/{cid}/ejercicios'],
  ['biblioteca', 'PATCH', '/clubes/{cid}/ejercicios/{otro}'],
  ['biblioteca', 'DELETE', '/clubes/{cid}/ejercicios/{otro}'],
  ['biblioteca', 'POST', '/clubes/{cid}/ejercicios/{otro}/duplicar'],
  ['biblioteca', 'POST', '/clubes/{cid}/ejercicios/{otro}/medios'],
  ['biblioteca', 'POST', '/clubes/{cid}/ejercicios/{otro}/medios/enlace'],
  ['biblioteca', 'PATCH', '/clubes/{cid}/ejercicios/{otro}/medios/{otro}'],
  ['biblioteca', 'DELETE', '/clubes/{cid}/ejercicios/{otro}/medios/{otro}'],
  ['biblioteca', 'PUT', '/clubes/{cid}/ejercicios/{otro}/medios/orden'],
  ['verEjercicios', 'GET', '/plantillas/{id}/entrenos/{otro}/plan'],
  ['verEjercicios', 'GET', '/plantillas/{id}/entrenos/{otro}/plan.pdf'],
  ['biblioteca', 'PUT', '/plantillas/{id}/entrenos/{otro}/plan'],
  ['biblioteca', 'POST', '/plantillas/{id}/entrenos/{otro}/plan/duplicar'],
  ['biblioteca', 'POST', '/plantillas/{id}/entrenos/{otro}/plan/guardar-modelo'],
  ['biblioteca', 'POST', '/plantillas/{id}/entrenos/{otro}/plan/desde-modelo/{otro}'],
  ['verEjercicios', 'GET', '/clubes/{cid}/modelos-sesion'],
  ['biblioteca', 'DELETE', '/clubes/{cid}/modelos-sesion/{otro}'],

  // Accesos
  ['accesos', 'GET', '/plantillas/{id}/miembros'],
  ['accesos', 'PATCH', '/plantillas/{id}/miembros/{uid}'],
  ['accesos', 'DELETE', '/plantillas/{id}/miembros/{uid}'],
  ['accesos', 'GET', '/plantillas/{id}/invitaciones'],
  ['accesos', 'POST', '/plantillas/{id}/invitaciones'],
  ['accesos', 'DELETE', '/plantillas/{id}/invitaciones/{otro}'],
  ['club', 'GET', '/clubes/{cid}/invitaciones'],
  ['club', 'POST', '/clubes/{cid}/invitaciones'],
  ['club', 'DELETE', '/clubes/{cid}/invitaciones/{otro}'],
]

// Rutas fuera de la tabla: de cualquier usuario con sesión (cada uno, con lo suyo) o públicas
const SOLO_SESION = [
  'GET /clubes',
  'POST /clubes',
  'GET /plantillas',
  'POST /plantillas',
  'GET /cuenta/sesiones',
  'DELETE /cuenta/sesiones/{id}',
  'POST /cuenta/sesiones/cerrar-otras',
  'GET /medios/limites',
  // Cada medio comprueba el club de su ejercicio (ver «datos de otros clubes»)
  'GET /medios/{mid}',
  'GET /medios/{mid}/miniatura',
]
const PUBLICAS = ['GET /health', 'POST /invitaciones/consultar', 'POST /invitaciones/aceptar']

// --- Usuarios: su nivel en el Senior 2026-27 y en el club A ---

type Nivel = Minimo | null
const ACTORES: Record<string, { plantilla: Nivel; club: Nivel }> = {
  'admin-club': { plantilla: 'adminClub', club: 'adminClub' },
  admin: { plantilla: 'admin', club: 'admin' },
  entrenador: { plantilla: 'entrenador', club: 'entrenador' },
  delegado: { plantilla: 'delegado', club: 'delegado' },
  jugador: { plantilla: 'jugador', club: 'jugador' },
  // Solo fue entrenador del Senior 2025-26: nada en la plantilla de esta temporada, pero en el
  // club cuenta su rol más alto de cualquier temporada
  'entrenador-2025': { plantilla: null, club: 'entrenador' },
  'admin-otro-club': { plantilla: null, club: null },
  'sin-relacion': { plantilla: null, club: null },
}

const permitido = (minimo: Minimo, nivel: Nivel) => {
  if (nivel === null) return false
  if (minimo === 'adminClub') return nivel === 'adminClub'
  return rolAlcanza(nivel === 'adminClub' ? 'admin' : nivel, minimo)
}

const NADA = '00000000-0000-7000-8000-000000000000'
const ids: Record<string, string> = {}
const cookies: Record<string, string> = {}
const usuarios: string[] = []

async function usuario(clave: string) {
  const u = await crearUsuario(clave)
  usuarios.push(u.id)
  cookies[clave] = await iniciarSesion(app, u.email)
  ids[clave] = u.id
  return u.id
}

function pedir(metodo: string, ruta: string, quien?: string, cuerpo?: unknown) {
  const headers: Record<string, string> = { origin: ORIGEN }
  if (quien) headers.cookie = cookies[quien] ?? ''
  if (cuerpo !== undefined) headers['content-type'] = 'application/json'
  return app.request(`/api${ruta}`, {
    method: metodo,
    headers,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}

const concreta = (ruta: string, plantilla = ids.senior26, club = ids.clubA) =>
  ruta
    .replace('{id}', plantilla ?? '')
    .replace('{cid}', club ?? '')
    .replace('{jid}', ids.jugadorPropio ?? '')
    .replaceAll('{otro}', NADA)
    .replace('{uid}', NADA)

const ficha = (plantillaId: string, jugadorId: string, temporada = '2026-27') => ({
  plantillaId,
  jugadorId,
  clubId: ids.clubA ?? '',
  temporada,
})

beforeAll(async () => {
  const [clubA, clubB] = await db
    .insert(clubes)
    .values([{ nombre: 'Club A' }, { nombre: 'Club B' }])
    .returning()
  ids.clubA = clubA?.id ?? ''
  ids.clubB = clubB?.id ?? ''
  const nuevas = await db
    .insert(plantillas)
    .values([
      { clubId: ids.clubA, nombre: 'Senior', categoria: 'sénior', temporada: '2025-26' },
      { clubId: ids.clubA, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
      { clubId: ids.clubA, nombre: 'Juvenil', categoria: 'juvenil', temporada: '2026-27' },
      { clubId: ids.clubB, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
    ])
    .returning()
  for (const [i, clave] of ['senior25', 'senior26', 'juvenil26', 'plantillaB'].entries()) {
    ids[clave] = nuevas[i]?.id ?? ''
  }

  await db.insert(adminsClub).values([
    { clubId: ids.clubA, usuarioId: await usuario('admin-club') },
    { clubId: ids.clubB, usuarioId: await usuario('admin-otro-club') },
  ])
  for (const rol of ['admin', 'entrenador', 'delegado', 'jugador'] as const) {
    await db
      .insert(membresias)
      .values({ plantillaId: ids.senior26 ?? '', usuarioId: await usuario(rol), rol })
  }
  await db.insert(membresias).values([
    {
      plantillaId: ids.senior25 ?? '',
      usuarioId: await usuario('entrenador-2025'),
      rol: 'entrenador',
    },
    // Jugador de la plantilla sin ficha vinculada a su cuenta
    {
      plantillaId: ids.senior26 ?? '',
      usuarioId: await usuario('jugador-sin-ficha'),
      rol: 'jugador',
    },
  ])
  await usuario('sin-relacion')

  // El usuario jugador es Brais; Zoe es otra jugadora de la plantilla
  const [brais, zoe] = await db
    .insert(jugadores)
    .values([
      { clubId: ids.clubA, nombre: 'Brais', usuarioId: ids.jugador ?? '' },
      { clubId: ids.clubA, nombre: 'Zoe' },
    ])
    .returning()
  ids.jugadorPropio = brais?.id ?? ''
  ids.otroJugador = zoe?.id ?? ''
  await db
    .insert(fichas)
    .values([
      ficha(ids.senior26 ?? '', ids.jugadorPropio),
      ficha(ids.senior26 ?? '', ids.otroJugador),
    ])
})

afterAll(async () => {
  await db.delete(clubes).where(inArray(clubes.id, [ids.clubA ?? '', ids.clubB ?? '']))
  await db.delete(user).where(inArray(user.id, usuarios))
  await pool.end()
})

describe('matriz de la sección 3', () => {
  for (const [clave, fila] of Object.entries(FILAS)) {
    const rutas = MATRIZ.filter(([f]) => f === clave)

    it(`${fila.texto}: ${rutas.length} rutas`, async () => {
      expect(rutas.length).toBeGreaterThan(0)
      const fallos: string[] = []
      for (const [, metodo, ruta, cuerpo] of rutas) {
        const real = concreta(ruta)
        const conCuerpo = metodo === 'GET' ? undefined : (cuerpo ?? {})
        const ambito = ruta.startsWith('/clubes/') ? 'club' : 'plantilla'
        for (const [quien, nivel] of Object.entries(ACTORES)) {
          const { status } = await pedir(metodo, real, quien, conCuerpo)
          const debe = permitido(fila.minimo, nivel[ambito])
          const bien = debe ? status !== 401 && status !== 403 && status < 500 : status === 403
          if (!bien)
            fallos.push(`${metodo} ${ruta} · ${quien}: ${status} (${debe ? 'permitido' : '403'})`)
        }
        const sinSesion = await pedir(metodo, real, undefined, conCuerpo)
        if (sinSesion.status !== 401)
          fallos.push(`${metodo} ${ruta} · sin sesión: ${sinSesion.status}`)
      }
      expect(fallos).toEqual([])
    })
  }

  it('cubre todas las rutas de la API', () => {
    const contrato = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'))
    const enContrato = Object.entries(contrato.paths as Record<string, object>)
      .flatMap(([ruta, metodos]) =>
        Object.keys(metodos).map((m) => `${m.toUpperCase()} ${ruta.replace(/^\/api/, '')}`),
      )
      .sort()
    // En la matriz, los parámetros tienen otros nombres: se comparan sin ellos
    const forma = (r: string) => r.replace(/\{[^}]+\}/g, '{}')
    const cubiertas = new Set(
      [...MATRIZ.map(([, m, r]) => `${m} ${r}`), ...SOLO_SESION, ...PUBLICAS].map(forma),
    )
    expect(enContrato.filter((r) => !cubiertas.has(forma(r)))).toEqual([])
    expect(MATRIZ.length + SOLO_SESION.length + PUBLICAS.length).toBe(enContrato.length)
  })

  it('las rutas solo con sesión piden sesión', async () => {
    for (const r of SOLO_SESION) {
      const [metodo = '', ruta = ''] = r.split(' ')
      const cuerpo = metodo === 'GET' ? undefined : {}
      const { status } = await pedir(metodo, ruta.replace(/\{[^}]+\}/g, NADA), undefined, cuerpo)
      expect(status, r).toBe(401)
    }
  })
})

describe('plantillas ajenas', () => {
  // Una muestra de lecturas y escrituras de plantilla con su rol mínimo
  const MUESTRA: [string, string, Rol][] = [
    ['GET', '/plantillas/{id}', 'jugador'],
    ['GET', '/plantillas/{id}/jugadores', 'jugador'],
    ['GET', '/plantillas/{id}/multas', 'jugador'],
    ['POST', '/plantillas/{id}/entrenos', 'delegado'],
    ['GET', '/plantillas/{id}/miembros', 'admin'],
  ]

  it('un rol en el Senior 2026-27 no da acceso a otra plantilla del club ni de otra temporada', async () => {
    for (const plantilla of [ids.juvenil26, ids.senior25]) {
      for (const [metodo, ruta] of MUESTRA) {
        for (const quien of ['admin', 'entrenador', 'delegado', 'jugador']) {
          const res = await pedir(
            metodo,
            concreta(ruta, plantilla),
            quien,
            metodo === 'GET' ? undefined : {},
          )
          expect(res.status, `${quien} ${metodo} ${ruta} en ${plantilla}`).toBe(403)
        }
      }
    }
  })

  it('el administrador del club es admin en todas sus plantillas, pero no en las de otro club', async () => {
    for (const [metodo, ruta] of MUESTRA) {
      const cuerpo = metodo === 'GET' ? undefined : {}
      for (const plantilla of [ids.senior25, ids.senior26, ids.juvenil26]) {
        const res = await pedir(metodo, concreta(ruta, plantilla), 'admin-club', cuerpo)
        expect([401, 403], `${metodo} ${ruta}`).not.toContain(res.status)
      }
      const ajena = await pedir(metodo, concreta(ruta, ids.plantillaB), 'admin-club', cuerpo)
      expect(ajena.status, `${metodo} ${ruta} en otro club`).toBe(403)
    }
  })

  it('nadie del club A entra en las rutas del club B', async () => {
    for (const ruta of ['/clubes/{cid}', '/clubes/{cid}/ejercicios', '/clubes/{cid}/admins']) {
      for (const quien of ['admin-club', 'admin', 'entrenador', 'jugador']) {
        const res = await pedir('GET', concreta(ruta, ids.senior26, ids.clubB), quien)
        expect(res.status, `${quien} ${ruta}`).toBe(403)
      }
    }
  })

  it('los medios de un ejercicio solo los ven los miembros de su club', async () => {
    const [ejercicio] = await db
      .insert(ejercicios)
      .values({ clubId: ids.clubA ?? '', nombre: 'Rondo' })
      .returning()
    const [medio] = await db
      .insert(ejercicioMedios)
      .values({
        ejercicioId: ejercicio?.id ?? '',
        tipo: 'enlace',
        url: 'https://ejemplo.test',
        orden: 0,
      })
      .returning()
    for (const ruta of [`/medios/${medio?.id}`, `/medios/${medio?.id}/miniatura`]) {
      // Un enlace no tiene archivo: el miembro llega hasta el 404
      for (const quien of ['jugador', 'entrenador-2025', 'admin-club']) {
        expect((await pedir('GET', ruta, quien)).status, `${quien} ${ruta}`).toBe(404)
      }
      for (const quien of ['admin-otro-club', 'sin-relacion']) {
        expect((await pedir('GET', ruta, quien)).status, `${quien} ${ruta}`).toBe(403)
      }
    }
  })
})

describe('datos de otro jugador', () => {
  beforeAll(async () => {
    const [entreno] = await db
      .insert(entrenos)
      .values({ plantillaId: ids.senior26 ?? '', fecha: '2026-10-01' })
      .returning()
    ids.entreno = entreno?.id ?? ''
    await db.insert(asistencias).values([
      {
        entrenoId: ids.entreno,
        plantillaId: ids.senior26 ?? '',
        jugadorId: ids.jugadorPropio ?? '',
        estado: 'asiste',
      },
      {
        entrenoId: ids.entreno,
        plantillaId: ids.senior26 ?? '',
        jugadorId: ids.otroJugador ?? '',
        estado: 'falta',
      },
    ])
    await db.insert(multas).values(
      [ids.jugadorPropio, ids.otroJugador].map((jugadorId) => ({
        plantillaId: ids.senior26 ?? '',
        jugadorId: jugadorId ?? '',
        motivo: 'Llegar tarde',
        importeCentimos: 200,
        fecha: '2026-10-01',
      })),
    )
  })

  const jugadoresDe = (filas: { jugadorId: string }[]) => filas.map((f) => f.jugadorId)

  it('su ficha y sus estadísticas, sí; las de otro jugador, no', async () => {
    const base = `/clubes/${ids.clubA}/jugadores`
    expect((await pedir('GET', `${base}/${ids.jugadorPropio}`, 'jugador')).status).toBe(200)
    expect(
      (await pedir('GET', `${base}/${ids.jugadorPropio}/estadisticas`, 'jugador')).status,
    ).toBe(200)
    expect((await pedir('GET', `${base}/${ids.otroJugador}`, 'jugador')).status).toBe(403)
    expect((await pedir('GET', `${base}/${ids.otroJugador}/estadisticas`, 'jugador')).status).toBe(
      403,
    )
    // El cuerpo técnico ve las de todos
    expect((await pedir('GET', `${base}/${ids.otroJugador}`, 'delegado')).status).toBe(200)
  })

  it('de asistencia, multas y estadísticas solo recibe lo suyo', async () => {
    const base = `/plantillas/${ids.senior26}`
    const entreno = await (await pedir('GET', `${base}/entrenos/${ids.entreno}`, 'jugador')).json()
    expect(jugadoresDe(entreno.jugadores)).toEqual([ids.jugadorPropio])
    // Los recuentos del entreno no identifican a nadie
    expect(entreno.recuentos).toEqual({ asiste: 1, justificada: 0, falta: 1 })

    const resumen = await (await pedir('GET', `${base}/asistencia/resumen`, 'jugador')).json()
    expect(jugadoresDe(resumen)).toEqual([ids.jugadorPropio])

    const suyas = await (await pedir('GET', `${base}/multas`, 'jugador')).json()
    expect(jugadoresDe(suyas)).toEqual([ids.jugadorPropio])
    // Pedir las de otro jugador no cambia nada
    const deOtro = await (
      await pedir('GET', `${base}/multas?jugador=${ids.otroJugador}`, 'jugador')
    ).json()
    expect(jugadoresDe(deOtro)).toEqual([ids.jugadorPropio])

    const estadisticas = await (await pedir('GET', `${base}/estadisticas`, 'jugador')).json()
    expect(
      estadisticas.jugadores.every((j: { jugadorId: string }) => j.jugadorId === ids.jugadorPropio),
    ).toBe(true)

    // Con el listado de entrenos llega solo su estado
    const lista = await (await pedir('GET', `${base}/entrenos`, 'jugador')).json()
    expect(lista.map((e: { miEstado: string | null }) => e.miEstado)).toEqual(['asiste'])
  })

  it('sin ficha vinculada a su cuenta, no recibe datos de nadie', async () => {
    const base = `/plantillas/${ids.senior26}`
    const entreno = await (
      await pedir('GET', `${base}/entrenos/${ids.entreno}`, 'jugador-sin-ficha')
    ).json()
    expect(entreno.jugadores).toEqual([])
    for (const ruta of ['/asistencia/resumen', '/multas']) {
      expect(
        await (await pedir('GET', `${base}${ruta}`, 'jugador-sin-ficha')).json(),
        ruta,
      ).toEqual([])
    }
    const plantilla = await (await pedir('GET', base, 'jugador-sin-ficha')).json()
    expect(plantilla.jugadorId).toBeNull()
  })
})

describe('club y temporada', () => {
  const nueva = (datos: Record<string, unknown>) => ({
    clubId: ids.clubA,
    nombre: 'Cadete',
    categoria: 'cadete',
    temporada: '2026-27',
    ...datos,
  })

  it('solo el administrador del club crea plantillas', async () => {
    for (const quien of ['admin', 'entrenador', 'jugador', 'admin-otro-club']) {
      expect((await pedir('POST', '/plantillas', quien, nueva({}))).status, quien).toBe(403)
    }
    expect((await pedir('POST', '/plantillas', 'admin-club', nueva({}))).status).toBe(201)
  })

  it('solo el administrador del club prepara la temporada siguiente', async () => {
    const siguiente = nueva({
      nombre: 'Senior',
      temporada: '2027-28',
      plantillaAnteriorId: ids.senior26,
    })
    for (const quien of ['admin', 'entrenador']) {
      expect((await pedir('POST', '/plantillas', quien, siguiente)).status, quien).toBe(403)
    }
    expect((await pedir('POST', '/plantillas', 'admin-club', siguiente)).status).toBe(201)
  })

  it('solo el administrador del club cambia su identidad y borra plantillas', async () => {
    for (const quien of ['admin', 'entrenador']) {
      expect((await pedir('PATCH', `/clubes/${ids.clubA}`, quien, { nombre: 'Otro' })).status).toBe(
        403,
      )
      // Su propia plantilla, con la confirmación correcta: ser admin de ella no basta
      const borrar = await pedir('DELETE', `/plantillas/${ids.senior26}`, quien, {
        confirmacion: 'Senior',
      })
      expect(borrar.status, quien).toBe(403)
    }
    expect(
      (await pedir('PATCH', `/clubes/${ids.clubA}`, 'admin-club', { nombre: 'Club A' })).status,
    ).toBe(200)
  })
})
