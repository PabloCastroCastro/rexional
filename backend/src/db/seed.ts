import { hashPassword } from 'better-auth/crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { CATALOGO_POR_DEFECTO } from '../catalogoMultas.js'
import { config } from '../config.js'
import { db, pool } from './cliente.js'
import { migrar } from './migrar.js'
import {
  account,
  adminsClub,
  asistencias,
  clubes,
  convocados,
  entrenos,
  fichas,
  horarios,
  jugadores,
  membresias,
  motivosMulta,
  multas,
  partidos,
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
const ENTRENO = 6
const PARTIDO = 7
const MOTIVO = 8
const MULTA = 9

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

// Jugadores: [número, club, nombre y apellidos]
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

// Horario de las plantillas de 2026-27: martes y jueves de 20:00 a 21:30, del 1 de septiembre de 2026 al
// 15 de junio de 2027, con sus entrenos. Hay asistencia, variada pero siempre la misma, hasta el 8 de
// octubre; desde ahí quedan sin pasar lista: [plantilla, número, fecha]
const PLANTILLAS_CON_ENTRENOS = [3, 4, 5]
const HORARIO = {
  desde: '2026-09-01',
  hasta: '2027-06-15',
  sesiones: [
    { dia: 2, hora: '20:00', horaFin: '21:30' },
    { dia: 4, hora: '20:00', horaFin: '21:30' },
  ],
}
const ULTIMO_CON_ASISTENCIA = '2026-10-08'
const fechasEntreno: string[] = []
for (
  let dia = new Date(`${HORARIO.desde}T00:00:00Z`);
  dia <= new Date(`${HORARIO.hasta}T00:00:00Z`);
) {
  if (dia.getUTCDay() === 2 || dia.getUTCDay() === 4)
    fechasEntreno.push(dia.toISOString().slice(0, 10))
  dia = new Date(dia.getTime() + 86_400_000)
}
const listaEntrenos = PLANTILLAS_CON_ENTRENOS.flatMap((plantilla) =>
  fechasEntreno.map((fecha, i) => ({ plantilla, n: plantilla * 100 + i, i, fecha })),
)

const MOTIVOS = ['Trabajo', 'Lesión', null, 'Estudios']

// Estado de cada jugador activo en cada entreno: casi siempre asiste, a veces justifica o falta
const listaAsistencias = listaEntrenos
  .filter((e) => e.fecha <= ULTIMO_CON_ASISTENCIA)
  .flatMap((e) =>
    listaFichas
      .filter(([plantilla, , , , activo]) => plantilla === e.plantilla && activo)
      .map(([, jugador]) => {
        const v = (e.i * 7 + jugador * 13) % 20
        const estado = v < 15 ? 'asiste' : v < 17 ? 'justificada' : 'falta'
        return {
          entrenoId: sid(ENTRENO, e.n),
          jugadorId: sid(JUGADOR, jugador),
          plantillaId: sid(PLANTILLA, e.plantilla),
          estado: estado as 'asiste' | 'justificada' | 'falta',
          motivo: estado === 'justificada' ? MOTIVOS[(e.i + jugador) % MOTIVOS.length] : null,
        }
      }),
  )

// Partidos de liga de las plantillas de 2026-27, de septiembre a noviembre: el Senior y la UD Ejemplo
// los domingos a las 17:00, el Juvenil los sábados a las 12:00, alternando en casa y fuera. Los ya
// jugados (hasta el 11 de octubre) y el siguiente de cada plantilla tienen convocatoria.
const RIVALES = [
  'SD Compostela',
  'Bergantiños FC',
  'CD Lalín',
  'Arosa SC',
  'Céltiga FC',
  'UD Somozas',
  'CD Barco',
  'Silva SD',
  'Racing Villalbés',
  'CD Estradense',
  'Choco CF',
  'UD Ourense',
]
const ULTIMO_JUGADO = '2026-10-11'
const LIGAS = [
  {
    plantilla: 3,
    dia: 0,
    hora: '17:00',
    citacion: '16:00',
    competicion: 'Preferente',
    campo: 'Campo municipal de Rexional',
  },
  {
    plantilla: 4,
    dia: 6,
    hora: '12:00',
    citacion: '11:00',
    competicion: 'Liga Gallega Juvenil',
    campo: 'Campo municipal de Rexional',
  },
  {
    plantilla: 5,
    dia: 0,
    hora: '17:00',
    citacion: '16:15',
    competicion: 'Primera Futgal',
    campo: 'Campo de A Ponte',
  },
]
const listaPartidos = LIGAS.flatMap((liga) => {
  const fechas: string[] = []
  for (let dia = new Date('2026-09-12T00:00:00Z'); dia <= new Date('2026-11-29T00:00:00Z'); ) {
    if (dia.getUTCDay() === liga.dia) fechas.push(dia.toISOString().slice(0, 10))
    dia = new Date(dia.getTime() + 86_400_000)
  }
  return fechas.map((fecha, i) => {
    const rival = RIVALES[(i + liga.plantilla) % RIVALES.length] ?? 'Rival'
    const local = i % 2 === 0
    return {
      plantilla: liga.plantilla,
      n: liga.plantilla * 100 + i,
      i,
      fecha,
      rival,
      competicion: liga.competicion,
      hora: liga.hora,
      horaCitacion: liga.citacion,
      lugar: local ? liga.campo : `Campo del ${rival}`,
      local,
    }
  })
})

// Convocados: los jugadores activos de la plantilla salvo uno, que va rotando
const conConvocatoria = listaPartidos.filter(
  (p) =>
    p.fecha <= ULTIMO_JUGADO ||
    p.fecha ===
      listaPartidos.find((x) => x.plantilla === p.plantilla && x.fecha > ULTIMO_JUGADO)?.fecha,
)
const listaConvocados = conConvocatoria.flatMap((p) => {
  const activos = listaFichas.filter(
    ([plantilla, , , , activo]) => plantilla === p.plantilla && activo,
  )
  const descansa = activos[p.i % activos.length]?.[1]
  return activos
    .filter(([, jugador]) => jugador !== descansa)
    .map(([, jugador]) => ({
      partidoId: sid(PARTIDO, p.n),
      jugadorId: sid(JUGADOR, jugador),
      plantillaId: sid(PLANTILLA, p.plantilla),
    }))
})

// Catálogo de multas: el de por defecto en todas las plantillas y un motivo más en el Senior 2026-27
const listaMotivos = listaPlantillas.flatMap((p) => [
  ...CATALOGO_POR_DEFECTO.map((m, k) => ({ plantilla: p.n, n: p.n * 10 + k, ...m })),
  ...(p.n === 3
    ? [
        {
          plantilla: 3,
          n: 39,
          descripcion: 'Móvil en el vestuario',
          importeCentimos: 100,
          tipoTarjeta: null,
        },
      ]
    : []),
])

// Multas: [n, plantilla, jugador, motivo del catálogo o texto libre, céntimos, fecha, fecha de pago]
// El importe solo se indica en las de texto libre; las demás toman el del catálogo
const listaMultas: [number, number, number, string, number | null, string, string | null][] = [
  [1, 3, 2, 'Llegar tarde al entreno', null, '2026-09-15', '2026-09-20'],
  [2, 3, 5, 'Faltar sin avisar', null, '2026-09-22', null],
  [3, 3, 7, 'Tarjeta amarilla por protestar', null, '2026-09-27', null],
  [4, 3, 7, 'Llegar tarde al entreno', null, '2026-10-06', null],
  [5, 3, 9, 'Olvidar la equipación', null, '2026-10-01', '2026-10-01'],
  [6, 3, 3, 'Pinchar el balón del míster', 400, '2026-10-08', null],
  [7, 3, 1, 'Móvil en el vestuario', null, '2026-10-13', null],
  [8, 4, 21, 'Llegar tarde al entreno', null, '2026-09-17', '2026-09-24'],
  [9, 4, 26, 'Tarjeta roja', null, '2026-10-03', null],
  [10, 4, 27, 'Faltar sin avisar', null, '2026-10-08', null],
  // Pendiente de la temporada anterior: sigue en su plantilla
  [11, 1, 11, 'Faltar sin avisar', null, '2026-05-10', null],
  [12, 5, 42, 'Llegar tarde al entreno', null, '2026-09-20', '2026-09-27'],
]

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
      listaJugadores.map(([n, club, completo]) => {
        // Nombre y apellidos: la primera palabra es el nombre
        const [nombre = completo, ...apellidos] = completo.split(' ')
        return {
          id: sid(JUGADOR, n),
          clubId: sid(CLUB, club),
          nombre,
          apellidos: apellidos.join(' ') || null,
        }
      }),
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

  await tx
    .insert(entrenos)
    .values(
      listaEntrenos.map((e) => ({
        id: sid(ENTRENO, e.n),
        plantillaId: sid(PLANTILLA, e.plantilla),
        fecha: e.fecha,
        hora: '20:00',
        horaFin: '21:30',
        deHorario: true,
      })),
    )
    .onConflictDoNothing()

  await tx
    .insert(horarios)
    .values(PLANTILLAS_CON_ENTRENOS.map((n) => ({ plantillaId: sid(PLANTILLA, n), ...HORARIO })))
    .onConflictDoNothing()

  await tx.insert(asistencias).values(listaAsistencias).onConflictDoNothing()

  await tx
    .insert(partidos)
    .values(
      listaPartidos.map(({ plantilla, n, i: _i, ...partido }) => ({
        id: sid(PARTIDO, n),
        plantillaId: sid(PLANTILLA, plantilla),
        ...partido,
      })),
    )
    .onConflictDoNothing()

  await tx.insert(convocados).values(listaConvocados).onConflictDoNothing()

  await tx
    .insert(motivosMulta)
    .values(
      listaMotivos.map(({ plantilla, n, ...m }) => ({
        id: sid(MOTIVO, n),
        plantillaId: sid(PLANTILLA, plantilla),
        ...m,
      })),
    )
    .onConflictDoNothing()

  // El motivo de cada multa se busca por descripción: en una base ya migrada, el catálogo por
  // defecto lo creó la migración con otros identificadores
  const catalogo = await tx
    .select({
      id: motivosMulta.id,
      plantillaId: motivosMulta.plantillaId,
      descripcion: motivosMulta.descripcion,
      importeCentimos: motivosMulta.importeCentimos,
    })
    .from(motivosMulta)
    .where(
      and(
        inArray(
          motivosMulta.plantillaId,
          listaPlantillas.map((p) => sid(PLANTILLA, p.n)),
        ),
        eq(motivosMulta.activo, true),
      ),
    )
  await tx
    .insert(multas)
    .values(
      listaMultas.map(([n, plantilla, jugador, motivo, importe, fecha, fechaPago]) => {
        const delCatalogo = catalogo.find(
          (m) => m.plantillaId === sid(PLANTILLA, plantilla) && m.descripcion === motivo,
        )
        return {
          id: sid(MULTA, n),
          plantillaId: sid(PLANTILLA, plantilla),
          jugadorId: sid(JUGADOR, jugador),
          motivoId: delCatalogo?.id ?? null,
          motivo,
          importeCentimos: importe ?? delCatalogo?.importeCentimos ?? 100,
          fecha,
          fechaPago,
          creadaPor: sid(USUARIO, plantilla === 5 ? 3 : 1),
        }
      }),
    )
    .onConflictDoNothing()
})

console.log(
  `Seed aplicado: ${usuarios.length} usuarios (contraseña "${CONTRASENA}"), ${listaClubes.length} clubes, ` +
    `${listaPlantillas.length} plantillas, ${listaJugadores.length} jugadores, ${listaFichas.length} fichas, ` +
    `${listaEntrenos.length} entrenos, ${listaAsistencias.length} asistencias, ` +
    `${listaPartidos.length} partidos, ${listaConvocados.length} convocados y ${listaMultas.length} multas`,
)

await pool.end()
