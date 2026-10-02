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
