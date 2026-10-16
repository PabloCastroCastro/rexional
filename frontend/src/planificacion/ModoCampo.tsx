import {
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  X,
} from 'lucide-react'
import { type TouchEvent, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { CATEGORIAS, dominio, useEjercicio } from '../ejercicios/datos'
import { textoFecha, textoHoras } from '../entrenos/datos'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import { rutaPlan, usePlan } from './datos'
import estilos from './ModoCampo.module.css'

// Modo campo: la sesión ejercicio a ejercicio en el móvil, durante el entreno. Pantalla completa,
// letra grande y alto contraste (se lee a pleno sol), la pantalla no se apaga si el navegador lo
// permite, cuenta atrás opcional por ejercicio y acceso directo a pasar lista.

export function ModoCampo() {
  const plantilla = usePlantillaActiva()
  const { entrenoId = '' } = useParams()
  const plan = usePlan(plantilla.id, entrenoId)
  const [parametros, setParametros] = useSearchParams()
  const total = plan.data?.ejercicios.length ?? 0
  const paso = Math.min(Math.max(Number(parametros.get('paso')) || 1, 1), Math.max(total, 1))
  const pantallaEncendida = useWakeLock()
  const inicioToque = useRef<number | null>(null)
  const salir = rutaPlan(plantilla.id, entrenoId)

  const ir = (n: number) => setParametros({ paso: String(n) }, { replace: true })

  if (plan.isPending) {
    return (
      <div className={estilos.campo}>
        <Cargando />
      </div>
    )
  }
  if (plan.isError || total === 0) {
    return (
      <div className={estilos.campo}>
        <div className={estilos.vacio}>
          <p>
            {plan.isError ? plan.error.message : 'Este entreno no tiene ejercicios en el plan.'}
          </p>
          <Link to={salir} className={estilos.botonGrande}>
            Volver al plan
          </Link>
        </div>
      </div>
    )
  }

  const p = plan.data
  const actual = p.ejercicios[paso - 1]
  const alTocar = (e: TouchEvent) => {
    inicioToque.current = e.touches[0]?.clientX ?? null
  }
  const alSoltar = (e: TouchEvent) => {
    const inicio = inicioToque.current
    const fin = e.changedTouches[0]?.clientX
    inicioToque.current = null
    if (inicio === null || fin === undefined || Math.abs(fin - inicio) < 70) return
    if (fin < inicio && paso < total) ir(paso + 1)
    if (fin > inicio && paso > 1) ir(paso - 1)
  }

  return (
    <div className={estilos.campo} onTouchStart={alTocar} onTouchEnd={alSoltar}>
      <header className={estilos.barra}>
        <Link to={salir} className={estilos.icono} aria-label="Salir del modo campo">
          <X aria-hidden size={26} />
        </Link>
        <span className={estilos.progreso} aria-live="polite">
          {paso} de {total}
        </span>
        <Link
          to={`/plantillas/${plantilla.id}/entrenos?fecha=${p.fecha}&entreno=${p.entrenoId}`}
          className={estilos.icono}
          aria-label="Pasar lista"
        >
          <ClipboardCheck aria-hidden size={26} />
        </Link>
      </header>
      <p className={estilos.sesion}>
        {textoFecha(p.fecha)}
        {textoHoras(p) && ` · ${textoHoras(p)}`}
        {p.objetivo && ` · ${p.objetivo}`}
      </p>
      {pantallaEncendida === false && (
        <p className={estilos.aviso}>Este navegador no puede mantener la pantalla encendida.</p>
      )}

      {actual && (
        <Paso
          // Cada ejercicio empieza con su cuenta atrás desde el principio
          key={`${paso}-${actual.ejercicioId}`}
          ejercicioId={actual.ejercicioId}
          nombre={actual.nombre}
          minutos={actual.duracionMin}
          indicaciones={actual.indicaciones}
          alTerminar={paso < total ? () => ir(paso + 1) : undefined}
        />
      )}

      <nav className={estilos.navegacion} aria-label="Ejercicios">
        <button type="button" onClick={() => ir(paso - 1)} disabled={paso === 1}>
          <ChevronLeft aria-hidden size={28} />
          Anterior
        </button>
        {paso < total ? (
          <button type="button" onClick={() => ir(paso + 1)} className={estilos.principal}>
            Siguiente
            <ChevronRight aria-hidden size={28} />
          </button>
        ) : (
          <Link to={salir} className={estilos.principal}>
            Terminar
          </Link>
        )}
      </nav>
    </div>
  )
}

function Paso({
  ejercicioId,
  nombre,
  minutos,
  indicaciones,
  alTerminar,
}: {
  ejercicioId: string
  nombre: string
  minutos: number | null
  indicaciones: string | null
  alTerminar?: () => void
}) {
  const plantilla = usePlantillaActiva()
  const ejercicio = useEjercicio(plantilla.clubId, ejercicioId)
  const e = ejercicio.data
  return (
    <main className={estilos.paso}>
      <h1>{nombre}</h1>
      <p className={estilos.detalles}>
        {[
          minutos ? `${minutos} min` : null,
          e?.categoria ? CATEGORIAS[e.categoria] : null,
          e?.jugadores,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      {minutos && <CuentaAtras minutos={minutos} alTerminar={alTerminar} />}
      {indicaciones && (
        <p className={estilos.indicaciones}>
          <strong>Hoy:</strong> {indicaciones}
        </p>
      )}
      {e?.descripcion && <p className={estilos.descripcion}>{e.descripcion}</p>}
      {e?.material && (
        <p className={estilos.descripcion}>
          <strong>Material:</strong> {e.material}
        </p>
      )}
      {e && e.medios.length > 0 && (
        <ul className={estilos.medios} aria-label="Fotos y vídeos">
          {e.medios.map((m) => (
            <li key={m.id}>
              {m.tipo === 'enlace' && m.url ? (
                <a href={m.url} target="_blank" rel="noreferrer" className={estilos.enlace}>
                  <ExternalLink aria-hidden size={22} />
                  {m.pie ?? dominio(m.url)}
                </a>
              ) : m.urlArchivo && m.tipo === 'video' ? (
                // biome-ignore lint/a11y/useMediaCaption: vídeos de ejercicios grabados en el campo, sin subtítulos
                <video controls playsInline preload="metadata" poster={m.urlMiniatura ?? undefined}>
                  <source src={m.urlArchivo} type={m.mime ?? undefined} />
                </video>
              ) : m.urlArchivo ? (
                <img src={m.urlArchivo} alt={m.pie ?? `Foto de ${nombre}`} />
              ) : null}
              {m.pie && m.tipo !== 'enlace' && <p>{m.pie}</p>}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Cuenta atrás de los minutos del ejercicio. Con la hora de fin (y no restando segundos) no se
// desajusta aunque el móvil vaya lento o la pestaña quede en segundo plano.
function CuentaAtras({ minutos, alTerminar }: { minutos: number; alTerminar?: () => void }) {
  const total = minutos * 60_000
  const [restante, setRestante] = useState(total)
  const [fin, setFin] = useState<number | null>(null)

  useEffect(() => {
    if (fin === null) return
    const reloj = setInterval(() => {
      const quedan = Math.max(0, fin - Date.now())
      setRestante(quedan)
      if (quedan === 0) {
        setFin(null)
        navigator.vibrate?.([400, 200, 400])
      }
    }, 250)
    return () => clearInterval(reloj)
  }, [fin])

  const terminado = restante === 0
  return (
    <section
      className={estilos.cuentaAtras}
      data-terminado={terminado || undefined}
      aria-label="Cuenta atrás"
    >
      <output aria-live={terminado ? 'assertive' : 'off'}>
        {terminado ? '¡Tiempo!' : mmss(restante)}
      </output>
      <div>
        {fin === null ? (
          !terminado && (
            <button type="button" onClick={() => setFin(Date.now() + restante)}>
              <Play aria-hidden size={22} />
              {restante === total ? 'Iniciar' : 'Seguir'}
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => {
              setRestante(Math.max(0, fin - Date.now()))
              setFin(null)
            }}
          >
            <Pause aria-hidden size={22} />
            Pausa
          </button>
        )}
        {(restante !== total || fin !== null) && (
          <button
            type="button"
            aria-label="Reiniciar la cuenta atrás"
            onClick={() => {
              setFin(null)
              setRestante(total)
            }}
          >
            <RotateCcw aria-hidden size={22} />
          </button>
        )}
        {terminado && alTerminar && (
          <button type="button" onClick={alTerminar}>
            Siguiente ejercicio
          </button>
        )}
      </div>
    </section>
  )
}

// Mantiene la pantalla encendida mientras el modo campo está abierto. Devuelve false si el navegador
// no lo permite (null mientras no se sabe).
function useWakeLock() {
  const [soportado, setSoportado] = useState<boolean | null>(null)
  useEffect(() => {
    const api = (
      navigator as Navigator & {
        wakeLock?: { request: (tipo: 'screen') => Promise<{ release: () => Promise<void> }> }
      }
    ).wakeLock
    if (!api) {
      setSoportado(false)
      return
    }
    let bloqueo: { release: () => Promise<void> } | null = null
    let activo = true
    const pedir = () =>
      api
        .request('screen')
        .then((b) => {
          if (activo) {
            bloqueo = b
            setSoportado(true)
          } else void b.release()
        })
        .catch(() => setSoportado(false))
    // El navegador lo suelta al cambiar de pestaña: se pide otra vez al volver
    const alVolver = () => {
      if (document.visibilityState === 'visible') void pedir()
    }
    void pedir()
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      activo = false
      document.removeEventListener('visibilitychange', alVolver)
      void bloqueo?.release()
    }
  }, [])
  return soportado
}
