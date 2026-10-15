import { and, asc, eq } from 'drizzle-orm'
import type { db } from './db/cliente.js'
import { motivosMulta } from './db/schema/index.js'

// Catálogo de multas de una plantilla nueva (sección 2.5): los motivos activos de la plantilla
// anterior si la hay, o el catálogo por defecto. Las multas no se copian: la caja empieza de cero.
// La migración 0005_multas creó este mismo catálogo por defecto para las plantillas que ya existían.

export const CATALOGO_POR_DEFECTO = [
  { descripcion: 'Llegar tarde al entreno', importeCentimos: 200, tipoTarjeta: null },
  { descripcion: 'Faltar sin avisar', importeCentimos: 500, tipoTarjeta: null },
  { descripcion: 'Olvidar la equipación', importeCentimos: 300, tipoTarjeta: null },
  { descripcion: 'Tarjeta amarilla por protestar', importeCentimos: 500, tipoTarjeta: 'amarilla' },
  { descripcion: 'Tarjeta roja', importeCentimos: 1000, tipoTarjeta: 'roja' },
] as const

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function crearCatalogo(tx: Tx, plantillaId: string, anteriorId: string | null) {
  const deLaAnterior = anteriorId
    ? await tx
        .select({
          descripcion: motivosMulta.descripcion,
          importeCentimos: motivosMulta.importeCentimos,
          tipoTarjeta: motivosMulta.tipoTarjeta,
        })
        .from(motivosMulta)
        .where(and(eq(motivosMulta.plantillaId, anteriorId), eq(motivosMulta.activo, true)))
        .orderBy(asc(motivosMulta.createdAt), asc(motivosMulta.id))
    : []
  const motivos = deLaAnterior.length > 0 ? deLaAnterior : CATALOGO_POR_DEFECTO
  await tx.insert(motivosMulta).values(motivos.map((m) => ({ ...m, plantillaId })))
}
