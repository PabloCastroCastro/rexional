import { useQuery } from '@tanstack/react-query'
import { api, datos } from '../api/cliente'
import type { components } from '../api/esquema'
import { puedeGestionarJugadores } from '../jugadores/datos'

export type Multa = components['schemas']['Multa']
export type MotivoMulta = components['schemas']['MotivoMulta']
export type ResumenMultas = components['schemas']['ResumenMultas']
export type TipoTarjeta = NonNullable<MotivoMulta['tipoTarjeta']>
export type EstadoMulta = 'pendientes' | 'cobradas'

// Catálogo, multas y resumen cuelgan de esta clave, para refrescarlos juntos tras cualquier cambio
export const CLAVE_MULTAS = ['multas'] as const

export const useCatalogo = (plantillaId: string, inactivos = false) =>
  useQuery({
    queryKey: [...CLAVE_MULTAS, plantillaId, 'catalogo', inactivos],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/motivos-multa', {
          params: {
            path: { id: plantillaId },
            query: { inactivos: inactivos ? 'true' : 'false' },
          },
        }),
      ),
  })

export const useMultas = (
  plantillaId: string,
  filtros: { jugador?: string; estado?: EstadoMulta },
  activa = true,
) =>
  useQuery({
    queryKey: [...CLAVE_MULTAS, plantillaId, 'lista', filtros.jugador ?? '', filtros.estado ?? ''],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/multas', {
          params: { path: { id: plantillaId }, query: filtros },
        }),
      ),
    enabled: activa,
  })

// Caja y deudas: solo delegado o superior
export const useResumenMultas = (plantillaId: string, activa = true) =>
  useQuery({
    queryKey: [...CLAVE_MULTAS, plantillaId, 'resumen'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/multas/resumen', { params: { path: { id: plantillaId } } }),
      ),
    enabled: activa,
  })

// Deuda pendiente de cada jugador: la del resumen para quien gestiona; el rol jugador solo tiene
// sus multas, así que la calcula con ellas
export function useDeudas(plantilla: {
  id: string
  rol: string
  esAdminClub: boolean
  multasActivas: boolean
}) {
  const gestiona = puedeGestionarJugadores(plantilla)
  const resumen = useResumenMultas(plantilla.id, gestiona && plantilla.multasActivas)
  const propias = useMultas(
    plantilla.id,
    { estado: 'pendientes' },
    !gestiona && plantilla.multasActivas,
  )
  const deudas = new Map<string, number>()
  if (!plantilla.multasActivas) return deudas
  if (gestiona) {
    for (const d of resumen.data?.deudas ?? []) deudas.set(d.jugadorId, d.pendienteCentimos)
  } else {
    for (const m of propias.data ?? []) {
      deudas.set(m.jugadorId, (deudas.get(m.jugadorId) ?? 0) + m.importeCentimos)
    }
  }
  return deudas
}

// --- Importes: céntimos enteros por dentro, euros en pantalla ---

const formatoEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

// 1250 → "12,50 €"
export const euros = (centimos: number) => formatoEuros.format(centimos / 100)

// Lo que se escribe en el campo del importe: "5", "5,5", "5,50" o "5.50" (con o sin €) → 550 céntimos.
// null si no es un importe válido.
export function centimosDe(texto: string): number | null {
  const limpio = texto.replace('€', '').trim()
  if (!/^\d{1,4}([.,]\d{1,2})?$/.test(limpio)) return null
  return Math.round(Number(limpio.replace(',', '.')) * 100)
}

// 550 → "5,50" para el campo del importe
export const textoImporte = (centimos: number) => (centimos / 100).toFixed(2).replace('.', ',')

// Quién debe hoy, como mensaje para WhatsApp; solo se pide al abrir la hoja de exportar
export const useMensajeMultas = (plantillaId: string, activa: boolean) =>
  useQuery({
    queryKey: [...CLAVE_MULTAS, plantillaId, 'mensaje'],
    queryFn: () =>
      datos(
        api.GET('/api/plantillas/{id}/multas/mensaje', { params: { path: { id: plantillaId } } }),
      ),
    enabled: activa,
  })
