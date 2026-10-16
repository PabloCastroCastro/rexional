import { BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { nombreCompleto, puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  type EstadisticasJugador,
  type EstadisticasPlantilla,
  resumenEstadisticas,
  useEstadisticas,
} from './datos'
import estilos from './Partidos.module.css'

// Estadísticas de la temporada (solo partidos jugados): resultados del equipo y clasificaciones de
// goleadores, asistencias, minutos y tarjetas. Un jugador ve las del equipo y las suyas.

type Tabla = 'goles' | 'asistencias' | 'minutos' | 'tarjetas'
const TABLAS: { tabla: Tabla; texto: string; vacio: string }[] = [
  { tabla: 'goles', texto: 'Goleadores', vacio: 'Nadie ha marcado todavía.' },
  { tabla: 'asistencias', texto: 'Asistencias', vacio: 'Todavía no hay asistencias.' },
  { tabla: 'minutos', texto: 'Minutos', vacio: 'Todavía no hay minutos registrados.' },
  { tabla: 'tarjetas', texto: 'Tarjetas', vacio: 'Ninguna tarjeta. ¡Así da gusto!' },
]

// Valor por el que se ordena cada tabla: en tarjetas, una roja pesa más que cualquier amarilla
const valor = (j: EstadisticasJugador, tabla: Tabla) =>
  tabla === 'tarjetas' ? j.rojas * 100 + j.amarillas : j[tabla]

export function Estadisticas() {
  const plantilla = usePlantillaActiva()
  const estadisticas = useEstadisticas(plantilla.id)
  if (estadisticas.isPending) return <Cargando />
  if (estadisticas.isError) {
    return (
      <p className={estilos.error} role="alert">
        {estadisticas.error.message}
      </p>
    )
  }
  const { equipo, jugadores } = estadisticas.data
  if (equipo.jugados === 0) {
    return (
      <EstadoVacio
        icono={<BarChart3 size={32} />}
        titulo="Todavía no hay partidos jugados"
        descripcion="Las estadísticas salen de los partidos con resultado: pon el resultado o sube el acta de cada partido."
      />
    )
  }
  return (
    <>
      <Equipo equipo={equipo} />
      {puedeGestionarJugadores(plantilla) ? (
        <Clasificaciones jugadores={jugadores} />
      ) : (
        <Mias jugador={jugadores[0]} />
      )}
    </>
  )
}

function Equipo({ equipo }: { equipo: EstadisticasPlantilla['equipo'] }) {
  const diferencia = equipo.golesFavor - equipo.golesContra
  return (
    <section className={estilos.seccion} aria-labelledby="equipo">
      <h2 id="equipo">Resultados</h2>
      <dl className={estilos.cifras}>
        {[
          ['Jugados', equipo.jugados],
          ['Ganados', equipo.ganados],
          ['Empatados', equipo.empatados],
          ['Perdidos', equipo.perdidos],
        ].map(([texto, n]) => (
          <div key={texto}>
            <dt>{texto}</dt>
            <dd>{n}</dd>
          </div>
        ))}
      </dl>
      <p className={estilos.secundario}>
        Goles: {equipo.golesFavor} a favor y {equipo.golesContra} en contra (
        {diferencia > 0 ? `+${diferencia}` : diferencia})
      </p>
    </section>
  )
}

function Clasificaciones({ jugadores }: { jugadores: EstadisticasJugador[] }) {
  const plantilla = usePlantillaActiva()
  const [tabla, setTabla] = useState<Tabla>('goles')
  const actual = TABLAS.find((t) => t.tabla === tabla) ?? TABLAS[0]
  const lista = jugadores
    .filter((j) => valor(j, tabla) > 0)
    .sort((a, b) => valor(b, tabla) - valor(a, tabla) || a.nombre.localeCompare(b.nombre, 'es'))

  return (
    <section className={estilos.seccion} aria-labelledby="clasificaciones">
      <h2 id="clasificaciones">Jugadores</h2>
      <fieldset className={estilos.tiposEvento}>
        <legend className="solo-lectores">Clasificación</legend>
        {TABLAS.map((t) => (
          <button
            key={t.tabla}
            type="button"
            aria-pressed={tabla === t.tabla}
            onClick={() => setTabla(t.tabla)}
          >
            {t.texto}
          </button>
        ))}
      </fieldset>
      {lista.length === 0 ? (
        <p className={estilos.secundario}>{actual?.vacio}</p>
      ) : (
        <ol className={estilos.convocados} aria-label={actual?.texto}>
          {lista.map((j) => (
            <li key={j.jugadorId}>
              <Dorsal dorsal={j.dorsal} />
              <Link
                to={`/plantillas/${plantilla.id}/jugadores/${j.jugadorId}`}
                className={estilos.nombreClasificacion}
              >
                {nombreCompleto(j)}
                {!j.activo && <span className={estilos.secundario}> · baja</span>}
              </Link>
              <span className={estilos.valorClasificacion}>
                {tabla === 'tarjetas' ? (
                  <>
                    {j.amarillas > 0 && (
                      <span className={estilos.tarjetaFalta} data-tipo="amarilla">
                        {j.amarillas}
                        <span className="solo-lectores">
                          {j.amarillas === 1 ? ' amarilla' : ' amarillas'}
                        </span>
                      </span>
                    )}
                    {j.rojas > 0 && (
                      <span className={estilos.tarjetaFalta} data-tipo="roja">
                        {j.rojas}
                        <span className="solo-lectores">{j.rojas === 1 ? ' roja' : ' rojas'}</span>
                      </span>
                    )}
                  </>
                ) : tabla === 'minutos' ? (
                  `${j.minutos}'`
                ) : (
                  j[tabla]
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Mias({ jugador }: { jugador: EstadisticasJugador | undefined }) {
  return (
    <section className={estilos.seccion} aria-labelledby="mias">
      <h2 id="mias">Tus estadísticas</h2>
      <p className={estilos.secundario}>
        {jugador ? resumenEstadisticas(jugador) : 'No tienes ficha en esta plantilla.'}
      </p>
    </section>
  )
}
