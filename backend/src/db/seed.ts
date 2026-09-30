import { hashPassword } from 'better-auth/crypto'
import { config } from '../config.js'
import { db, pool } from './cliente.js'
import { migrar } from './migrar.js'
import {
  account,
  adminsClub,
  clubes,
  fichas,
  jugadores,
  membresias,
  plantillas,
  user,
} from './schema/index.js'

// Datos de ejemplo para desarrollo y pruebas (GH-3). Idempotente: usa identificadores fijos y no
// modifica lo que ya existe. Nunca se ejecuta en producción.
//
//   npm run db:seed                                        (desarrollo, fuera de Docker)
//   docker compose -f docker-compose.dev.yml exec backend npm run db:seed
//   docker compose exec backend node dist/db/seed.js       (entorno de pruebas del servidor)

const CONTRASENA = 'vestuario-dev'

if (config.entorno !== 'desarrollo' && config.entorno !== 'pruebas') {
  console.error(
    `El seed solo se ejecuta con ENTORNO=desarrollo o pruebas (ENTORNO=${config.entorno})`,
  )
  process.exit(1)
}

// Identificador fijo por tipo de dato y número, con formato de UUID v7
const sid = (tipo: number, n: number) =>
  `00000000-0000-7000-8${tipo.toString(16).padStart(3, '0')}-${n.toString(16).padStart(12, '0')}`

const USUARIO = 1
const CUENTA = 2
const CLUB = 3
const PLANTILLA = 4
const JUGADOR = 5

type Posicion = 'portero' | 'defensa' | 'centrocampista' | 'delantero'

const usuarios = [
  { n: 1, name: 'Ana Administradora', email: 'admin@rexional.test' },
  { n: 2, name: 'Tomás Entrenador', email: 'entrenador@rexional.test' },
  { n: 3, name: 'Olga Outeiro', email: 'admin@ejemplo.test' },
]

const listaClubes = [
  { n: 1, nombre: 'CD Rexional' },
  { n: 2, nombre: 'UD Ejemplo', colorPrincipal: '#1d3a8a', colorSecundario: '#ffffff' },
]

// Temporadas 2025-26 y 2026-27 del CD Rexional (cada plantilla de 2026-27 enlaza con su anterior)
// y una plantilla de la UD Ejemplo
const listaPlantillas = [
  { n: 1, club: 1, nombre: 'Senior', categoria: 'sénior', temporada: '2025-26' },
  { n: 2, club: 1, nombre: 'Juvenil', categoria: 'juvenil', temporada: '2025-26' },
  { n: 3, club: 1, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27', anterior: 1 },
  { n: 4, club: 1, nombre: 'Juvenil', categoria: 'juvenil', temporada: '2026-27', anterior: 2 },
  { n: 5, club: 2, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
]

// Jugadores: [número, club, nombre]
const listaJugadores: [number, number, string][] = [
  [1, 1, 'Brais Iglesias'],
  [2, 1, 'Xoán Rodríguez'],
  [3, 1, 'Pablo Fernández'],
  [4, 1, 'Iago Castro'],
  [5, 1, 'Martín Otero'],
  [6, 1, 'Hugo Vázquez'],
  [7, 1, 'Diego Pereira'],
  [8, 1, 'Adrián Lorenzo'],
  [9, 1, 'Manuel Rey'],
  [10, 1, 'Sergio Alonso'],
  [11, 1, 'Anxo Domínguez'],
  [12, 1, 'Roi Fraga'],
  [21, 1, 'Lucas Barreiro'],
  [22, 1, 'Mateo Souto'],
  [23, 1, 'Daniel Piñeiro'],
  [24, 1, 'Álex Varela'],
  [25, 1, 'Nicolás Seoane'],
  [26, 1, 'Marcos Freire'],
  [27, 1, 'Iker Sanmartín'],
  [28, 1, 'Leo Bouzas'],
  [29, 1, 'Enzo Ferreiro'],
  [30, 1, 'Gael Carballo'],
  [41, 2, 'Javier Núñez'],
  [42, 2, 'Rubén Gil'],
  [43, 2, 'Óscar Mariño'],
  [44, 2, 'Víctor Rial'],
  [45, 2, 'Andrés Cid'],
  [46, 2, 'Raúl Lema'],
]

// Fichas: [plantilla, jugador, dorsal, posición, activo]
const listaFichas: [number, number, number | null, Posicion, boolean][] = [
  // Senior 2025-26
  [1, 1, 1, 'portero', true],
  [1, 2, 2, 'defensa', true],
  [1, 3, 3, 'defensa', true],
  [1, 4, 4, 'defensa', true],
  [1, 5, 5, 'defensa', true],
  [1, 6, 6, 'centrocampista', true],
  [1, 7, 7, 'centrocampista', true],
  [1, 8, 8, 'centrocampista', true],
  [1, 9, 9, 'delantero', true],
  [1, 10, 10, 'delantero', true],
  [1, 11, 11, 'delantero', true],
  // Juvenil 2025-26
  [2, 21, 1, 'portero', true],
  [2, 22, 2, 'defensa', true],
  [2, 23, 3, 'defensa', true],
  [2, 24, 6, 'centrocampista', true],
  [2, 25, 8, 'centrocampista', true],
  [2, 26, 9, 'delantero', true],
  [2, 27, 10, 'delantero', true],
  [2, 28, 11, 'delantero', true],
  // Senior 2026-27: continúan 1 a 10 (11 no continúa, 10 causa baja), sube Mateo del Juvenil y llega Roi
  [3, 1, 1, 'portero', true],
  [3, 2, 2, 'defensa', true],
  [3, 3, 3, 'defensa', true],
  [3, 4, 4, 'defensa', true],
  [3, 5, 5, 'defensa', true],
  [3, 6, 6, 'centrocampista', true],
  [3, 7, 7, 'centrocampista', true],
  [3, 8, 8, 'centrocampista', true],
  [3, 9, 9, 'delantero', true],
  [3, 10, 10, 'delantero', false],
  [3, 22, 14, 'defensa', true],
  [3, 12, 11, 'delantero', true],
  // Juvenil 2026-27: continúan todos salvo Mateo, y llegan dos jugadores nuevos
  [4, 21, 1, 'portero', true],
  [4, 23, 3, 'defensa', true],
  [4, 24, 6, 'centrocampista', true],
  [4, 25, 8, 'centrocampista', true],
  [4, 26, 9, 'delantero', true],
  [4, 27, 10, 'delantero', true],
  [4, 28, 11, 'delantero', true],
  [4, 29, 2, 'defensa', true],
  [4, 30, null, 'centrocampista', true],
  // UD Ejemplo, Senior 2026-27
  [5, 41, 1, 'portero', true],
  [5, 42, 4, 'defensa', true],
  [5, 43, 5, 'defensa', true],
  [5, 44, 8, 'centrocampista', true],
  [5, 45, 10, 'centrocampista', true],
  [5, 46, 9, 'delantero', true],
]

const plantillaPorNumero = new Map(listaPlantillas.map((p) => [p.n, p]))

await migrar()

const hash = await hashPassword(CONTRASENA)

await db.transaction(async (tx) => {
  await tx
    .insert(user)
    .values(
      usuarios.map((u) => ({
        id: sid(USUARIO, u.n),
        name: u.name,
        email: u.email,
        emailVerified: true,
      })),
    )
    .onConflictDoNothing()

  // Cuenta de email y contraseña de Better Auth
  await tx
    .insert(account)
    .values(
      usuarios.map((u) => ({
        id: sid(CUENTA, u.n),
        accountId: sid(USUARIO, u.n),
        providerId: 'credential',
        userId: sid(USUARIO, u.n),
        password: hash,
      })),
    )
    .onConflictDoNothing()

  await tx
    .insert(clubes)
    .values(
      listaClubes.map(({ n, ...c }) => ({
        id: sid(CLUB, n),
        creadoPor: sid(USUARIO, n === 1 ? 1 : 3),
        ...c,
      })),
    )
    .onConflictDoNothing()

  await tx
    .insert(adminsClub)
    .values([
      { clubId: sid(CLUB, 1), usuarioId: sid(USUARIO, 1) },
      { clubId: sid(CLUB, 2), usuarioId: sid(USUARIO, 3) },
    ])
    .onConflictDoNothing()

  await tx
    .insert(plantillas)
    .values(
      listaPlantillas.map((p) => ({
        id: sid(PLANTILLA, p.n),
        clubId: sid(CLUB, p.club),
        nombre: p.nombre,
        categoria: p.categoria,
        temporada: p.temporada,
        plantillaAnteriorId: p.anterior ? sid(PLANTILLA, p.anterior) : null,
        creadoPor: sid(USUARIO, p.club === 1 ? 1 : 3),
      })),
    )
    .onConflictDoNothing()

  // Tomás entrena al Juvenil en 2025-26 y pasa al Senior en 2026-27
  await tx
    .insert(membresias)
    .values([
      { plantillaId: sid(PLANTILLA, 2), usuarioId: sid(USUARIO, 2), rol: 'entrenador' as const },
      { plantillaId: sid(PLANTILLA, 3), usuarioId: sid(USUARIO, 2), rol: 'entrenador' as const },
    ])
    .onConflictDoNothing()

  await tx
    .insert(jugadores)
    .values(
      listaJugadores.map(([n, club, nombre]) => ({
        id: sid(JUGADOR, n),
        clubId: sid(CLUB, club),
        nombre,
      })),
    )
    .onConflictDoNothing()

  await tx
    .insert(fichas)
    .values(
      listaFichas.map(([plantilla, jugador, dorsal, posicion, activo]) => {
        const p = plantillaPorNumero.get(plantilla)
        if (!p) throw new Error(`Plantilla ${plantilla} inexistente en el seed`)
        return {
          plantillaId: sid(PLANTILLA, plantilla),
          jugadorId: sid(JUGADOR, jugador),
          clubId: sid(CLUB, p.club),
          temporada: p.temporada,
          dorsal,
          posicion,
          activo,
        }
      }),
    )
    .onConflictDoNothing()
})

console.log(
  `Seed aplicado: ${usuarios.length} usuarios (contraseña "${CONTRASENA}"), ${listaClubes.length} clubes, ` +
    `${listaPlantillas.length} plantillas, ${listaJugadores.length} jugadores y ${listaFichas.length} fichas`,
)

await pool.end()
