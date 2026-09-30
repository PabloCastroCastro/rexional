import { type SQL, sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { creadoEn, id } from './comun.js'

// Club → plantillas (una categoría en una temporada) → fichas de sus jugadores (sección 6).

export const rol = pgEnum('rol', ['admin', 'entrenador', 'delegado', 'jugador'])

export const posicion = pgEnum('posicion', ['portero', 'defensa', 'centrocampista', 'delantero'])

const noVacio = (columna: AnyPgColumn): SQL => sql`btrim(${columna}) <> ''`

const colorHex = (columna: AnyPgColumn): SQL => sql`${columna} ~ '^#[0-9a-fA-F]{6}$'`

// Temporada AAAA-AA con años consecutivos (2026-27, 2099-00). CASE evita convertir a número
// un texto con otro formato.
const temporadaValida = (columna: AnyPgColumn): SQL => sql`CASE
  WHEN ${columna} ~ '^[0-9]{4}-[0-9]{2}$'
  THEN (left(${columna}, 4)::int + 1) % 100 = right(${columna}, 2)::int
  ELSE false
END`

const creadoPor = () => uuid('creado_por').references(() => user.id, { onDelete: 'set null' })

export const clubes = pgTable(
  'clubes',
  {
    id: id(),
    nombre: text('nombre').notNull(),
    escudo: text('escudo'),
    colorPrincipal: text('color_principal').notNull().default('#14553d'),
    colorSecundario: text('color_secundario').notNull().default('#f2c230'),
    creadoPor: creadoPor(),
    createdAt: creadoEn(),
  },
  (t) => [
    check('clubes_nombre_no_vacio', noVacio(t.nombre)),
    check('clubes_color_principal_hex', colorHex(t.colorPrincipal)),
    check('clubes_color_secundario_hex', colorHex(t.colorSecundario)),
  ],
)

export const adminsClub = pgTable(
  'admins_club',
  {
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.clubId, t.usuarioId] }),
    index('admins_club_usuario_idx').on(t.usuarioId),
  ],
)

export const plantillas = pgTable(
  'plantillas',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    categoria: text('categoria').notNull(),
    temporada: text('temporada').notNull(),
    plantillaAnteriorId: uuid('plantilla_anterior_id').references(
      (): AnyPgColumn => plantillas.id,
      {
        onDelete: 'set null',
      },
    ),
    creadoPor: creadoPor(),
    createdAt: creadoEn(),
  },
  (t) => [
    unique('plantillas_nombre_unico').on(t.clubId, t.nombre, t.temporada),
    // Destino de la clave foránea compuesta de fichas (mismo club y misma temporada)
    unique('plantillas_id_club_temporada').on(t.id, t.clubId, t.temporada),
    check('plantillas_nombre_no_vacio', noVacio(t.nombre)),
    check('plantillas_categoria_no_vacia', noVacio(t.categoria)),
    check('plantillas_temporada_valida', temporadaValida(t.temporada)),
    check('plantillas_anterior_distinta', sql`${t.plantillaAnteriorId} <> ${t.id}`),
  ],
)

export const membresias = pgTable(
  'membresias',
  {
    plantillaId: uuid('plantilla_id')
      .notNull()
      .references(() => plantillas.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    rol: rol('rol').notNull(),
    createdAt: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.plantillaId, t.usuarioId] }),
    index('membresias_usuario_idx').on(t.usuarioId),
  ],
)

// La persona: pertenece al club y es permanente
export const jugadores = pgTable(
  'jugadores',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    usuarioId: uuid('usuario_id').references(() => user.id, { onDelete: 'set null' }),
    nombre: text('nombre').notNull(),
    createdAt: creadoEn(),
  },
  (t) => [
    unique('jugadores_usuario_por_club').on(t.clubId, t.usuarioId),
    // Destino de la clave foránea compuesta de fichas (mismo club)
    unique('jugadores_id_club').on(t.id, t.clubId),
    check('jugadores_nombre_no_vacio', noVacio(t.nombre)),
  ],
)

// La participación de un jugador en una plantilla, es decir, en una temporada
export const fichas = pgTable(
  'fichas',
  {
    plantillaId: uuid('plantilla_id').notNull(),
    jugadorId: uuid('jugador_id').notNull(),
    clubId: uuid('club_id').notNull(),
    temporada: text('temporada').notNull(),
    dorsal: smallint('dorsal'),
    posicion: posicion('posicion'),
    activo: boolean('activo').notNull().default(true),
    createdAt: creadoEn(),
  },
  (t) => [
    primaryKey({ columns: [t.plantillaId, t.jugadorId] }),
    // Jugador y plantilla del mismo club, y la temporada de la ficha es la de su plantilla
    foreignKey({
      name: 'fichas_plantilla_fk',
      columns: [t.plantillaId, t.clubId, t.temporada],
      foreignColumns: [plantillas.id, plantillas.clubId, plantillas.temporada],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fichas_jugador_fk',
      columns: [t.jugadorId, t.clubId],
      foreignColumns: [jugadores.id, jugadores.clubId],
    }).onDelete('cascade'),
    unique('fichas_una_por_temporada').on(t.jugadorId, t.temporada),
    uniqueIndex('fichas_dorsal_unico_activos')
      .on(t.plantillaId, t.dorsal)
      .where(sql`${t.activo} AND ${t.dorsal} IS NOT NULL`),
    check('fichas_dorsal_rango', sql`${t.dorsal} BETWEEN 0 AND 99`),
  ],
)
