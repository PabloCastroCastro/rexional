import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CloudCheck,
  FileText,
  LoaderCircle,
  X,
} from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { Boton } from '../componentes/Boton'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  type Entreno,
  type Estado,
  esFechaValida,
  hoy,
  sumarDias,
  textoFecha,
  useEntreno,
} from './datos'
import estilos from './Entrenos.module.css'
import { type Asistencia, type EstadoGuardado, useGuardadoAutomatico } from './guardado'

const ESTADOS: { estado: Estado; texto: string; icono: typeof Check }[] = [
  { estado: 'asiste', texto: 'Asiste', icono: Check },
  { estado: 'justificada', texto: 'Justificada', icono: FileText },
  { estado: 'falta', texto: 'Falta', icono: X },
]

// Pasar lista de un día (?fecha=AAAA-MM-DD; hoy por defecto, nunca un día futuro)
export function PaginaPasarLista() {
  const plantilla = usePlantillaActiva()
  const [parametros, setParametros] = useSearchParams()
  const actual = hoy()
  const pedida = parametros.get('fecha')
  const fecha = esFechaValida(pedida) && pedida <= actual ? pedida : actual
  const entreno = useEntreno(plantilla.id, fecha)
  const irA = (nueva: string) => setParametros(nueva === actual ? {} : { fecha: nueva })

  return (
    <div className={estilos.pagina}>
      <h1>Pasar lista</h1>

      <nav className={estilos.fecha} aria-label="Fecha del entreno">
        <button
          type="button"
          className={estilos.flecha}
          onClick={() => irA(sumarDias(fecha, -1))}
          aria-label="Día anterior"
        >
          <ChevronLeft aria-hidden size={24} />
        </button>
        <label className={estilos.dia}>
          <span>{textoFecha(fecha)}</span>
          <input
            type="date"
            aria-label="Elegir fecha"
            value={fecha}
            max={actual}
            onClick={(e) => e.currentTarget.showPicker?.()}
            onChange={(e) => {
              if (esFechaValida(e.target.value) && e.target.value <= actual) irA(e.target.value)
            }}
          />
        </label>
        <button
          type="button"
          className={estilos.flecha}
          onClick={() => irA(sumarDias(fecha, 1))}
          disabled={fecha >= actual}
          aria-label="Día siguiente"
        >
          <ChevronRight aria-hidden size={24} />
        </button>
      </nav>

      {entreno.isPending ? (
        <Cargando />
      ) : entreno.isError ? (
        <p className={estilos.error} role="alert">
          {entreno.error.message}
        </p>
      ) : puedeGestionarJugadores(plantilla) ? (
        // Cada día empieza con su propio estado local y su propio guardado
        <Lista key={fecha} fecha={fecha} entreno={entreno.data} />
      ) : (
        <SoloLectura entreno={entreno.data} />
      )}
    </div>
  )
}

type Marca = { estado: Estado | null; motivo: string }

function Lista({ fecha, entreno }: { fecha: string; entreno: Entreno }) {
  const plantilla = usePlantillaActiva()
  const guardado = useGuardadoAutomatico(plantilla.id, fecha)
  const [marcas, setMarcas] = useState<Record<string, Marca>>(() =>
    Object.fromEntries(
      entreno.jugadores.map((j) => [j.jugadorId, { estado: j.estado, motivo: j.motivo ?? '' }]),
    ),
  )

  function cambiar(nuevas: Record<string, Marca>) {
    setMarcas(nuevas)
    const lista: Asistencia[] = []
    for (const [jugadorId, { estado, motivo }] of Object.entries(nuevas)) {
      if (!estado) continue
      lista.push(
        estado === 'justificada'
          ? { jugadorId, estado, motivo: motivo.trim() || null }
          : { jugadorId, estado },
      )
    }
    guardado.programar(lista)
  }

  const marcar = (jugadorId: string, estado: Estado) => {
    const anterior = marcas[jugadorId] ?? { estado: null, motivo: '' }
    // Tocar el estado activo lo desmarca
    cambiar({
      ...marcas,
      [jugadorId]: { ...anterior, estado: anterior.estado === estado ? null : estado },
    })
  }

  const sinMarcar = entreno.jugadores.filter((j) => j.activo && !marcas[j.jugadorId]?.estado)
  const recuentos = { asiste: 0, justificada: 0, falta: 0 }
  for (const m of Object.values(marcas)) if (m.estado) recuentos[m.estado] += 1

  if (entreno.jugadores.length === 0) {
    return (
      <EstadoVacio
        titulo="No hay jugadores en la plantilla"
        descripcion="Añádelos desde la pestaña Plantilla para poder pasar lista."
      />
    )
  }

  return (
    <>
      <div className={estilos.barra}>
        <Recuentos recuentos={recuentos} sinMarcar={sinMarcar.length} />
        <IndicadorGuardado estado={guardado.estado} alReintentar={guardado.reintentar} />
      </div>

      <ul className={estilos.lista} aria-label="Jugadores">
        {entreno.jugadores.map((j) => {
          const marca = marcas[j.jugadorId] ?? { estado: null, motivo: '' }
          return (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} />
                <span className={estilos.nombre}>
                  {j.nombre}
                  {!j.activo && <span className={estilos.baja}> baja</span>}
                </span>
                <fieldset className={estilos.estados}>
                  <legend className="solo-lectores">Asistencia de {j.nombre}</legend>
                  {ESTADOS.map(({ estado, texto, icono: Icono }) => (
                    <button
                      key={estado}
                      type="button"
                      className={estilos[estado]}
                      aria-pressed={marca.estado === estado}
                      aria-label={texto}
                      title={texto}
                      onClick={() => marcar(j.jugadorId, estado)}
                    >
                      <Icono aria-hidden size={22} />
                    </button>
                  ))}
                </fieldset>
              </div>
              {marca.estado === 'justificada' && (
                <input
                  className={estilos.motivo}
                  aria-label={`Motivo de ${j.nombre}`}
                  placeholder="Motivo (opcional)"
                  maxLength={200}
                  value={marca.motivo}
                  onChange={(e) =>
                    cambiar({ ...marcas, [j.jugadorId]: { ...marca, motivo: e.target.value } })
                  }
                />
              )}
            </li>
          )
        })}
      </ul>

      {sinMarcar.length > 0 && (
        <Boton
          variante="secundario"
          anchoCompleto
          icono={<Check aria-hidden size={18} />}
          onClick={() => {
            const nuevas = { ...marcas }
            for (const j of sinMarcar) nuevas[j.jugadorId] = { estado: 'asiste', motivo: '' }
            cambiar(nuevas)
          }}
        >
          Marcar el resto como asiste ({sinMarcar.length})
        </Boton>
      )}
    </>
  )
}

function Recuentos({
  recuentos,
  sinMarcar,
}: {
  recuentos: Entreno['recuentos']
  sinMarcar?: number
}) {
  const partes = [
    `${recuentos.asiste} ${recuentos.asiste === 1 ? 'asiste' : 'asisten'}`,
    `${recuentos.justificada} ${recuentos.justificada === 1 ? 'justificada' : 'justificadas'}`,
    `${recuentos.falta} ${recuentos.falta === 1 ? 'falta' : 'faltan'}`,
  ]
  if (sinMarcar) partes.push(`${sinMarcar} sin marcar`)
  return <p className={estilos.recuentos}>{partes.join(' · ')}</p>
}

const TEXTOS_GUARDADO: Record<EstadoGuardado, string> = {
  guardado: 'Guardado',
  pendiente: 'Guardando…',
  guardando: 'Guardando…',
  error: 'No se ha guardado',
}

function IndicadorGuardado({
  estado,
  alReintentar,
}: {
  estado: EstadoGuardado
  alReintentar: () => void
}) {
  const Icono = estado === 'error' ? CircleAlert : estado === 'guardado' ? CloudCheck : LoaderCircle
  return (
    <div className={estilos.guardado} data-estado={estado} role="status">
      <Icono aria-hidden size={16} className={estado === 'guardando' ? estilos.girando : ''} />
      <span>{TEXTOS_GUARDADO[estado]}</span>
      {estado === 'error' && (
        <button type="button" className={estilos.reintentar} onClick={alReintentar}>
          Reintentar
        </button>
      )}
    </div>
  )
}

// Rol sin permiso para pasar lista: los recuentos del día y, como mucho, su propia fila
function SoloLectura({ entreno }: { entreno: Entreno }) {
  const textos = Object.fromEntries(ESTADOS.map((e) => [e.estado, e.texto]))
  return (
    <>
      {entreno.existe ? (
        <Recuentos recuentos={entreno.recuentos} />
      ) : (
        <p className={estilos.recuentos}>Aún no se ha pasado lista este día.</p>
      )}
      {entreno.jugadores.length > 0 && (
        <ul className={estilos.lista} aria-label="Mi asistencia">
          {entreno.jugadores.map((j) => (
            <li key={j.jugadorId}>
              <div className={estilos.fila}>
                <Dorsal dorsal={j.dorsal} />
                <span className={estilos.nombre}>{j.nombre}</span>
                <span className={estilos.secundario}>
                  {j.estado ? textos[j.estado] : 'Sin registrar'}
                  {j.motivo && ` · ${j.motivo}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={estilos.secundario}>Pasar lista es cosa del cuerpo técnico.</p>
    </>
  )
}
