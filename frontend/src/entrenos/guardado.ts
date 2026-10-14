import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, datos } from '../api/cliente'
import { CLAVE_ENTRENOS, claveEntreno, type Estado } from './datos'

export type Asistencia = { jugadorId: string; estado: Estado; motivo?: string | null }
export type EstadoGuardado = 'guardado' | 'pendiente' | 'guardando' | 'error'

// Espera desde el último cambio antes de guardar: agrupa varios toques seguidos en una petición
export const ESPERA_GUARDADO = 600

// Guardado automático de la lista de un día. Cada cambio programa el envío de la lista completa; nunca
// hay dos envíos a la vez (si cambia durante uno, al terminar se envía lo último). Si falla, se
// conserva para reintentar a mano o al recuperar la conexión, y se avisa antes de salir de la página.
export function useGuardadoAutomatico(plantillaId: string, fecha: string) {
  const cliente = useQueryClient()
  const [estado, setEstado] = useState<EstadoGuardado>('guardado')
  const pendiente = useRef<Asistencia[] | null>(null)
  const enCurso = useRef(false)
  const temporizador = useRef<ReturnType<typeof setTimeout>>(undefined)

  const enviar = useCallback(async () => {
    clearTimeout(temporizador.current)
    if (enCurso.current || pendiente.current === null) return
    const lista = pendiente.current
    pendiente.current = null
    enCurso.current = true
    setEstado('guardando')
    try {
      const entreno = await datos(
        api.PUT('/api/plantillas/{id}/entrenos/{fecha}/asistencias', {
          params: { path: { id: plantillaId, fecha } },
          body: { asistencias: lista },
        }),
      )
      const clave = claveEntreno(plantillaId, fecha)
      cliente.setQueryData(clave, entreno)
      // El historial y los resúmenes cambian; este día ya está al día con la respuesta
      void cliente.invalidateQueries({
        queryKey: CLAVE_ENTRENOS,
        predicate: (q) => JSON.stringify(q.queryKey) !== JSON.stringify(clave),
      })
      enCurso.current = false
      if (pendiente.current) void enviar()
      else setEstado('guardado')
    } catch {
      enCurso.current = false
      // Si mientras tanto hubo otro cambio, ese es el que hay que guardar
      pendiente.current ??= lista
      setEstado('error')
    }
  }, [cliente, plantillaId, fecha])

  const programar = useCallback(
    (lista: Asistencia[]) => {
      pendiente.current = lista
      if (!enCurso.current) setEstado('pendiente')
      clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => void enviar(), ESPERA_GUARDADO)
    },
    [enviar],
  )

  // Al cambiar de día (o salir de la pantalla) se envía lo que quede sin esperar
  useEffect(
    () => () => {
      if (pendiente.current) void enviar()
    },
    [enviar],
  )

  useEffect(() => {
    const alConectar = () => void enviar()
    window.addEventListener('online', alConectar)
    return () => window.removeEventListener('online', alConectar)
  }, [enviar])

  useEffect(() => {
    if (estado === 'guardado') return
    const alSalir = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', alSalir)
    return () => window.removeEventListener('beforeunload', alSalir)
  }, [estado])

  return { estado, programar, reintentar: () => void enviar() }
}
