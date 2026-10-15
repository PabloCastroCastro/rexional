import { z } from '@hono/zod-openapi'

// Validaciones compartidas por las rutas. Repiten las reglas que también garantiza la base de datos,
// para responder con un error de validación claro antes de llegar a ella.

export const EsquemaUuid = z.uuid('Identificador no válido')

export const EsquemaTexto = (campo: string, maximo = 80) =>
  z
    .string()
    .trim()
    .min(1, `${campo} es obligatorio`)
    .max(maximo, `${campo} no puede tener más de ${maximo} caracteres`)

// Temporada AAAA-AA con años consecutivos (2026-27, 2099-00)
export const EsquemaTemporada = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'La temporada debe tener el formato AAAA-AA, p. ej. 2026-27')
  .refine((t) => (Number(t.slice(0, 4)) + 1) % 100 === Number(t.slice(5)), {
    message: 'Los dos años de la temporada deben ser consecutivos, p. ej. 2026-27',
  })
  .openapi({ example: '2026-27' })

// Nombre de la restricción de PostgreSQL que ha rechazado una operación, si es el caso
export function restriccionViolada(error: unknown): string | undefined {
  const e = error as { constraint?: string; cause?: { constraint?: string } }
  return e?.cause?.constraint ?? e?.constraint
}

// Día AAAA-MM-DD que existe en el calendario
export const EsquemaFecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
  .refine(
    (f) => {
      // Zod evalúa el refine aunque falle el formato: una fecha inválida no debe lanzar
      const dia = new Date(`${f}T00:00:00Z`)
      return !Number.isNaN(dia.getTime()) && dia.toISOString().startsWith(f)
    },
    { message: 'La fecha no existe' },
  )
  .openapi({ example: '2026-10-13' })

// Hora HH:MM de 00:00 a 23:59
export const EsquemaHora = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener el formato HH:MM')
  .openapi({ example: '20:00' })
