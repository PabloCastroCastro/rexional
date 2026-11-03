import { ArrowDown, ArrowUp, ArrowUpDown, BarChart3 } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { Cargando } from '../componentes/Cargando'
import { BotonesPdf } from '../componentes/CompartirPdf'
import { EstadoVacio } from '../componentes/EstadoVacio'
import { Selector } from '../componentes/Selector'
import { nombreCompleto, puedeGestionarJugadores } from '../jugadores/datos'
import { Dorsal } from '../jugadores/PaginaPlantilla'
import { usePlantillaActiva } from '../plantillas/PlantillaActiva'
import {
  type EstadisticasJugador,
  type EstadisticasPlantilla,
  minutosPorEntreno,
  por90,
  resumenEstadisticas,
  textoPor90,
  textoPorEntreno,
  useEstadisticas,
} from './datos'
import { GolesPorMinuto } from './GolesPorMinuto'
import estilos from './Partidos.module.css'

// Estadísticas de la temporada (solo partidos jugados): resultados del equipo y, para el cuerpo
// técnico, los goles por minuto del equipo (GH-168), una tabla de jugadores con la estadística elegida, ordenable por cualquier columna
// (GH-164). Un jugador ve los resultados del equipo y lo suyo.

type Equipo = EstadisticasPlantilla['equipo']

type Columna = {
  clave: string
  // Texto visible en la cabecera y el que se lee
  corto: string
  largo: string
  // Por lo que se ordena; null va siempre al final
  valor: (j: EstadisticasJugador) => number | string | null
  celda?: (j: EstadisticasJugador) => ReactNode
  // Al pulsarla por primera vez: los textos y el dorsal, de menor a mayor; las cifras, al revés
  ascendente?: boolean
}

type Orden = { columna: string; descendente: boolean }

type Estadistica = {
  clave: string
  texto: string
  vacio: string
  columnas: Columna[]
  orden: Orden
  // Quién sale: quien tiene algo que contar
  filtrar: (jugadores: EstadisticasJugador[]) => EstadisticasJugador[]
  aviso?: (equipo: Equipo) => string | null
}

const cifra = (
  clave: keyof EstadisticasJugador,
  corto: string,
  largo = corto,
  celda?: Columna['celda'],
): Columna => ({ clave, corto, largo, valor: (j) => j[clave] as number, celda })

const minutos = (clave: 'minutos' | 'minutosConFavor' | 'minutosConEncajados') =>
  cifra(clave, 'Min.', 'Minutos', (j) => `${j[clave]}'`)

const conAlgo = (clave: keyof EstadisticasJugador) => (jugadores: EstadisticasJugador[]) =>
  jugadores.filter((j) => (j[clave] as number) > 0)

// Aviso de los partidos que no cuentan para los goles en el campo
const avisoSinMinuto = (n: number, cuales: 'a favor' | 'en contra') =>
  n === 1
    ? `1 partido no cuenta: le falta el minuto de algún gol ${cuales}.`
    : `${n} partidos no cuentan: les falta el minuto de algún gol ${cuales}.`

const enCampo = (
  clave: string,
  cuales: 'a favor' | 'en contra',
  goles: 'golesFavorEnCampo' | 'golesEncajados',
  base: 'minutosConFavor' | 'minutosConEncajados',
  sinMinuto: (e: Equipo) => number,
): Estadistica => ({
  clave,
  texto: `Goles ${cuales} en el campo`,
  vacio: `Todavía no hay partidos con el minuto de los goles ${cuales}.`,
  columnas: [
    cifra(goles, 'Goles'),
    minutos(base),
    {
      clave: 'por90',
      corto: "Por 90'",
      largo: `Goles ${cuales} por 90 minutos`,
      valor: (j) => por90(j[goles], j[base]),
      celda: (j) => textoPor90(j[goles], j[base]),
    },
  ],
  // En contra, mejor cuantos menos
  orden: { columna: 'por90', descendente: cuales === 'a favor' },
  filtrar: conAlgo(base),
  aviso: (e) => (sinMinuto(e) > 0 ? avisoSinMinuto(sinMinuto(e), cuales) : null),
})

const ESTADISTICAS: Estadistica[] = [
  {
    clave: 'goles',
    texto: 'Goles',
    vacio: 'Nadie ha marcado todavía.',
    columnas: [cifra('goles', 'Goles')],
    orden: { columna: 'goles', descendente: true },
    filtrar: conAlgo('goles'),
  },
  {
    clave: 'asistencias',
    texto: 'Asistencias',
    vacio: 'Todavía no hay asistencias.',
    columnas: [cifra('asistencias', 'Asist.', 'Asistencias')],
    orden: { columna: 'asistencias', descendente: true },
    filtrar: conAlgo('asistencias'),
  },
  {
    clave: 'minutos',
    texto: 'Minutos',
    vacio: 'Todavía no hay minutos registrados.',
    columnas: [minutos('minutos')],
    orden: { columna: 'minutos', descendente: true },
    filtrar: conAlgo('minutos'),
  },
  {
    clave: 'porEntreno',
    texto: 'Minutos por entreno',
    vacio: 'Todavía no se ha pasado lista en ningún entreno.',
    columnas: [
      minutos('minutos'),
      cifra('entrenos', 'Entr.', 'Entrenos'),
      {
        clave: 'porEntreno',
        corto: 'Media',
        largo: 'Minutos por entreno',
        valor: minutosPorEntreno,
        celda: textoPorEntreno,
      },
    ],
    orden: { columna: 'porEntreno', descendente: true },
    // Quien ha jugado o ha entrenado, y solo si se ha pasado lista alguna vez
    filtrar: (jugadores) =>
      jugadores.some((j) => j.entrenos > 0)
        ? jugadores.filter((j) => j.minutos > 0 || j.entrenos > 0)
        : [],
  },
  enCampo('aFavor', 'a favor', 'golesFavorEnCampo', 'minutosConFavor', (e) => e.sinMinutoAFavor),
  enCampo(
    'encajados',
    'en contra',
    'golesEncajados',
    'minutosConEncajados',
    (e) => e.sinMinutoEnContra,
  ),
  {
    clave: 'tarjetas',
    texto: 'Tarjetas',
    vacio: 'Ninguna tarjeta. ¡Así da gusto!',
    columnas: [
      cifra('amarillas', 'Am.', 'Amarillas'),
      // Una roja pesa más que cualquier número de amarillas
      {
        ...cifra('rojas', 'Rojas'),
        valor: (j) => j.rojas * 1000 + j.amarillas,
        celda: (j) => j.rojas,
      },
    ],
    orden: { columna: 'rojas', descendente: true },
    filtrar: (jugadores) => jugadores.filter((j) => j.amarillas + j.rojas > 0),
  },
]

const COLUMNAS_JUGADOR: Columna[] = [
  { clave: 'dorsal', corto: '#', largo: 'Dorsal', valor: (j) => j.dorsal, ascendente: true },
  { clave: 'jugador', corto: 'Jugador', largo: 'Jugador', valor: nombreCompleto, ascendente: true },
]

const porNombre = (a: EstadisticasJugador, b: EstadisticasJugador) =>
  nombreCompleto(a).localeCompare(nombreCompleto(b), 'es')

// Por la columna, con lo que no tiene valor al final; los empates, por nombre
function ordenar(lista: EstadisticasJugador[], columna: Columna, descendente: boolean) {
  return [...lista].sort((a, b) => {
    const [va, vb] = [columna.valor(a), columna.valor(b)]
    if (va === null || vb === null)
      return (va === null ? 1 : 0) - (vb === null ? 1 : 0) || porNombre(a, b)
    const r = typeof va === 'string' ? va.localeCompare(String(vb), 'es') : va - (vb as number)
    return (descendente ? -r : r) || porNombre(a, b)
  })
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
      <ResultadosEquipo equipo={equipo} />
      <GolesPorMinuto datos={equipo.golesPorMinuto} />
      {puedeGestionarJugadores(plantilla) ? (
        <>
          <Clasificaciones jugadores={jugadores} equipo={equipo} />
          <Exportar />
        </>
      ) : (
        <Mias jugador={jugadores[0]} equipo={equipo} />
      )}
    </>
  )
}

// Los datos de la temporada en Excel, para analizarlos fuera de la app (GH-170)
function Exportar() {
  const plantilla = usePlantillaActiva()
  const archivo = `${plantilla.nombre}-${plantilla.temporada}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return (
    <section className={estilos.seccion} aria-labelledby="exportar">
      <h2 id="exportar">Exportar</h2>
      <p className={estilos.secundario}>
        Partidos, goles y tarjetas, minutos de cada partido, estas cifras de los jugadores y la
        asistencia a los entrenos, en un Excel con una hoja para cada cosa.
      </p>
      <div className={estilos.botonesExportar}>
        <BotonesPdf
          formato="excel"
          url={`/api/plantillas/${plantilla.id}/exportacion.xlsx`}
          nombre={`${archivo}.xlsx`}
          titulo={`Estadísticas · ${plantilla.nombre} ${plantilla.temporada}`}
        />
      </div>
    </section>
  )
}

function ResultadosEquipo({ equipo }: { equipo: Equipo }) {
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

const PRIMERA = ESTADISTICAS[0] as Estadistica

function Clasificaciones({
  jugadores,
  equipo,
}: {
  jugadores: EstadisticasJugador[]
  equipo: Equipo
}) {
  const plantilla = usePlantillaActiva()
  const [actual, setActual] = useState<Estadistica>(PRIMERA)
  const [orden, setOrden] = useState<Orden>(PRIMERA.orden)
  const columnas = [...COLUMNAS_JUGADOR, ...actual.columnas]
  const columna = columnas.find((c) => c.clave === orden.columna) ?? columnas[0]
  const lista = columna
    ? ordenar(actual.filtrar(jugadores), columna, orden.descendente)
    : actual.filtrar(jugadores)
  const aviso = actual.aviso?.(equipo)

  const elegir = (clave: string) => {
    const nueva = ESTADISTICAS.find((e) => e.clave === clave) ?? PRIMERA
    setActual(nueva)
    setOrden(nueva.orden)
  }
  const ordenarPor = (c: Columna) =>
    setOrden((o) =>
      o.columna === c.clave
        ? { columna: c.clave, descendente: !o.descendente }
        : { columna: c.clave, descendente: !c.ascendente },
    )

  return (
    <section className={estilos.seccion} aria-labelledby="clasificaciones">
      <h2 id="clasificaciones">Jugadores</h2>
      <Selector
        etiqueta="Estadística"
        value={actual.clave}
        onChange={(e) => elegir(e.target.value)}
      >
        {ESTADISTICAS.map((e) => (
          <option key={e.clave} value={e.clave}>
            {e.texto}
          </option>
        ))}
      </Selector>
      {aviso && (
        <p className={estilos.secundario} role="note">
          {aviso}
        </p>
      )}
      {lista.length === 0 ? (
        <p className={estilos.secundario}>{actual.vacio}</p>
      ) : (
        <div className={estilos.envolturaTabla}>
          <table className={estilos.tablaEstadisticas} aria-label={actual.texto}>
            <thead>
              <tr>
                {columnas.map((c) => {
                  const activa = c.clave === orden.columna
                  const Flecha = !activa ? ArrowUpDown : orden.descendente ? ArrowDown : ArrowUp
                  return (
                    <th
                      key={c.clave}
                      scope="col"
                      data-columna={c.clave}
                      aria-sort={
                        activa ? (orden.descendente ? 'descending' : 'ascending') : undefined
                      }
                    >
                      <button type="button" onClick={() => ordenarPor(c)}>
                        <span aria-hidden="true">{c.corto}</span>
                        <span className="solo-lectores">{c.largo}</span>
                        <Flecha aria-hidden size={14} data-activa={activa || undefined} />
                      </button>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {lista.map((j) => (
                <tr key={j.jugadorId}>
                  <td data-columna="dorsal">
                    <Dorsal dorsal={j.dorsal} />
                  </td>
                  <th scope="row" data-columna="jugador">
                    <Link to={`/plantillas/${plantilla.id}/jugadores/${j.jugadorId}`}>
                      {nombreCompleto(j)}
                    </Link>
                    {!j.activo && <span className={estilos.secundario}> · baja</span>}
                  </th>
                  {actual.columnas.map((c) => (
                    <td key={c.clave} data-orden={c.clave === orden.columna || undefined}>
                      {c.celda ? c.celda(j) : c.valor(j)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Mias({ jugador, equipo }: { jugador: EstadisticasJugador | undefined; equipo: Equipo }) {
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
      {jugador && jugador.minutosConFavor > 0 && (
        <p className={estilos.secundario}>
          {textoPor90(jugador.golesFavorEnCampo, jugador.minutosConFavor)} goles a favor por 90' con
          él en el campo ({jugador.golesFavorEnCampo} en {jugador.minutosConFavor}')
          {equipo.sinMinutoAFavor > 0 && `. ${avisoSinMinuto(equipo.sinMinutoAFavor, 'a favor')}`}
        </p>
      )}
      {jugador && jugador.minutosConEncajados > 0 && (
        <p className={estilos.secundario}>
          {textoPor90(jugador.golesEncajados, jugador.minutosConEncajados)} goles en contra por 90'
          con él en el campo ({jugador.golesEncajados} en {jugador.minutosConEncajados}')
          {equipo.sinMinutoEnContra > 0 &&
            `. ${avisoSinMinuto(equipo.sinMinutoEnContra, 'en contra')}`}
        </p>
      )}
    </section>
  )
}
