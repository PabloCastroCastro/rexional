import { useState } from 'react'
import { Boton } from '../componentes/Boton'
import { Campo } from '../componentes/Campo'
import type { EstadisticasPlantilla } from './datos'
import estilos from './Partidos.module.css'

// Goles a favor y en contra del equipo según el minuto (GH-168): por partes, por tramos de 15
// minutos y desde el minuto que se elija. El descuento de la 1.ª parte se apunta como 45, así que el
// corte está en el 45. Los goles sin minuto no cuentan y se avisan.

type GolesPorMinuto = EstadisticasPlantilla['equipo']['golesPorMinuto']

type Tramo = { texto: string; largo: string; desde: number; hasta: number }

const tramo = (desde: number, hasta: number, texto: string, largo: string): Tramo => ({
  desde,
  hasta,
  texto,
  largo,
})

const PARTES = [
  tramo(0, 45, '1.ª parte', '1.ª parte'),
  tramo(46, Number.POSITIVE_INFINITY, '2.ª parte', '2.ª parte'),
]

const TRAMOS = [
  tramo(0, 15, "0–15'", 'del minuto 0 al 15'),
  tramo(16, 30, "16–30'", 'del minuto 16 al 30'),
  tramo(31, 45, "31–45'", 'del minuto 31 al 45'),
  tramo(46, 60, "46–60'", 'del minuto 46 al 60'),
  tramo(61, 75, "61–75'", 'del minuto 61 al 75'),
  tramo(76, Number.POSITIVE_INFINITY, "76–90+'", 'del minuto 76 al final'),
]

export const MINUTO_POR_DEFECTO = 75

export const contar = (minutos: number[], desde: number, hasta = Number.POSITIVE_INFINITY) =>
  minutos.filter((m) => m >= desde && m <= hasta).length

const goles = (n: number) => (n === 1 ? '1 gol' : `${n} goles`)

function avisoSinMinuto({ aFavorSinMinuto, enContraSinMinuto }: GolesPorMinuto) {
  const partes = [
    aFavorSinMinuto > 0 && `${goles(aFavorSinMinuto)} a favor`,
    enContraSinMinuto > 0 && `${goles(enContraSinMinuto)} en contra`,
  ].filter(Boolean)
  if (partes.length === 0) return null
  const total = aFavorSinMinuto + enContraSinMinuto
  return `${partes.join(' y ')} no ${total === 1 ? 'tiene' : 'tienen'} minuto y no ${total === 1 ? 'cuenta' : 'cuentan'} aquí.`
}

// «4 a favor y 2 en contra»
const aFavorYEnContra = (datos: GolesPorMinuto, t: Tramo) =>
  `${contar(datos.aFavor, t.desde, t.hasta)} a favor y ${contar(datos.enContra, t.desde, t.hasta)} en contra`

// Barras horizontales por tramo de 15 minutos (GH-282): en contra a la izquierda y a favor a la
// derecha del tramo, con su número junto a cada barra. La posición y el número distinguen las series
// sin depender del color; al pasar por encima o enfocar un tramo, su valor completo
function Grafico({ datos }: { datos: GolesPorMinuto }) {
  const valores = TRAMOS.map((t) => ({
    tramo: t,
    favor: contar(datos.aFavor, t.desde, t.hasta),
    contra: contar(datos.enContra, t.desde, t.hasta),
  }))
  const maximo = Math.max(1, ...valores.flatMap((v) => [v.favor, v.contra]))
  // En proporción al tramo más alto, dejando sitio al número, que va junto al extremo de la barra
  const ancho = (n: number) => `calc((100% - var(--sitio-numero)) * ${n / maximo})`
  return (
    <ul className={estilos.grafico} aria-label="Goles por tramo de 15 minutos">
      {valores.map(({ tramo: t, favor, contra }) => (
        <li
          key={t.texto}
          className={estilos.filaTramo}
          // El descanso: una separación entre la 1.ª y la 2.ª parte
          data-descanso={t.desde === 46 || undefined}
        >
          {/* Se enfoca con el teclado para ver su valor, igual que al pasar el ratón (GH-282) */}
          <div
            className={estilos.tramo}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: el foco muestra el valor del tramo
            tabIndex={0}
            // Un dibujo con su texto: el lector de pantalla lee el tramo entero
            role="img"
            aria-label={`${mayusculaInicial(t.largo)}: ${favor} a favor y ${contra} en contra`}
          >
            {/* En contra: el número y su barra, que crece hacia la izquierda desde el tramo */}
            <span className={estilos.ladoGrafico} data-serie="contra" aria-hidden="true">
              <span className={estilos.numeroBarra} data-cero={contra === 0 || undefined}>
                {contra}
              </span>
              {contra > 0 && <span className={estilos.barra} style={{ width: ancho(contra) }} />}
            </span>
            <span className={estilos.etiquetaTramo} aria-hidden="true">
              {t.texto}
            </span>
            {/* A favor: su barra crece hacia la derecha y el número va detrás */}
            <span className={estilos.ladoGrafico} data-serie="favor" aria-hidden="true">
              {favor > 0 && <span className={estilos.barra} style={{ width: ancho(favor) }} />}
              <span className={estilos.numeroBarra} data-cero={favor === 0 || undefined}>
                {favor}
              </span>
            </span>
            {/* El valor completo, al pasar por encima o enfocar */}
            <span className={estilos.valorTramo} aria-hidden="true">
              <span>{mayusculaInicial(t.largo)}</span>
              <span>
                <strong>{favor}</strong> a favor · <strong>{contra}</strong> en contra
              </span>
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}

const mayusculaInicial = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

export function GolesPorMinuto({ datos }: { datos: GolesPorMinuto }) {
  const [desde, setDesde] = useState(String(MINUTO_POR_DEFECTO))
  const [comoTabla, setComoTabla] = useState(false)
  const minuto = Number.parseInt(desde, 10)
  const valido = Number.isInteger(minuto) && minuto >= 0 && minuto <= 150
  const aviso = avisoSinMinuto(datos)
  const [primera, segunda] = PARTES as [Tramo, Tramo]

  const filas = (tramos: Tramo[]) =>
    tramos.map((t) => (
      <tr key={t.texto}>
        <th scope="row">
          {t.largo === t.texto ? (
            t.texto
          ) : (
            <>
              <span aria-hidden="true">{t.texto}</span>
              <span className="solo-lectores">{t.largo}</span>
            </>
          )}
        </th>
        <td>{contar(datos.aFavor, t.desde, t.hasta)}</td>
        <td>{contar(datos.enContra, t.desde, t.hasta)}</td>
      </tr>
    ))

  return (
    <section className={estilos.seccion} aria-labelledby="goles-minuto">
      <div className={estilos.cabeceraGrafico}>
        <h2 id="goles-minuto">Goles por minuto</h2>
        <Boton variante="texto" aria-pressed={comoTabla} onClick={() => setComoTabla(!comoTabla)}>
          {comoTabla ? 'Ver como gráfico' : 'Ver como tabla'}
        </Boton>
      </div>
      {comoTabla ? (
        <div className={estilos.envolturaTabla}>
          <table className={estilos.tablaMinutos} aria-label="Goles por partes y tramos">
            <thead>
              <tr>
                <th scope="col">Cuándo</th>
                <th scope="col">A favor</th>
                <th scope="col">En contra</th>
              </tr>
            </thead>
            <tbody>{filas(PARTES)}</tbody>
            <tbody>{filas(TRAMOS)}</tbody>
          </table>
        </div>
      ) : (
        <div className={estilos.marcoGrafico}>
          {/* La leyenda, en el orden de las barras: en contra a la izquierda, a favor a la derecha */}
          <ul className={estilos.leyenda} aria-label="Leyenda">
            <li className={estilos.claveLeyenda} data-serie="contra">
              En contra
            </li>
            <li className={estilos.claveLeyenda} data-serie="favor">
              A favor
            </li>
          </ul>
          <Grafico datos={datos} />
          {/* Cada parte en su línea; el « · » solo se ve si caben en una */}
          <p className={estilos.resumenPartes}>
            <span>
              {primera.texto}: {aFavorYEnContra(datos, primera)}
            </span>
            <span aria-hidden="true"> · </span>
            <span>
              {segunda.texto}: {aFavorYEnContra(datos, segunda)}
            </span>
          </p>
        </div>
      )}
      <div className={estilos.desdeMinuto}>
        <Campo
          etiqueta="Desde el minuto"
          type="number"
          inputMode="numeric"
          min={0}
          max={150}
          value={desde}
          onChange={(e) => setDesde(e.target.value)}
          error={valido || desde === '' ? undefined : 'Entre 0 y 150'}
        />
        {valido && (
          <p className={estilos.secundario} aria-live="polite">
            Desde el minuto {minuto}: {contar(datos.aFavor, minuto)} a favor y{' '}
            {contar(datos.enContra, minuto)} en contra
          </p>
        )}
      </div>
      {aviso && (
        <p className={estilos.secundario} role="note">
          {aviso}
        </p>
      )}
    </section>
  )
}
