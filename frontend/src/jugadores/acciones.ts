import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, datos, ErrorApi } from '../api/cliente'
import { useAvisos } from '../componentes/Avisos'
import { useConfirmacion } from '../componentes/Confirmacion'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { CLAVE_JUGADORES, type JugadorPlantilla } from './datos'

// Baja (con confirmación) y reactivación de un jugador en la plantilla activa. Si al reactivar su
// dorsal ya lo lleva otro, se avisa con alDorsalOcupado para que elija otro.
export function useBajaYReactivacion({
  alDarDeBaja,
  alDorsalOcupado,
}: {
  alDarDeBaja?: () => void
  alDorsalOcupado: (jugador: JugadorPlantilla, mensaje: string) => void
}) {
  const plantilla = usePlantillaActiva()
  const cliente = useQueryClient()
  const { avisar } = useAvisos()
  const confirmar = useConfirmacion()

  const cambiar = useMutation({
    mutationFn: ({ jugador, activo }: { jugador: JugadorPlantilla; activo: boolean }) =>
      datos(
        api.PATCH('/api/plantillas/{id}/jugadores/{jid}', {
          params: { path: { id: plantilla.id, jid: jugador.jugadorId } },
          body: { activo },
        }),
      ),
    onSuccess: async (jugador) => {
      await cliente.invalidateQueries({ queryKey: CLAVE_JUGADORES })
      if (jugador.activo) {
        avisar({ tipo: 'exito', mensaje: `${jugador.nombre} vuelve a la plantilla` })
      } else {
        avisar({ tipo: 'exito', mensaje: `${jugador.nombre} dado de baja` })
        alDarDeBaja?.()
      }
    },
    onError: (error, { jugador }) => {
      if (error instanceof ErrorApi && error.codigo === 'dorsal_en_uso') {
        alDorsalOcupado(jugador, error.message)
      } else {
        avisar({
          tipo: 'error',
          mensaje: error instanceof Error ? error.message : 'No se ha podido guardar',
        })
      }
    },
  })

  return {
    pendiente: cambiar.isPending,
    darDeBaja: async (jugador: JugadorPlantilla) => {
      const confirmado = await confirmar({
        titulo: `¿Dar de baja a ${jugador.nombre}?`,
        mensaje:
          'Deja de aparecer en la plantilla, pero se conserva su historial. Puedes reactivarlo desde las bajas.',
        textoConfirmar: 'Dar de baja',
        peligrosa: true,
      })
      if (confirmado) cambiar.mutate({ jugador, activo: false })
    },
    reactivar: (jugador: JugadorPlantilla) => cambiar.mutate({ jugador, activo: true }),
  }
}
