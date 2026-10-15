import { and, eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { db, pool } from '../src/db/cliente.js'
import {
  asistencias,
  clubes,
  entrenos,
  fichas,
  horarios,
  jugadores,
  plantillas,
} from '../src/db/schema/index.js'

// Reglas del modelo que garantiza la propia base de datos (sección 6). Cada caso se ejecuta en una
// transacción que se deshace, así que no deja datos.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

class Deshacer extends Error {}

async function enTransaccion(caso: (tx: Tx) => Promise<void>) {
  await db
    .transaction(async (tx) => {
      await caso(tx)
      throw new Deshacer()
    })
    .catch((error) => {
      if (!(error instanceof Deshacer)) throw error
    })
}

// Nombre de la restricción que ha rechazado la operación (Drizzle envuelve el error de PostgreSQL)
async function restriccionViolada(operacion: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await operacion
  } catch (error) {
    const e = error as { constraint?: string; cause?: { constraint?: string } }
    return e.cause?.constraint ?? e.constraint ?? `(error sin restricción: ${String(error)})`
  }
  return undefined
}

// Un club con Senior 2025-26 y Senior 2026-27 (enlazadas), dos jugadores y otro club con un jugador
async function base(tx: Tx) {
  const [club, otroClub] = await tx
    .insert(clubes)
    .values([{ nombre: 'Club de prueba' }, { nombre: 'Otro club' }])
    .returning()
  if (!club || !otroClub) throw new Error('Sin clubes')
  const [senior25] = await tx
    .insert(plantillas)
    .values({ clubId: club.id, nombre: 'Senior', categoria: 'sénior', temporada: '2025-26' })
    .returning()
  if (!senior25) throw new Error('Sin plantilla')
  const [senior26] = await tx
    .insert(plantillas)
    .values({
      clubId: club.id,
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: '2026-27',
      plantillaAnteriorId: senior25.id,
    })
    .returning()
  const [ana, berta, ajena] = await tx
    .insert(jugadores)
    .values([
      { clubId: club.id, nombre: 'Ana' },
      { clubId: club.id, nombre: 'Berta' },
      { clubId: otroClub.id, nombre: 'Jugadora de otro club' },
    ])
    .returning()
  if (!senior26 || !ana || !berta || !ajena) throw new Error('Datos incompletos')
  // Ana es la 7 en las dos temporadas
  await tx.insert(fichas).values([
    {
      plantillaId: senior25.id,
      jugadorId: ana.id,
      clubId: club.id,
      temporada: '2025-26',
      dorsal: 7,
    },
    {
      plantillaId: senior26.id,
      jugadorId: ana.id,
      clubId: club.id,
      temporada: '2026-27',
      dorsal: 7,
    },
  ])
  return { club, otroClub, senior25, senior26, ana, berta, ajena }
}

afterAll(async () => {
  await pool.end()
})

describe('fichas', () => {
  it('rechaza un dorsal repetido entre los activos de la plantilla', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.insert(fichas).values({
          plantillaId: b.senior26.id,
          jugadorId: b.berta.id,
          clubId: b.club.id,
          temporada: '2026-27',
          dorsal: 7,
        }),
      )
      expect(r).toBe('fichas_dorsal_unico_activos')
    }))

  it('permite reutilizar el dorsal de un jugador de baja', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      await tx
        .update(fichas)
        .set({ activo: false })
        .where(and(eq(fichas.plantillaId, b.senior26.id), eq(fichas.jugadorId, b.ana.id)))
      await tx.insert(fichas).values({
        plantillaId: b.senior26.id,
        jugadorId: b.berta.id,
        clubId: b.club.id,
        temporada: '2026-27',
        dorsal: 7,
      })
    }))

  it('rechaza un dorsal fuera de 0–99', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.insert(fichas).values({
          plantillaId: b.senior26.id,
          jugadorId: b.berta.id,
          clubId: b.club.id,
          temporada: '2026-27',
          dorsal: 100,
        }),
      )
      expect(r).toBe('fichas_dorsal_rango')
    }))

  it('rechaza una segunda ficha del jugador en la misma temporada', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const [juvenil] = await tx
        .insert(plantillas)
        .values({
          clubId: b.club.id,
          nombre: 'Juvenil',
          categoria: 'juvenil',
          temporada: '2026-27',
        })
        .returning()
      if (!juvenil) throw new Error('Sin plantilla')
      const r = await restriccionViolada(
        tx.insert(fichas).values({
          plantillaId: juvenil.id,
          jugadorId: b.ana.id,
          clubId: b.club.id,
          temporada: '2026-27',
        }),
      )
      expect(r).toBe('fichas_una_por_temporada')
    }))

  it('rechaza un jugador de otro club, declare el club que declare', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      for (const [clubId, esperada] of [
        [b.club.id, 'fichas_jugador_fk'],
        [b.otroClub.id, 'fichas_plantilla_fk'],
      ] as const) {
        // Cada intento en su propio punto de guardado, porque un error aborta la transacción
        const r = await restriccionViolada(
          tx.transaction((sp) =>
            sp
              .insert(fichas)
              .values({
                plantillaId: b.senior26.id,
                jugadorId: b.ajena.id,
                clubId,
                temporada: '2026-27',
              })
              .then(() => undefined),
          ),
        )
        expect(r).toBe(esperada)
      }
    }))

  it('rechaza una temporada distinta de la de su plantilla', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.insert(fichas).values({
          plantillaId: b.senior26.id,
          jugadorId: b.berta.id,
          clubId: b.club.id,
          temporada: '2027-28',
        }),
      )
      expect(r).toBe('fichas_plantilla_fk')
    }))
})

describe('plantillas', () => {
  it('rechaza un nombre repetido en el mismo club y temporada', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.insert(plantillas).values({
          clubId: b.club.id,
          nombre: 'Senior',
          categoria: 'sénior',
          temporada: '2026-27',
        }),
      )
      expect(r).toBe('plantillas_nombre_unico')
    }))

  it('permite el mismo nombre en otro club o en otra temporada', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      await tx.insert(plantillas).values([
        { clubId: b.otroClub.id, nombre: 'Senior', categoria: 'sénior', temporada: '2026-27' },
        { clubId: b.club.id, nombre: 'Senior', categoria: 'sénior', temporada: '2027-28' },
      ])
    }))

  it.each(['2026-28', '2026/27', '26-27', '2026-2027', ''])(
    'rechaza la temporada "%s"',
    (temporada) =>
      enTransaccion(async (tx) => {
        const b = await base(tx)
        const r = await restriccionViolada(
          tx
            .insert(plantillas)
            .values({ clubId: b.club.id, nombre: 'X', categoria: 'x', temporada }),
        )
        expect(r).toBe('plantillas_temporada_valida')
      }),
  )

  it('acepta la temporada 2099-00', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      await tx
        .insert(plantillas)
        .values({ clubId: b.club.id, nombre: 'X', categoria: 'x', temporada: '2099-00' })
    }))

  it('rechaza que una plantilla sea su propia anterior', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx
          .update(plantillas)
          .set({ plantillaAnteriorId: b.senior26.id })
          .where(eq(plantillas.id, b.senior26.id)),
      )
      expect(r).toBe('plantillas_anterior_distinta')
    }))
})

describe('valores', () => {
  it('rechaza colores que no son hex', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.update(clubes).set({ colorPrincipal: 'verde' }).where(eq(clubes.id, b.club.id)),
      )
      expect(r).toBe('clubes_color_principal_hex')
    }))

  it('rechaza nombres vacíos o de espacios', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const r = await restriccionViolada(
        tx.insert(jugadores).values({ clubId: b.club.id, nombre: '   ' }),
      )
      expect(r).toBe('jugadores_nombre_no_vacio')
    }))

  it('genera identificadores UUID v7', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      const { rows } = await tx.execute<{ version: number }>(
        sql`select uuid_extract_version(${b.club.id}::uuid) as version`,
      )
      expect(Number(rows[0]?.version)).toBe(7)
    }))
})

describe('borrados en cascada', () => {
  it('al borrar una plantilla se van sus fichas, la siguiente pierde el enlace y los jugadores siguen', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      await tx.delete(plantillas).where(eq(plantillas.id, b.senior25.id))
      expect(await tx.$count(fichas, eq(fichas.plantillaId, b.senior25.id))).toBe(0)
      const [siguiente] = await tx.select().from(plantillas).where(eq(plantillas.id, b.senior26.id))
      expect(siguiente?.plantillaAnteriorId).toBeNull()
      expect(await tx.$count(jugadores, eq(jugadores.clubId, b.club.id))).toBe(2)
    }))

  it('al borrar un club se va todo lo suyo y nada del otro club', () =>
    enTransaccion(async (tx) => {
      const b = await base(tx)
      await tx.delete(clubes).where(eq(clubes.id, b.club.id))
      expect(await tx.$count(plantillas, eq(plantillas.clubId, b.club.id))).toBe(0)
      expect(await tx.$count(jugadores, eq(jugadores.clubId, b.club.id))).toBe(0)
      expect(await tx.$count(fichas, eq(fichas.clubId, b.club.id))).toBe(0)
      expect(await tx.$count(jugadores, eq(jugadores.clubId, b.otroClub.id))).toBe(1)
    }))
})

describe('entrenos y asistencias', () => {
  // Un entreno del Senior 2026-27, en el que Ana tiene ficha y Berta no
  async function conEntreno(tx: Tx) {
    const b = await base(tx)
    const [entreno] = await tx
      .insert(entrenos)
      .values({ plantillaId: b.senior26.id, fecha: '2026-10-13' })
      .returning()
    if (!entreno) throw new Error('Sin entreno')
    return { ...b, entreno }
  }

  it('admite varios entrenos el mismo día a distinta hora (doble sesión)', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      await tx.insert(entrenos).values([
        { plantillaId: b.senior26.id, fecha: '2026-10-13', hora: '10:00' },
        { plantillaId: b.senior26.id, fecha: '2026-10-13', hora: '18:00' },
        { plantillaId: b.senior25.id, fecha: '2026-10-13' },
      ])
    }))

  it('rechaza dos entrenos el mismo día a la misma hora, o dos sin hora', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      // El entreno de conEntreno no tiene hora
      let r = await restriccionViolada(
        tx.transaction((sp) =>
          sp
            .insert(entrenos)
            .values({ plantillaId: b.senior26.id, fecha: '2026-10-13' })
            .then(() => undefined),
        ),
      )
      expect(r).toBe('entrenos_fecha_hora_unica')
      await tx
        .insert(entrenos)
        .values({ plantillaId: b.senior26.id, fecha: '2026-10-14', hora: '20:00' })
      r = await restriccionViolada(
        tx
          .insert(entrenos)
          .values({ plantillaId: b.senior26.id, fecha: '2026-10-14', hora: '20:00' }),
      )
      expect(r).toBe('entrenos_fecha_hora_unica')
    }))

  it('rechaza un horario que termina antes de empezar', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      const r = await restriccionViolada(
        tx.insert(horarios).values({
          plantillaId: b.senior26.id,
          desde: '2026-10-13',
          hasta: '2026-10-12',
          sesiones: [{ dia: 2, hora: '20:00' }],
        }),
      )
      expect(r).toBe('horarios_hasta_posterior')
    }))

  it('acepta la asistencia de un jugador con ficha en la plantilla del entreno', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      await tx.insert(asistencias).values({
        entrenoId: b.entreno.id,
        jugadorId: b.ana.id,
        plantillaId: b.senior26.id,
        estado: 'justificada',
        motivo: 'Trabajo',
      })
      const r = await restriccionViolada(
        tx.insert(asistencias).values({
          entrenoId: b.entreno.id,
          jugadorId: b.ana.id,
          plantillaId: b.senior26.id,
          estado: 'asiste',
        }),
      )
      expect(r).toBe('asistencias_entreno_id_jugador_id_pk')
    }))

  it('rechaza a un jugador sin ficha en la plantilla del entreno', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      const r = await restriccionViolada(
        tx.insert(asistencias).values({
          entrenoId: b.entreno.id,
          jugadorId: b.berta.id,
          plantillaId: b.senior26.id,
          estado: 'asiste',
        }),
      )
      expect(r).toBe('asistencias_ficha_fk')
    }))

  it('rechaza declarar otra plantilla, aunque el jugador tenga ficha en ella', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      const r = await restriccionViolada(
        tx.insert(asistencias).values({
          entrenoId: b.entreno.id,
          jugadorId: b.ana.id,
          plantillaId: b.senior25.id,
          estado: 'asiste',
        }),
      )
      expect(r).toBe('asistencias_entreno_fk')
    }))

  it.each([
    ['asiste', 'Trabajo'],
    ['falta', 'Trabajo'],
    ['justificada', '   '],
  ] as const)('rechaza el estado %s con motivo "%s"', (estado, motivo) =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      const r = await restriccionViolada(
        tx.insert(asistencias).values({
          entrenoId: b.entreno.id,
          jugadorId: b.ana.id,
          plantillaId: b.senior26.id,
          estado,
          motivo,
        }),
      )
      expect(r).toBe('asistencias_motivo_justificada')
    }),
  )

  it('al borrar un entreno o su plantilla se van sus asistencias', () =>
    enTransaccion(async (tx) => {
      const b = await conEntreno(tx)
      const asistencia = {
        entrenoId: b.entreno.id,
        jugadorId: b.ana.id,
        plantillaId: b.senior26.id,
        estado: 'asiste' as const,
      }
      await tx.insert(asistencias).values(asistencia)
      await tx.delete(entrenos).where(eq(entrenos.id, b.entreno.id))
      expect(await tx.$count(asistencias, eq(asistencias.plantillaId, b.senior26.id))).toBe(0)

      const [otro] = await tx
        .insert(entrenos)
        .values({ plantillaId: b.senior26.id, fecha: '2026-10-15' })
        .returning()
      await tx.insert(asistencias).values({ ...asistencia, entrenoId: otro?.id ?? '' })
      await tx.delete(plantillas).where(eq(plantillas.id, b.senior26.id))
      expect(await tx.$count(entrenos, eq(entrenos.plantillaId, b.senior26.id))).toBe(0)
      expect(await tx.$count(asistencias, eq(asistencias.plantillaId, b.senior26.id))).toBe(0)
    }))
})
