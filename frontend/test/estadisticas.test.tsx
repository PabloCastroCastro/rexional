import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EstadisticasJugador, EstadisticasPlantilla } from '../src/partidos/datos'
import { abrir, conDatos, json, manejadores, plantilla, senior26 } from './simulacion'

// Estadísticas de la temporada en Partidos y en la ficha del jugador

const fila = (
  jugadorId: string,
  nombre: string,
  dorsal: number,
  datos: Partial<EstadisticasJugador> = {},
): EstadisticasJugador => ({
  jugadorId,
  nombre,
  apellidos: null,
  dorsal,
  activo: true,
  tipo: 'propia',
  procedencia: null,
  partidos: 0,
  titularidades: 0,
  minutos: 0,
  goles: 0,
  asistencias: 0,
  amarillas: 0,
  rojas: 0,
  golesPropia: 0,
  entrenos: 0,
  golesEncajados: 0,
  minutosConEncajados: 0,
  golesFavorEnCampo: 0,
  minutosConFavor: 0,
  ...datos,
})

const ESTADISTICAS: EstadisticasPlantilla = {
  equipo: {
    jugados: 6,
    ganados: 4,
    empatados: 1,
    perdidos: 1,
    golesFavor: 16,
    golesContra: 7,
    sinMinutoEnContra: 0,
    sinMinutoAFavor: 0,
    golesPorMinuto: {
      aFavor: [5, 20, 44, 45, 46, 50, 62, 70, 80, 90, 93],
      enContra: [10, 30, 46, 77, 88],
      aFavorSinMinuto: 5,
      enContraSinMinuto: 2,
    },
  },
  jugadores: [
    fila('j1', 'Íker', 1, { partidos: 6, titularidades: 6, minutos: 540 }),
    fila('j2', 'Brais', 7, { partidos: 5, titularidades: 4, minutos: 410, goles: 2, amarillas: 3 }),
    fila('j3', 'Zoe', 9, {
      partidos: 6,
      titularidades: 6,
      minutos: 520,
      goles: 5,
      asistencias: 1,
      rojas: 1,
    }),
  ],
}

function conEstadisticas(p = senior26, estadisticas = ESTADISTICAS) {
  conDatos({ plantillas: [p] })
  manejadores['GET /api/plantillas/p1/estadisticas'] = () => json(estadisticas)
  manejadores['GET /api/plantillas/p1/partidos'] = () => json([])
}

// Filas de la tabla, celda a celda
const filas = (nombre: string) =>
  within(screen.getByRole('table', { name: nombre }))
    .getAllByRole('row')
    .slice(1)
    .map((fila) => [...fila.querySelectorAll('td, th')].map((celda) => celda.textContent))

const elegir = (estadistica: string) =>
  userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estadística' }), estadistica)

const abrirEstadisticas = async () => {
  abrir('/plantillas/p1/partidos?ver=estadisticas')
  await screen.findByRole('combobox', { name: 'Estadística' })
}

describe('estadísticas de la temporada', () => {
  afterEach(() => {
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
    vi.restoreAllMocks()
  })

  it('resultados del equipo y una tabla por estadística, solo con quien tiene algo', async () => {
    conEstadisticas()
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const resultados = await screen.findByRole('region', { name: 'Resultados' })
    expect(within(resultados).getByText('Ganados').nextSibling).toHaveTextContent('4')
    expect(resultados).toHaveTextContent('Goles: 16 a favor y 7 en contra (+9)')

    // Un desplegable, no un botón por estadística
    expect(screen.queryByRole('button', { name: 'Minutos' })).not.toBeInTheDocument()
    expect(filas('Goles')).toEqual([
      ['9Dorsal 9', 'Zoe', '5'],
      ['7Dorsal 7', 'Brais', '2'],
    ])
    await elegir('Minutos')
    expect(filas('Minutos')).toEqual([
      ['1Dorsal 1', 'Íker', "540'"],
      ['9Dorsal 9', 'Zoe', "520'"],
      ['7Dorsal 7', 'Brais', "410'"],
    ])
    await elegir('Tarjetas')
    // Una roja pesa más que tres amarillas
    expect(filas('Tarjetas')).toEqual([
      ['9Dorsal 9', 'Zoe', '0', '1'],
      ['7Dorsal 7', 'Brais', '3', '0'],
    ])
    await elegir('Asistencias')
    expect(screen.getByRole('link', { name: 'Zoe' })).toHaveAttribute(
      'href',
      '/plantillas/p1/jugadores/j3',
    )
  })

  it('goles del equipo por partes, por tramos y desde un minuto', async () => {
    conEstadisticas()
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const seccion = await screen.findByRole('region', { name: 'Goles por minuto' })
    // El descuento de la 1.ª parte va como 45; el 46, ya en la 2.ª
    expect(filas('Goles por partes y tramos')).toEqual([
      ['1.ª parte', '4', '2'],
      ['2.ª parte', '7', '3'],
      ["0–15'del minuto 0 al 15", '1', '1'],
      ["16–30'del minuto 16 al 30", '1', '1'],
      ["31–45'del minuto 31 al 45", '2', '0'],
      ["46–60'del minuto 46 al 60", '2', '1'],
      ["61–75'del minuto 61 al 75", '2', '0'],
      ["76–90+'del minuto 76 al final", '3', '2'],
    ])
    expect(seccion).toHaveTextContent('Desde el minuto 75: 3 a favor y 2 en contra')
    const campo = within(seccion).getByRole('spinbutton', { name: 'Desde el minuto' })
    await userEvent.clear(campo)
    await userEvent.type(campo, '46')
    expect(seccion).toHaveTextContent('Desde el minuto 46: 7 a favor y 3 en contra')
    await userEvent.type(campo, '0')
    expect(within(seccion).getByRole('alert')).toHaveTextContent('Entre 0 y 150')
    expect(seccion).toHaveTextContent(
      '5 goles a favor y 2 goles en contra no tienen minuto y no cuentan aquí.',
    )
  })

  it('se ordena por cualquier columna, de mayor a menor o al revés', async () => {
    conEstadisticas()
    await abrirEstadisticas()
    await elegir('Minutos')
    const cabecera = (nombre: string) =>
      screen.getByRole('columnheader', { name: new RegExp(`^${nombre}`) })
    expect(cabecera('Minutos')).toHaveAttribute('aria-sort', 'descending')

    await userEvent.click(screen.getByRole('button', { name: 'Minutos' }))
    expect(cabecera('Minutos')).toHaveAttribute('aria-sort', 'ascending')
    expect(filas('Minutos').map((f) => f[1])).toEqual(['Brais', 'Zoe', 'Íker'])

    // Otra columna: el nombre, de la A a la Z; otra vez, al revés
    await userEvent.click(screen.getByRole('button', { name: 'Jugador' }))
    expect(cabecera('Minutos')).not.toHaveAttribute('aria-sort')
    expect(cabecera('Jugador')).toHaveAttribute('aria-sort', 'ascending')
    expect(filas('Minutos').map((f) => f[1])).toEqual(['Brais', 'Íker', 'Zoe'])
    await userEvent.click(screen.getByRole('button', { name: 'Jugador' }))
    expect(filas('Minutos').map((f) => f[1])).toEqual(['Zoe', 'Íker', 'Brais'])

    await userEvent.click(screen.getByRole('button', { name: 'Dorsal' }))
    expect(filas('Minutos').map((f) => f[0])).toEqual(['1Dorsal 1', '7Dorsal 7', '9Dorsal 9'])

    // Al cambiar de estadística vuelve su orden
    await elegir('Goles')
    expect(cabecera('Goles')).toHaveAttribute('aria-sort', 'descending')
  })

  it('minutos por entreno: de más a menos, sin mínimo de minutos y sin entrenos al final', async () => {
    conEstadisticas(senior26, {
      ...ESTADISTICAS,
      jugadores: [
        fila('j1', 'Íker', 1, { partidos: 6, minutos: 540, entrenos: 29 }),
        fila('j2', 'Brais', 7, { partidos: 5, minutos: 340, entrenos: 9 }),
        fila('j3', 'Zoe', 9, { partidos: 1, minutos: 40, entrenos: 0 }),
        fila('j4', 'Noa', 13, { entrenos: 15 }),
        // Ni juega ni entrena: no sale
        fila('j5', 'Leo', 20),
      ],
    })
    await abrirEstadisticas()
    await elegir('Minutos por entreno')
    expect(filas('Minutos por entreno')).toEqual([
      ['7Dorsal 7', 'Brais', "340'", '9', '37,8'],
      ['1Dorsal 1', 'Íker', "540'", '29', '18,6'],
      ['13Dorsal 13', 'Noa', "0'", '15', '0,0'],
      ['9Dorsal 9', 'Zoe', "40'", '0', '—'],
    ])
    // Sin entrenos, al final también de menos a más
    await userEvent.click(screen.getByRole('button', { name: 'Minutos por entreno' }))
    expect(filas('Minutos por entreno').map((f) => f[1])).toEqual(['Noa', 'Íker', 'Brais', 'Zoe'])
  })

  it('goles en contra: de menos a más por 90, y el aviso de los partidos sin minuto', async () => {
    conEstadisticas(senior26, {
      equipo: { ...ESTADISTICAS.equipo, sinMinutoEnContra: 2 },
      jugadores: [
        fila('j1', 'Íker', 1, { minutos: 630, golesEncajados: 5, minutosConEncajados: 630 }),
        fila('j2', 'Brais', 7, { minutos: 302, golesEncajados: 1, minutosConEncajados: 302 }),
        fila('j3', 'Zoe', 9, { minutos: 40, golesEncajados: 0, minutosConEncajados: 40 }),
        fila('j4', 'Noa', 13, { minutos: 90, golesEncajados: 0, minutosConEncajados: 90 }),
        // Solo jugó partidos sin el minuto de los goles en contra: no sale
        fila('j5', 'Leo', 20, { minutos: 90 }),
      ],
    })
    await abrirEstadisticas()
    await elegir('Goles en contra en el campo')
    expect(filas('Goles en contra en el campo')).toEqual([
      ['13Dorsal 13', 'Noa', '0', "90'", '0,00'],
      ['9Dorsal 9', 'Zoe', '0', "40'", '0,00'],
      ['7Dorsal 7', 'Brais', '1', "302'", '0,30'],
      ['1Dorsal 1', 'Íker', '5', "630'", '0,71'],
    ])
    expect(
      within(screen.getByRole('region', { name: 'Jugadores' })).getByRole('note'),
    ).toHaveTextContent('2 partidos no cuentan: les falta el minuto de algún gol en contra.')
  })

  it('goles a favor: de más a menos por 90, y el aviso de los partidos sin minuto', async () => {
    conEstadisticas(senior26, {
      equipo: { ...ESTADISTICAS.equipo, sinMinutoAFavor: 1 },
      jugadores: [
        fila('j1', 'Íker', 1, { golesFavorEnCampo: 9, minutosConFavor: 450 }),
        fila('j2', 'Brais', 7, { golesFavorEnCampo: 4, minutosConFavor: 120 }),
        fila('j3', 'Zoe', 9, { golesFavorEnCampo: 0, minutosConFavor: 30 }),
        // Solo jugó partidos sin el minuto de los goles a favor: no sale
        fila('j4', 'Noa', 13, { minutos: 90 }),
      ],
    })
    await abrirEstadisticas()
    await elegir('Goles a favor en el campo')
    expect(filas('Goles a favor en el campo')).toEqual([
      ['7Dorsal 7', 'Brais', '4', "120'", '3,00'],
      ['1Dorsal 1', 'Íker', '9', "450'", '1,80'],
      ['9Dorsal 9', 'Zoe', '0', "30'", '0,00'],
    ])
    expect(
      within(screen.getByRole('region', { name: 'Jugadores' })).getByRole('note'),
    ).toHaveTextContent('1 partido no cuenta: le falta el minuto de algún gol a favor.')
  })

  it('goles en contra sin ningún partido con el minuto lo explica', async () => {
    conEstadisticas(senior26, {
      ...ESTADISTICAS,
      equipo: { ...ESTADISTICAS.equipo, sinMinutoEnContra: 6 },
    })
    await abrirEstadisticas()
    await elegir('Goles en contra en el campo')
    expect(
      screen.getByText('Todavía no hay partidos con el minuto de los goles en contra.'),
    ).toBeInTheDocument()
  })

  it('minutos por entreno sin haber pasado lista lo explica', async () => {
    conEstadisticas()
    await abrirEstadisticas()
    await elegir('Minutos por entreno')
    expect(screen.getByText('Todavía no se ha pasado lista en ningún entreno.')).toBeInTheDocument()
  })

  it('el cuerpo técnico descarga los datos de la temporada en Excel', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:excel'),
      configurable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true })
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    conEstadisticas()
    manejadores['GET /api/plantillas/p1/exportacion.xlsx'] = () =>
      new Response('PK', {
        headers: {
          'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const exportar = await screen.findByRole('region', { name: 'Exportar' })
    await userEvent.click(within(exportar).getByRole('button', { name: 'Descargar Excel' }))
    await waitFor(() => expect(clic).toHaveBeenCalledTimes(1))
    expect(clic.mock.contexts[0]).toHaveAttribute('download', 'senior-2026-27.xlsx')
  })

  it('sin partidos jugados lo explica', async () => {
    conEstadisticas(senior26, {
      equipo: {
        jugados: 0,
        ganados: 0,
        empatados: 0,
        perdidos: 0,
        golesFavor: 0,
        golesContra: 0,
        sinMinutoEnContra: 0,
        sinMinutoAFavor: 0,
        golesPorMinuto: { aFavor: [], enContra: [], aFavorSinMinuto: 0, enContraSinMinuto: 0 },
      },
      jugadores: [],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    expect(await screen.findByText('Todavía no hay partidos jugados')).toBeInTheDocument()
  })

  it('un jugador ve los resultados y las suyas', async () => {
    conEstadisticas(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), {
      ...ESTADISTICAS,
      jugadores: [
        {
          ...(ESTADISTICAS.jugadores[1] as EstadisticasJugador),
          entrenos: 20,
          golesEncajados: 3,
          minutosConEncajados: 300,
          golesFavorEnCampo: 5,
          minutosConFavor: 360,
        },
      ],
    })
    abrir('/plantillas/p1/partidos?ver=estadisticas')
    const mias = await screen.findByRole('region', { name: 'Tus estadísticas' })
    expect(mias).toHaveTextContent("5 partidos (4 de titular) · 410' · 2 goles · 3 amarillas")
    expect(mias).toHaveTextContent("20,5 minutos por entreno (410' en 20 entrenos)")
    expect(mias).toHaveTextContent("1,25 goles a favor por 90' con él en el campo (5 en 360')")
    expect(mias).toHaveTextContent("0,90 goles en contra por 90' con él en el campo (3 en 300')")
    expect(screen.queryByRole('combobox', { name: 'Estadística' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Exportar' })).not.toBeInTheDocument()
  })
})

// Las casillas de una sección, como { etiqueta: número }
const cifras = (seccion: HTMLElement) =>
  Object.fromEntries(
    within(seccion)
      .getAllByRole('term')
      .map((dt) => [dt.textContent, dt.nextElementSibling?.textContent]),
  )

describe('ficha del jugador', () => {
  function conZoe() {
    manejadores['GET /api/plantillas/p1/jugadores'] = (peticion) =>
      json(
        new URL(peticion.url).searchParams.get('activos') === 'false'
          ? []
          : [
              {
                jugadorId: 'j3',
                nombre: 'Zoe',
                apellidos: null,
                dorsal: 9,
                posicion: null,
                activo: true,
              },
            ],
      )
    manejadores['GET /api/clubes/c1/jugadores/j3'] = () =>
      json({
        id: 'j3',
        nombre: 'Zoe',
        apellidos: null,
        fichas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2026-27',
            dorsal: 9,
            posicion: null,
            activo: true,
          },
          {
            plantillaId: 'p3',
            plantilla: 'Senior',
            categoria: 'sénior',
            temporada: '2025-26',
            dorsal: 9,
            posicion: null,
            activo: true,
          },
          {
            plantillaId: 'p4',
            plantilla: 'Juvenil',
            categoria: 'juvenil',
            temporada: '2024-25',
            dorsal: 9,
            posicion: null,
            activo: true,
          },
        ],
      })
    const totales = {
      partidos: 0,
      titularidades: 0,
      minutos: 0,
      goles: 0,
      asistencias: 0,
      amarillas: 0,
      rojas: 0,
      golesPropia: 0,
    }
    manejadores['GET /api/clubes/c1/jugadores/j3/estadisticas'] = () =>
      json({
        jugadorId: 'j3',
        nombre: 'Zoe',
        apellidos: null,
        temporadas: [
          {
            plantillaId: 'p1',
            plantilla: 'Senior',
            temporada: '2026-27',
            dorsal: 9,
            ...totales,
            partidos: 6,
            goles: 5,
            asistencias: 1,
          },
          {
            plantillaId: 'p3',
            plantilla: 'Senior',
            temporada: '2025-26',
            dorsal: 9,
            ...totales,
            partidos: 10,
            goles: 2,
          },
          { plantillaId: 'p4', plantilla: 'Juvenil', temporada: '2024-25', dorsal: 9, ...totales },
        ],
        totales: { ...totales, partidos: 6, goles: 5, asistencias: 1 },
      })
  }

  it('sus partidos en la plantilla, en casillas, y los números de cada temporada', async () => {
    conEstadisticas()
    conZoe()
    abrir('/plantillas/p1/jugadores/j3')
    const partidos = await screen.findByRole('region', { name: 'Partidos' })
    expect(cifras(partidos)).toEqual({
      Partidos: '6',
      'De titular': '6',
      Minutos: '520',
      Goles: '5',
      Asistencias: '1',
      Amarillas: '0',
      Rojas: '1',
    })
    // Dos filas: arriba lo jugado, abajo lo que ha hecho en el campo
    expect(
      [...partidos.querySelectorAll('dl')].map((dl) =>
        [...dl.querySelectorAll('dt')].map((dt) => dt.textContent),
      ),
    ).toEqual([
      ['Partidos', 'De titular', 'Minutos'],
      ['Goles', 'Asistencias', 'Amarillas', 'Rojas'],
    ])
    // A cero, en el color suave pero en su sitio
    expect(within(partidos).getByText('Amarillas').parentElement).toHaveAttribute('data-vacia')
    expect(within(partidos).getByText('Goles').parentElement).not.toHaveAttribute('data-vacia')

    const temporadas = screen.getByRole('region', { name: 'Temporadas' })
    // Las anteriores, con sus cifras; la actual, marcada y sin repetir las de arriba
    expect(await within(temporadas).findByText('10 PJ · 2 G · 0 A')).toBeInTheDocument()
    expect(temporadas).toHaveTextContent('10 partidos, 2 goles, 0 asistencias')
    const [actual] = within(temporadas).getAllByRole('listitem')
    expect(actual).toHaveTextContent('Actual')
    expect(actual).not.toHaveTextContent('PJ')
    // La temporada sin partidos no lleva la línea de cifras
    expect(within(temporadas).getAllByRole('listitem')[2]).not.toHaveTextContent('PJ')
  })

  it('sin partidos jugados, las mismas casillas a cero', async () => {
    conEstadisticas(senior26, { ...ESTADISTICAS, jugadores: [] })
    conZoe()
    abrir('/plantillas/p1/jugadores/j3')
    const partidos = await screen.findByRole('region', { name: 'Partidos' })
    expect(Object.keys(cifras(partidos))).toEqual([
      'Partidos',
      'De titular',
      'Minutos',
      'Goles',
      'Asistencias',
      'Amarillas',
      'Rojas',
    ])
    expect(new Set(Object.values(cifras(partidos)))).toEqual(new Set(['0']))
    expect(partidos).not.toHaveTextContent('Todavía sin partidos')
  })
})
