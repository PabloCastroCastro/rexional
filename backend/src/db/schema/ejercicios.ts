import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth.js'
import { clubes } from './clubes.js'
import { actualizadoEn, creadoEn, id } from './comun.js'
import { entrenos } from './entrenos.js'

// Planificación de entrenos (secciones 2.8 y 6, ciclo 7): la biblioteca de ejercicios del club con
// sus fotos, vídeos y enlaces, el plan de cada entreno (lista ordenada de ejercicios) y los modelos
// de sesión, que son del club como la biblioteca. Que un ejercicio de un plan sea del mismo club que
// el entreno se comprueba en el servicio.

export const categoriaEjercicio = pgEnum('categoria_ejercicio', [
  'calentamiento',
  'tecnica',
  'tactica',
  'fisico',
  'finalizacion',
  'porteros',
  'partido',
  'vuelta_calma',
])

const creadoPor = () => uuid('creado_por').references(() => user.id, { onDelete: 'set null' })

export const ejercicios = pgTable(
  'ejercicios',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    descripcion: text('descripcion'),
    categoria: categoriaEjercicio('categoria'),
    // Orientativa: en cada sesión se puede poner otra
    duracionMin: smallint('duracion_min'),
    // Texto libre: "8-12", "2 porteros y 10 de campo"…
    jugadores: text('jugadores'),
    material: text('material'),
    etiquetas: text('etiquetas').array().notNull().default(sql`'{}'::text[]`),
    // Un ejercicio usado en algún plan no se borra: se archiva
    archivado: boolean('archivado').notNull().default(false),
    creadoPor: creadoPor(),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [
    index('ejercicios_club_idx').on(t.clubId),
    check('ejercicios_nombre_no_vacio', sql`btrim(${t.nombre}) <> ''`),
    check('ejercicios_duracion_valida', sql`${t.duracionMin} BETWEEN 1 AND 240`),
  ],
)

export const tipoMedio = pgEnum('tipo_medio', ['foto', 'video', 'enlace'])
// Un vídeo del iPhone se recodifica en segundo plano: mientras tanto, «procesando»
export const estadoMedio = pgEnum('estado_medio', ['listo', 'procesando', 'error'])

export const ejercicioMedios = pgTable(
  'ejercicio_medios',
  {
    id: id(),
    ejercicioId: uuid('ejercicio_id')
      .notNull()
      .references(() => ejercicios.id, { onDelete: 'cascade' }),
    tipo: tipoMedio('tipo').notNull(),
    estado: estadoMedio('estado').notNull().default('listo'),
    // Rutas dentro del volumen de subidas, con nombres generados (nunca el nombre original)
    archivo: text('archivo'),
    miniatura: text('miniatura'),
    // Solo los enlaces (por ejemplo, un vídeo de YouTube)
    url: text('url'),
    // Tipo real, comprobado con el contenido del archivo
    mime: text('mime'),
    tamanoBytes: bigint('tamano_bytes', { mode: 'number' }),
    duracionSeg: integer('duracion_seg'),
    pie: text('pie'),
    orden: smallint('orden').notNull(),
    createdAt: creadoEn(),
  },
  (t) => [
    index('ejercicio_medios_ejercicio_idx').on(t.ejercicioId),
    // Un enlace es una URL web y no tiene archivo; una foto o un vídeo, al revés
    check(
      'ejercicio_medios_tipo_coherente',
      sql`(${t.tipo} = 'enlace') = (${t.url} IS NOT NULL)
        AND (${t.tipo} = 'enlace') = (${t.archivo} IS NULL)`,
    ),
    check('ejercicio_medios_url_web', sql`${t.url} IS NULL OR ${t.url} ~* '^https?://'`),
    check(
      'ejercicio_medios_duracion_solo_video',
      sql`${t.duracionSeg} IS NULL OR ${t.tipo} = 'video'`,
    ),
  ],
)

// Ejercicios de una lista de sesión: el plan de un entreno o un modelo
const columnasLista = () => ({
  // Un ejercicio usado no se borra, se archiva. La clave es DEFERRABLE INITIALLY DEFERRED (añadido a
  // mano en la migración 0010: Drizzle no lo expresa): se comprueba al confirmar la transacción, así
  // que borrar el club entero, cuya cascada se lleva también los planes, sí se puede
  ejercicioId: uuid('ejercicio_id')
    .notNull()
    .references(() => ejercicios.id, { onDelete: 'no action' }),
  orden: smallint('orden').notNull(),
  // Puede diferir de la orientativa del ejercicio
  duracionMin: smallint('duracion_min'),
  indicaciones: text('indicaciones'),
})

export const entrenoEjercicios = pgTable(
  'entreno_ejercicios',
  {
    id: id(),
    entrenoId: uuid('entreno_id')
      .notNull()
      .references(() => entrenos.id, { onDelete: 'cascade' }),
    ...columnasLista(),
  },
  (t) => [
    unique('entreno_ejercicios_orden_unico').on(t.entrenoId, t.orden),
    index('entreno_ejercicios_ejercicio_idx').on(t.ejercicioId),
    check('entreno_ejercicios_duracion_valida', sql`${t.duracionMin} BETWEEN 1 AND 240`),
  ],
)

export const modelosSesion = pgTable(
  'modelos_sesion',
  {
    id: id(),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubes.id, { onDelete: 'cascade' }),
    nombre: text('nombre').notNull(),
    objetivo: text('objetivo'),
    notas: text('notas'),
    creadoPor: creadoPor(),
    createdAt: creadoEn(),
    updatedAt: actualizadoEn(),
  },
  (t) => [
    uniqueIndex('modelos_sesion_nombre_unico').on(t.clubId, sql`lower(${t.nombre})`),
    check('modelos_sesion_nombre_no_vacio', sql`btrim(${t.nombre}) <> ''`),
  ],
)

export const modeloEjercicios = pgTable(
  'modelo_ejercicios',
  {
    id: id(),
    modeloId: uuid('modelo_id')
      .notNull()
      .references(() => modelosSesion.id, { onDelete: 'cascade' }),
    ...columnasLista(),
  },
  (t) => [
    unique('modelo_ejercicios_orden_unico').on(t.modeloId, t.orden),
    index('modelo_ejercicios_ejercicio_idx').on(t.ejercicioId),
    check('modelo_ejercicios_duracion_valida', sql`${t.duracionMin} BETWEEN 1 AND 240`),
  ],
)
