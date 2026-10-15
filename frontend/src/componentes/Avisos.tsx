import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import estilos from './Avisos.module.css'

export type OpcionesAviso = {
  mensaje: string
  tipo?: 'exito' | 'error' | 'info'
  // Botón dentro del aviso, p. ej. "Deshacer" o "Actualizar"
  accion?: { texto: string; alPulsar: () => void }
  // Milisegundos hasta que desaparece; null lo deja hasta que se cierre o se pulse la acción
  duracion?: number | null
}

type Aviso = OpcionesAviso & { id: number }

type ContextoAvisos = {
  avisar: (opciones: OpcionesAviso) => number
  quitar: (id: number) => void
}

const Contexto = createContext<ContextoAvisos | null>(null)

// Mensajes breves no bloqueantes (toast):
//   const { avisar } = useAvisos()
//   avisar({ tipo: 'exito', mensaje: 'Jugador dado de alta' })
export function useAvisos() {
  const contexto = useContext(Contexto)
  if (!contexto) throw new Error('useAvisos necesita ProveedorAvisos')
  return contexto
}

const DURACION = 4000

const iconos = {
  exito: <CircleCheck aria-hidden size={20} />,
  error: <CircleAlert aria-hidden size={20} />,
  info: <Info aria-hidden size={20} />,
}

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const siguienteId = useRef(1)

  const quitar = useCallback((id: number) => {
    setAvisos((actuales) => actuales.filter((a) => a.id !== id))
  }, [])

  const avisar = useCallback((opciones: OpcionesAviso) => {
    const id = siguienteId.current++
    setAvisos((actuales) => [...actuales, { ...opciones, id }])
    return id
  }, [])

  const valor = useMemo(() => ({ avisar, quitar }), [avisar, quitar])

  return (
    <Contexto.Provider value={valor}>
      {children}
      {/* Región siempre presente para que los lectores de pantalla anuncien los avisos nuevos */}
      <section className={estilos.avisos} aria-label="Avisos" aria-live="polite">
        {avisos.map((aviso) => (
          <TarjetaAviso key={aviso.id} aviso={aviso} alCerrar={() => quitar(aviso.id)} />
        ))}
      </section>
    </Contexto.Provider>
  )
}

function TarjetaAviso({ aviso, alCerrar }: { aviso: Aviso; alCerrar: () => void }) {
  const tipo = aviso.tipo ?? 'info'
  const duracion = aviso.duracion === undefined ? DURACION : aviso.duracion

  useEffect(() => {
    if (duracion === null) return
    const temporizador = setTimeout(alCerrar, duracion)
    return () => clearTimeout(temporizador)
  }, [duracion, alCerrar])

  return (
    <div
      className={`${estilos.aviso} ${estilos[tipo]}`}
      role={tipo === 'error' ? 'alert' : 'status'}
    >
      <span className={estilos.icono}>{iconos[tipo]}</span>
      <p className={estilos.mensaje}>{aviso.mensaje}</p>
      {aviso.accion && (
        <button
          type="button"
          className={estilos.accion}
          onClick={() => {
            aviso.accion?.alPulsar()
            alCerrar()
          }}
        >
          {aviso.accion.texto}
        </button>
      )}
      <button type="button" className={estilos.cerrar} onClick={alCerrar} aria-label="Cerrar aviso">
        <X aria-hidden size={18} />
      </button>
    </div>
  )
}
