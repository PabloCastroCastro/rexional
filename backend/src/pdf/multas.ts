import type { Content, TableCell } from 'pdfmake'
import { hoy } from '../fechas.js'
import { euros, fechaCorta } from '../formato.js'
import type { InformeMultas, MultaInforme, RangoMultas } from '../rutas/multas.js'
import { clubPdf, generarPdf } from './documento.js'

// Informe de multas de la plantilla en PDF (GH-132), para imprimirlo o compartirlo: totales, una fila
// por jugador con lo puesto, lo pagado y lo pendiente y, si se pide, cada multa.

// «20 de octubre de 2026»
const fechaLarga = (fecha: string) =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${fecha}T00:00:00Z`),
  )

const textoRango = ({ desde, hasta }: RangoMultas) => {
  if (desde && hasta) return `Del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`
  if (desde) return `Desde el ${fechaLarga(desde)}`
  if (hasta) return `Hasta el ${fechaLarga(hasta)}`
  return 'Toda la temporada'
}

type JugadorInforme = InformeMultas['jugadores'][number]

const nombreJugador = (j: Pick<JugadorInforme, 'nombre' | 'apellidos' | 'dorsal'>) =>
  `${j.dorsal ?? '–'} · ${j.apellidos ? `${j.nombre} ${j.apellidos}` : j.nombre}`

const cabecera = (textos: string[], derecha: number[]): TableCell[] =>
  textos.map((text, i) => ({
    text,
    style: 'secundario',
    alignment: derecha.includes(i) ? 'right' : 'left',
  }))

const importe = (centimos: number, negrita = false): TableCell => ({
  text: euros(centimos),
  alignment: 'right',
  bold: negrita,
  ...(centimos === 0 && !negrita ? { style: 'secundario' } : {}),
})

// Tablas compactas: una plantilla entera (30-35 jugadores) cabe en la primera página. Línea marcada
// bajo la cabecera y sobre los totales; finas entre filas.
const compacta = (conTotal: boolean) => ({
  hLineWidth: (i: number, nodo: { table: { body: unknown[] } }) => {
    const filas = nodo.table.body.length
    if (i === 0 || i === filas) return 0
    return i === 1 || (conTotal && i === filas - 1) ? 1 : 0.5
  },
  vLineWidth: () => 0,
  hLineColor: (i: number) => (i === 1 ? '#000000' : '#bbbbbb'),
  paddingTop: () => 2,
  paddingBottom: () => 2,
})

function totales(informe: InformeMultas): Content {
  const cifra = (titulo: string, centimos: number): Content => ({
    stack: [
      { text: titulo, style: 'secundario' },
      { text: euros(centimos), fontSize: 16, bold: true },
    ],
  })
  return {
    columns: [
      cifra('Puesto', informe.totalCentimos),
      cifra('Cobrado (en caja)', informe.cajaCentimos),
      cifra('Pendiente', informe.pendienteCentimos),
    ],
    margin: [0, 10, 0, 0],
  }
}

function tablaJugadores(informe: InformeMultas): Content {
  const filas: TableCell[][] = informe.jugadores.map((j) => [
    {
      text: [nombreJugador(j), ...(j.activo ? [] : [{ text: ' (baja)', style: 'secundario' }])],
    },
    {
      text: String(j.multas),
      alignment: 'right',
      ...(j.multas === 0 ? { style: 'secundario' } : {}),
    },
    importe(j.totalCentimos),
    importe(j.pagadoCentimos),
    importe(j.pendienteCentimos, j.pendienteCentimos > 0),
  ])
  return {
    fontSize: 9,
    lineHeight: 1,
    table: {
      headerRows: 1,
      widths: ['*', 40, 60, 60, 60],
      body: [
        cabecera(['Jugador', 'Multas', 'Puesto', 'Pagado', 'Pendiente'], [1, 2, 3, 4]),
        ...filas,
        [
          { text: 'Total', bold: true },
          {
            text: String(informe.jugadores.reduce((n, j) => n + j.multas, 0)),
            alignment: 'right',
            bold: true,
          },
          importe(informe.totalCentimos, true),
          importe(informe.cajaCentimos, true),
          importe(informe.pendienteCentimos, true),
        ],
      ],
    },
    layout: compacta(true),
  }
}

// Las multas de cada jugador, de la más antigua a la más reciente. El título va con el primer
// jugador, para que no se quede solo al pie de una página.
function detalle(informe: InformeMultas, lista: MultaInforme[]): Content[] {
  const contenido: Content[] = []
  for (const j of informe.jugadores) {
    const suyas = lista.filter((m) => m.jugadorId === j.jugadorId).reverse()
    if (suyas.length === 0) continue
    contenido.push({
      unbreakable: suyas.length <= 15,
      stack: [
        ...(contenido.length === 0
          ? [{ text: 'Detalle por jugador', style: 'seccion', margin: [0, 16, 0, 0] } as Content]
          : []),
        { text: nombreJugador(j), bold: true, margin: [0, 8, 0, 2] },
        {
          fontSize: 9,
          lineHeight: 1,
          table: {
            headerRows: 1,
            widths: [60, '*', 60, 70],
            body: [
              cabecera(['Fecha', 'Motivo', 'Importe', 'Cobrada'], [2, 3]),
              ...suyas.map((m): TableCell[] => [
                fechaCorta(m.fecha),
                m.motivo,
                importe(m.importeCentimos),
                m.fechaPago
                  ? { text: fechaCorta(m.fechaPago), alignment: 'right' }
                  : { text: 'Pendiente', alignment: 'right', bold: true },
              ]),
            ],
          },
          layout: compacta(false),
        },
      ],
    })
  }
  return contenido
}

export async function pdfMultas(
  plantilla: { clubId: string; nombre: string; temporada: string },
  informe: InformeMultas,
  lista: MultaInforme[] | null,
  rango: RangoMultas,
) {
  const contenido: Content[] = [
    { text: textoRango(rango), fontSize: 12, bold: true, margin: [0, 6, 0, 0] },
    { text: `Situación a ${fechaLarga(hoy())}`, style: 'secundario' },
    totales(informe),
    { text: 'Por jugador', style: 'seccion' },
    informe.jugadores.length === 0
      ? { text: 'La plantilla no tiene jugadores.', style: 'secundario' }
      : tablaJugadores(informe),
  ]
  if (lista) {
    contenido.push(
      ...(lista.length === 0
        ? [
            {
              text: 'No hay multas en estas fechas.',
              style: 'secundario',
              margin: [0, 8, 0, 0],
            } as Content,
          ]
        : detalle(informe, lista)),
    )
  }
  const pdf = await generarPdf({
    club: await clubPdf(plantilla.clubId),
    antetitulo: `${plantilla.nombre} · Temporada ${plantilla.temporada}`,
    titulo: 'Multas',
    contenido,
  })
  return { pdf, nombre: `multas-${hoy()}.pdf` }
}
