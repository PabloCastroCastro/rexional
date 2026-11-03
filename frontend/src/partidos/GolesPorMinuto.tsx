import { useState } from 'react'
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

export function GolesPorMinuto({ datos }: { datos: GolesPorMinuto }) {
  const [desde, setDesde] = useState(String(MINUTO_POR_DEFECTO))
  const minuto = Number.parseInt(desde, 10)
  const valido = Number.isInteger(minuto) && minuto >= 0 && minuto <= 150
  const aviso = avisoSinMinuto(datos)

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
      <h2 id="goles-minuto">Goles por minuto</h2>
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
