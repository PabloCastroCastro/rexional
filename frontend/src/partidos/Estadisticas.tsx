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
  encajadosPor90,
  minutosPorEntreno,
  resumenEstadisticas,
  textoEncajados,
  textoPorEntreno,
  useEstadisticas,
} from './datos'
import estilos from './Partidos.module.css'

// Estadísticas de la temporada (solo partidos jugados): resultados del equipo y clasificaciones de
// goleadores, asistencias, minutos, minutos por entreno, goles en contra y tarjetas. Un jugador ve
// los resultados del equipo y lo suyo.

type Tabla = 'goles' | 'asistencias' | 'minutos' | 'porEntreno' | 'encajados' | 'tarjetas'
const TABLAS: { tabla: Tabla; texto: string; vacio: string }[] = [
  { tabla: 'goles', texto: 'Goleadores', vacio: 'Nadie ha marcado todavía.' },
  { tabla: 'asistencias', texto: 'Asistencias', vacio: 'Todavía no hay asistencias.' },
  { tabla: 'minutos', texto: 'Minutos', vacio: 'Todavía no hay minutos registrados.' },
  {
    tabla: 'porEntreno',
    texto: 'Minutos por entreno',
    vacio: 'Todavía no se ha pasado lista en ningún entreno.',
  },
  {
    tabla: 'encajados',
    texto: 'Goles en contra',
    vacio: 'Todavía no hay partidos con el minuto de los goles en contra.',
  },
  { tabla: 'tarjetas', texto: 'Tarjetas', vacio: 'Ninguna tarjeta. ¡Así da gusto!' },
]

// Valor por el que se ordena cada tabla: en tarjetas, una roja pesa más que cualquier amarilla; en
// minutos por entreno, quien no ha ido a ningún entreno va al final; en goles en contra, de menos a
// más, y con los mismos, primero quien más ha jugado
function valor(j: EstadisticasJugador, tabla: Tabla) {
  if (tabla === 'tarjetas') return j.rojas * 100 + j.amarillas
  if (tabla === 'porEntreno') return minutosPorEntreno(j) ?? -1
  if (tabla === 'encajados') return -(encajadosPor90(j) ?? 0)
  return j[tabla]
}

const desempate = (a: EstadisticasJugador, b: EstadisticasJugador, tabla: Tabla) =>
  (tabla === 'encajados' ? b.minutosConEncajados - a.minutosConEncajados : 0) ||
  a.nombre.localeCompare(b.nombre, 'es')

// Quién sale en cada tabla: en minutos por entreno, quien ha jugado o ha entrenado, y solo si se ha
// pasado lista alguna vez
function enTabla(jugadores: EstadisticasJugador[], tabla: Tabla) {
  if (tabla === 'encajados') return jugadores.filter((j) => j.minutosConEncajados > 0)
  if (tabla !== 'porEntreno') return jugadores.filter((j) => valor(j, tabla) > 0)
  if (!jugadores.some((j) => j.entrenos > 0)) return []
  return jugadores.filter((j) => j.minutos > 0 || j.entrenos > 0)
}

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
        <Clasificaciones jugadores={jugadores} sinMinuto={equipo.sinMinutoEnContra} />
      ) : (
        <Mias jugador={jugadores[0]} sinMinuto={equipo.sinMinutoEnContra} />
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

function Clasificaciones({
  jugadores,
  sinMinuto,
}: {
  jugadores: EstadisticasJugador[]
  sinMinuto: number
}) {
  const plantilla = usePlantillaActiva()
  const [tabla, setTabla] = useState<Tabla>('goles')
  const actual = TABLAS.find((t) => t.tabla === tabla) ?? TABLAS[0]
  const lista = enTabla(jugadores, tabla).sort(
    (a, b) => valor(b, tabla) - valor(a, tabla) || desempate(a, b, tabla),
  )

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
      {tabla === 'encajados' && sinMinuto > 0 && (
        <p className={estilos.secundario} role="note">
          {avisoSinMinuto(sinMinuto)}
        </p>
      )}
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
                {tabla === 'porEntreno' && (
                  <span className={estilos.secundario}>
                    {' '}
                    · {j.minutos}' en {j.entrenos === 1 ? '1 entreno' : `${j.entrenos} entrenos`}
                  </span>
                )}
                {tabla === 'encajados' && (
                  <span className={estilos.secundario}>
                    {' '}
                    · {j.golesEncajados} en {j.minutosConEncajados}'
                  </span>
                )}
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
                ) : tabla === 'porEntreno' ? (
                  textoPorEntreno(j)
                ) : tabla === 'encajados' ? (
                  textoEncajados(j)
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

// Aviso de los partidos que no cuentan para los goles en contra
const avisoSinMinuto = (n: number) =>
  n === 1
    ? '1 partido no cuenta: le falta el minuto de algún gol en contra.'
    : `${n} partidos no cuentan: les falta el minuto de algún gol en contra.`

function Mias({
  jugador,
  sinMinuto,
}: {
  jugador: EstadisticasJugador | undefined
  sinMinuto: number
}) {
  return (
    <section className={estilos.seccion} aria-labelledby="mias">
      <h2 id="mias">Tus estadísticas</h2>
      <p className={estilos.secundario}>
        {jugador ? resumenEstadisticas(jugador) : 'No tienes ficha en esta plantilla.'}
      </p>
      {jugador && jugador.entrenos > 0 && (
        <p className={estilos.secundario}>
          {textoPorEntreno(jugador)} minutos por entreno ({jugador.minutos}' en{' '}
          {jugador.entrenos === 1 ? '1 entreno' : `${jugador.entrenos} entrenos`})
        </p>
      )}
      {jugador && jugador.minutosConEncajados > 0 && (
        <p className={estilos.secundario}>
          {textoEncajados(jugador)} goles en contra por 90' con él en el campo (
          {jugador.golesEncajados} en {jugador.minutosConEncajados}')
          {sinMinuto > 0 && `. ${avisoSinMinuto(sinMinuto)}`}
        </p>
      )}
    </section>
  )
}
