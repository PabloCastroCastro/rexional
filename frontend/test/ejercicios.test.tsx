import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ejercicio, Medio, ResumenEjercicio } from '../src/ejercicios/datos'
import {
  abrir,
  conDatos,
  json,
  manejadores,
  peticiones,
  plantilla,
  ruta,
  senior26,
} from './simulacion'

// Biblioteca de ejercicios del club, en la pestaña Entrenos

afterEach(() => vi.unstubAllGlobals())

const resumen = (
  id: string,
  nombre: string,
  extra: Partial<ResumenEjercicio> = {},
): ResumenEjercicio => ({
  id,
  nombre,
  categoria: null,
  duracionMin: null,
  etiquetas: [],
  archivado: false,
  medios: 0,
  urlMiniatura: null,
  ...extra,
})

const medio = (id: string, extra: Partial<Medio>): Medio => ({
  id,
  tipo: 'foto',
  estado: 'listo',
  mime: 'image/webp',
  tamanoBytes: 1000,
  duracionSeg: null,
  pie: null,
  orden: 0,
  url: null,
  urlArchivo: `/api/medios/${id}`,
  urlMiniatura: `/api/medios/${id}/miniatura`,
  ...extra,
})

const RONDO: Ejercicio = {
  id: 'e1',
  nombre: 'Rondo 4 contra 1',
  categoria: 'calentamiento',
  duracionMin: 10,
  etiquetas: ['posesión'],
  archivado: false,
  descripcion: 'Cuadrado de 6×6 m',
  jugadores: '5',
  material: 'Conos',
  usos: 0,
  enPlantilla: { entrenos: 3, ultimo: '2026-10-15' },
  medios: [
    medio('m1', { pie: 'Colocación' }),
    medio('m2', { tipo: 'video', mime: 'video/mp4', orden: 1, duracionSeg: 30 }),
    medio('m3', {
      tipo: 'enlace',
      url: 'https://www.youtube.com/watch?v=abc',
      urlArchivo: null,
      urlMiniatura: null,
      orden: 2,
    }),
    medio('m4', {
      tipo: 'video',
      estado: 'procesando',
      urlArchivo: null,
      urlMiniatura: null,
      orden: 3,
    }),
  ],
}

// Los grupos de la biblioteca (GH-274), cada uno con su lista. Por selector: las consultas por rol
// con nombre sobre toda la página son lentas en jsdom; el nombre accesible se comprueba aparte
const grupos = () => [
  ...document.querySelectorAll<HTMLElement>('section[aria-labelledby^="grupo-"]'),
]
const enlacesBiblioteca = () => grupos().flatMap((g) => within(g).getAllByRole('link'))

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const BASE = '/api/clubes/c1/ejercicios'

function conBiblioteca(
  p = senior26,
  lista: ResumenEjercicio[] = [
    resumen('e1', 'Rondo 4 contra 1', {
      categoria: 'calentamiento',
      duracionMin: 10,
      etiquetas: ['posesión'],
      medios: 4,
      urlMiniatura: '/api/medios/m1/miniatura',
    }),
  ],
  ejercicio = RONDO,
) {
  conDatos({ plantillas: [p] })
  let actual = ejercicio
  manejadores[`GET ${BASE}`] = () => json(lista)
  manejadores[`GET ${BASE}/etiquetas`] = () => json(['posesión', 'presión'])
  manejadores[`GET ${BASE}/e1`] = () => json(actual)
  manejadores['GET /api/medios/limites'] = () =>
    json({ maxFotoBytes: 15 * 1024 * 1024, maxVideoBytes: 150 * 1024 * 1024 })
  manejadores[`POST ${BASE}`] = async (peticion) =>
    json({ ...RONDO, ...((await peticion.json()) as object), id: 'e2', medios: [] }, 201)
  manejadores[`PATCH ${BASE}/e1`] = async (peticion) => {
    actual = { ...actual, ...((await peticion.json()) as object) }
    return json(actual)
  }
  manejadores[`PUT ${BASE}/e1/medios/orden`] = async (peticion) => {
    const { medios } = (await peticion.json()) as { medios: string[] }
    actual = {
      ...actual,
      medios: medios.map((id) => actual.medios.find((m) => m.id === id) as Medio),
    }
    return json(actual)
  }
}

describe('lista de ejercicios', () => {
  it('se busca y se filtra; los filtros van en la dirección', async () => {
    conBiblioteca()
    const router = abrir('/plantillas/p1/entrenos/ejercicios')
    await screen.findByText('Rondo 4 contra 1')
    const lista = within(grupos()[0] as HTMLElement).getByRole('list')
    expect(lista).toHaveAccessibleName('Calentamiento 1 ejercicio')
    // La categoría la dice el grupo: en la fila, la duración y las etiquetas
    expect(within(lista).getByRole('link')).toHaveTextContent("Rondo 4 contra 110'posesión")
    // La miniatura es decorativa (alt vacío): no tiene rol de imagen
    expect(lista.querySelector('img')).toHaveAttribute('src', '/api/medios/m1/miniatura')

    // Categoría, etiqueta y archivados, en la hoja «Filtros» (GH-272)
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }))
    const hoja = screen.getByRole('dialog', { name: 'Filtros' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Táctica' }))
    expect(within(hoja).getByRole('button', { name: 'Táctica' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(hoja).getByRole('button', { name: 'presión' }))
    await userEvent.click(within(hoja).getByRole('switch', { name: 'Mostrar archivados' }))
    await userEvent.click(within(hoja).getByRole('button', { name: 'Ver 1 ejercicio' }))
    expect(screen.getByRole('button', { name: 'Filtros (3)' })).toBeInTheDocument()
    // La búsqueda se aplica al dejar de escribir
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar ejercicio' }), 'rondo')
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).toString()).toBe(
        'categoria=tactica&etiqueta=presi%C3%B3n&archivados=si&q=rondo',
      ),
    )
  })

  it('sin foto, la miniatura es el icono de la categoría; con foto, la foto (GH-273)', async () => {
    conBiblioteca(senior26, [
      resumen('e1', 'Rondo 4 contra 1', { categoria: 'calentamiento', urlMiniatura: '/m1' }),
      resumen('e2', 'Salida de balón', { categoria: 'tactica' }),
      resumen('e3', 'Movilidad articular y carrera continua suave'),
    ])
    abrir('/plantillas/p1/entrenos/ejercicios')
    await screen.findByText('Rondo 4 contra 1')
    const enlaces = enlacesBiblioteca()
    const miniatura = (i: number) => enlaces[i]?.firstElementChild as HTMLElement
    expect(miniatura(0).tagName).toBe('IMG')
    expect(miniatura(1)).toHaveAttribute('data-categoria', 'tactica')
    expect(miniatura(1)).toHaveAttribute('aria-hidden', 'true')
    expect(miniatura(1).style.getPropertyValue('--color-categoria')).toBe(
      'var(--color-cat-tactica)',
    )
    expect(miniatura(1).querySelector('svg')).not.toBeNull()
    expect(miniatura(2)).toHaveAttribute('data-categoria', 'ninguna')
    // El nombre entero está en el DOM: lo corta el CSS a dos líneas, no el texto
    expect(enlaces[2]).toHaveTextContent('Movilidad articular y carrera continua suave')
  })

  it('agrupada por categoría en el orden de una sesión, con cuántos tiene cada grupo (GH-274)', async () => {
    const todos = [
      resumen('e1', 'Carrera continua', { categoria: 'calentamiento' }),
      resumen('e2', 'Conducción en zigzag', { categoria: 'tecnica' }),
      resumen('e3', 'Estiramientos', { categoria: 'vuelta_calma' }),
      resumen('e4', 'Juego de posición'),
      resumen('e5', 'Movilidad articular', { categoria: 'calentamiento' }),
      resumen('e6', 'Partido a dos toques', { categoria: 'partido' }),
      resumen('e7', 'Remate de cabeza', { categoria: 'finalizacion' }),
      resumen('e8', 'Salida de balón', { categoria: 'tactica' }),
      resumen('e9', 'Series de 30 m', { categoria: 'fisico' }),
    ]
    conBiblioteca(senior26, todos)
    // Como el servidor: con una categoría elegida solo llegan los suyos
    manejadores[`GET ${BASE}`] = (peticion) => {
      const categoria = new URL(peticion.url).searchParams.get('categoria')
      return json(categoria ? todos.filter((e) => e.categoria === categoria) : todos)
    }
    abrir('/plantillas/p1/entrenos/ejercicios')
    await screen.findByText('Carrera continua')
    expect(grupos()[0]).toHaveAccessibleName('Calentamiento 2 ejercicios')
    expect(grupos().map((g) => g.querySelector('h2')?.textContent)).toEqual([
      'Calentamiento 2 ejercicios',
      'Técnica 1 ejercicio',
      'Táctica 1 ejercicio',
      'Finalización 1 ejercicio',
      'Físico 1 ejercicio',
      'Partido 1 ejercicio',
      'Vuelta a la calma 1 ejercicio',
      'Sin categoría 1 ejercicio',
    ])
    // Dentro de cada grupo, por nombre (el orden en que los manda el servidor)
    const calentamiento = within(grupos()[0] as HTMLElement).getAllByRole('link')
    expect(calentamiento.map((l) => l.querySelector('strong')?.textContent)).toEqual([
      'Carrera continua',
      'Movilidad articular',
    ])
    // Las categorías de «Filtros» siguen el mismo orden
    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }))
    const hoja = screen.getByRole('dialog', { name: 'Filtros' })
    const categorias = within(within(hoja).getByRole('group', { name: 'Categoría' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(categorias.slice(0, 5)).toEqual([
      'Calentamiento',
      'Técnica',
      'Táctica',
      'Finalización',
      'Físico',
    ])

    // Con una categoría elegida, solo su grupo
    await userEvent.click(within(hoja).getByRole('button', { name: 'Táctica' }))
    await waitFor(() =>
      expect(grupos().map((g) => g.querySelector('h2')?.textContent)).toEqual([
        'Táctica 1 ejercicio',
      ]),
    )
  })

  it('los filtros se leen de la dirección, se ven puestos y se quitan uno a uno o todos', async () => {
    conBiblioteca()
    const router = abrir(
      '/plantillas/p1/entrenos/ejercicios?categoria=tactica&etiqueta=presi%C3%B3n&archivados=si',
    )
    const parametros = () => new URLSearchParams(router.state.location.search).toString()
    // En la fila del buscador, «Filtros» con cuántos hay y «＋» para crear
    expect(await screen.findByRole('button', { name: 'Nuevo ejercicio' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filtros (3)' })).toBeInTheDocument()
    // Debajo, los puestos; tocar uno lo quita
    const puestos = screen.getByRole('list', { name: 'Filtros puestos' })
    expect(
      within(puestos)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Táctica', 'presión', 'Archivados'])
    await userEvent.click(within(puestos).getByRole('button', { name: 'Quitar el filtro Táctica' }))
    await waitFor(() => expect(parametros()).toBe('etiqueta=presi%C3%B3n&archivados=si'))

    await userEvent.click(screen.getByRole('button', { name: 'Filtros (2)' }))
    const hoja = screen.getByRole('dialog', { name: 'Filtros' })
    expect(within(hoja).getByRole('button', { name: 'Táctica' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(hoja).getByRole('button', { name: 'presión' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(hoja).getByRole('switch', { name: 'Mostrar archivados' })).toBeChecked()
    await userEvent.click(within(hoja).getByRole('button', { name: 'Quitar filtros' }))
    await waitFor(() => expect(parametros()).toBe(''))
    expect(within(hoja).getByRole('button', { name: 'Quitar filtros' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Filtros puestos' })).not.toBeInTheDocument()
  })

  it('el cuerpo técnico crea un ejercicio y va a su ficha', async () => {
    conBiblioteca()
    const router = abrir('/plantillas/p1/entrenos/ejercicios')
    await userEvent.click(await screen.findByRole('button', { name: 'Nuevo ejercicio' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo ejercicio' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear ejercicio' }))
    expect(within(hoja).getByText('Escribe el nombre del ejercicio')).toBeInTheDocument()
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Presión tras pérdida')
    await userEvent.selectOptions(within(hoja).getByLabelText('Categoría'), 'tactica')
    await userEvent.type(within(hoja).getByLabelText('Duración (min)'), '15')
    await userEvent.type(within(hoja).getByLabelText('Etiquetas'), 'presión, transición')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear ejercicio' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/entrenos/ejercicios/e2'))
    expect(enviado(`POST ${BASE}`)).toEqual([
      {
        nombre: 'Presión tras pérdida',
        categoria: 'tactica',
        duracionMin: 15,
        jugadores: null,
        material: null,
        descripcion: null,
        etiquetas: ['presión', 'transición'],
      },
    ])
  })

  it('un jugador consulta, pero no crea', async () => {
    conBiblioteca(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }), [])
    abrir('/plantillas/p1/entrenos/ejercicios')
    expect(await screen.findByText('La biblioteca está vacía')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nuevo ejercicio' })).not.toBeInTheDocument()
  })
})

describe('ficha del ejercicio', () => {
  it('muestra fotos, vídeos, enlaces y lo que se está procesando', async () => {
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const galeria = await screen.findByRole('list', { name: 'Fotos, vídeos y enlaces' })
    expect(within(galeria).getByRole('img', { name: 'Colocación' })).toHaveAttribute(
      'src',
      '/api/medios/m1',
    )
    expect(galeria.querySelector('video source')).toHaveAttribute('src', '/api/medios/m2')
    expect(within(galeria).getByRole('link', { name: /youtube\.com/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abc',
    )
    expect(within(galeria).getByRole('status')).toHaveTextContent('Procesando el vídeo')
    expect(screen.getByText('Cuadrado de 6×6 m')).toBeInTheDocument()
  })

  it('primero ver: sin controles alrededor, cada uno con su «⋯» y el enlace con su título (GH-276)', async () => {
    const enlace = medio('m3', {
      tipo: 'enlace',
      url: 'https://www.youtube.com/watch?v=abc',
      urlArchivo: null,
      urlMiniatura: null,
      pie: 'Vídeos de ejemplo del rondo',
      orden: 1,
    })
    conBiblioteca(senior26, undefined, {
      ...RONDO,
      medios: [medio('m1', { pie: 'Colocación' }), enlace],
    })
    manejadores[`PATCH ${BASE}/e1/medios/m1`] = () => json(medio('m1', { pie: 'Inicio' }))
    manejadores[`DELETE ${BASE}/e1/medios/m3`] = () => new Response(null, { status: 204 })
    manejadores[`POST ${BASE}/e1/medios/enlace`] = () => json(enlace, 201)
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const galeria = await screen.findByRole('list', { name: 'Fotos, vídeos y enlaces' })
    // En la galería solo hay «⋯»: ni flechas, ni lápiz, ni papelera
    expect(
      within(galeria)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual([
      'Opciones de la foto «Colocación»',
      'Opciones del enlace «Vídeos de ejemplo del rondo»',
    ])
    // El enlace lleva su título dentro y la web debajo
    expect(
      within(galeria).getByRole('link', { name: 'Vídeos de ejemplo del rondo youtube.com' }),
    ).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc')

    // Cambiar el título
    await userEvent.click(
      within(galeria).getByRole('button', { name: 'Opciones de la foto «Colocación»' }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Foto' })).getByRole('button', {
        name: 'Cambiar el título',
      }),
    )
    const titulo = screen.getByRole('dialog', { name: 'Título' })
    await userEvent.clear(within(titulo).getByLabelText('Título'))
    await userEvent.type(within(titulo).getByLabelText('Título'), 'Inicio')
    await userEvent.click(within(titulo).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(enviado(`PATCH ${BASE}/e1/medios/m1`)).toEqual([{ pie: 'Inicio' }]))

    // Quitar, en rojo y con confirmación
    await userEvent.click(
      within(galeria).getByRole('button', {
        name: 'Opciones del enlace «Vídeos de ejemplo del rondo»',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Enlace' })).getByRole('button', {
        name: 'Quitar',
      }),
    )
    await userEvent.click(
      within(screen.getByRole('alertdialog', { name: '¿Quitar el enlace?' })).getByRole('button', {
        name: 'Quitar',
      }),
    )
    expect(await screen.findByText('Enlace quitado')).toBeInTheDocument()

    // Al final, un único botón para añadir, que deja elegir
    await userEvent.click(screen.getByRole('button', { name: 'Añadir foto, vídeo o enlace' }))
    const elegir = screen.getByRole('dialog', { name: 'Añadir foto, vídeo o enlace' })
    expect(within(elegir).getByRole('button', { name: 'Subir foto o vídeo' })).toBeInTheDocument()
    await userEvent.click(within(elegir).getByRole('button', { name: 'Pegar un enlace' }))
    const formulario = screen.getByRole('dialog', { name: 'Añadir enlace' })
    await userEvent.type(
      within(formulario).getByLabelText('Dirección'),
      'https://www.youtube.com/watch?v=abc',
    )
    await userEvent.type(
      within(formulario).getByLabelText('Título (opcional)'),
      'Vídeos de ejemplo',
    )
    await userEvent.click(within(formulario).getByRole('button', { name: /Añadir/ }))
    await waitFor(() =>
      expect(enviado(`POST ${BASE}/e1/medios/enlace`)).toEqual([
        { url: 'https://www.youtube.com/watch?v=abc', pie: 'Vídeos de ejemplo' },
      ]),
    )
  })

  it('con uno solo, su «⋯» no tiene nada que mover (GH-276)', async () => {
    conBiblioteca(senior26, undefined, { ...RONDO, medios: [medio('m1', { pie: 'Colocación' })] })
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Opciones de la foto «Colocación»' }),
    )
    const hoja = screen.getByRole('dialog', { name: 'Foto' })
    expect(
      within(hoja)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['', 'Cambiar el título', 'Quitar'])
  })

  it('reordena y archiva', async () => {
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    // Cada foto, vídeo o enlace se mueve desde su «⋯» (GH-276)
    await userEvent.click(
      await screen.findByRole('button', { name: 'Opciones de la foto «Colocación»' }),
    )
    const foto = screen.getByRole('dialog', { name: 'Foto' })
    expect(within(foto).getByRole('button', { name: 'Mover arriba' })).toBeDisabled()
    await userEvent.click(within(foto).getByRole('button', { name: 'Mover abajo' }))
    await waitFor(() =>
      expect(enviado(`PUT ${BASE}/e1/medios/orden`)).toEqual([
        { medios: ['m2', 'm1', 'm3', 'm4'] },
      ]),
    )
    // La hoja sigue abierta para seguir moviendo; ya no es la primera
    await waitFor(() =>
      expect(within(foto).getByRole('button', { name: 'Mover arriba' })).toBeEnabled(),
    )
    await userEvent.click(within(foto).getByRole('button', { name: 'Cerrar' }))
    // Archivar, en «⋯» (GH-275)
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del ejercicio' }))
    const hoja = screen.getByRole('dialog', { name: 'Opciones del ejercicio' })
    await userEvent.click(within(hoja).getByRole('button', { name: 'Archivar' }))
    expect(await screen.findByText('Ejercicio archivado')).toBeInTheDocument()
    expect(enviado(`PATCH ${BASE}/e1`)).toEqual([{ archivado: true }])
    expect(await screen.findByText('Archivado')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del ejercicio' }))
    expect(within(hoja).getByRole('button', { name: 'Desarchivar' })).toBeInTheDocument()
  })

  it('lápiz y «⋯» junto al título, la categoría como chip y los datos en casillas (GH-275)', async () => {
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const titulo = await screen.findByRole('heading', { name: 'Rondo 4 contra 1' })
    const fila = titulo.parentElement as HTMLElement
    expect(
      within(fila)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Editar', 'Opciones del ejercicio'])
    // Debajo del título, la categoría con su color y las etiquetas
    const chip = screen.getByText('Calentamiento')
    expect(chip.style.getPropertyValue('--color-chip')).toBe('var(--color-cat-calentamiento)')
    expect(chip.querySelector('svg')).not.toBeNull()
    expect(screen.getByText('posesión')).toBeInTheDocument()
    // Minutos y jugadores en casillas; el material, a lo ancho
    const casillas = [...document.querySelectorAll('dl > div')].map((d) => [
      d.querySelector('dt')?.textContent,
      d.querySelector('dd')?.textContent,
      d.hasAttribute('data-ancha'),
    ])
    expect(casillas).toEqual([
      ['Minutos', '10', false],
      ['Jugadores', '5', false],
      ['Material', 'Conos', true],
    ])
    // Duplicar va en «⋯» y lleva a la copia
    manejadores[`POST ${BASE}/e1/duplicar`] = () =>
      json({ ...RONDO, id: 'e2', nombre: 'Rondo 4 contra 1 (copia)' }, 201)
    await userEvent.click(screen.getByRole('button', { name: 'Opciones del ejercicio' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Opciones del ejercicio' })).getByRole('button', {
        name: 'Duplicar',
      }),
    )
    expect(await screen.findByText('Copia creada: «Rondo 4 contra 1 (copia)»')).toBeInTheDocument()
  })

  it('en cuántos entrenos de la plantilla se ha usado y cuándo fue el último (GH-277)', async () => {
    conBiblioteca()
    const urls: string[] = []
    manejadores[`GET ${BASE}/e1`] = (peticion) => {
      urls.push(peticion.url)
      return json(RONDO)
    }
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    // Entre la explicación y las fotos
    const uso = await screen.findByText('Usado en 3 entrenos · el último, jueves 15 oct')
    expect(screen.getByText('Cuadrado de 6×6 m').compareDocumentPosition(uso)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(
      uso.compareDocumentPosition(screen.getByRole('heading', { name: 'Fotos, vídeos y enlaces' })),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    // Solo los entrenos de la plantilla activa
    expect(new URL(urls[0] ?? '').searchParams.get('plantilla')).toBe('p1')
  })

  it.each([
    [{ entrenos: 0, ultimo: null }, 'Todavía no se ha usado en ningún entreno'],
    [{ entrenos: 1, ultimo: '2026-10-08' }, 'Usado en 1 entreno · el último, jueves 8 oct'],
    [{ entrenos: 2, ultimo: null }, 'Planificado en 2 entrenos; todavía no se ha hecho'],
  ])('uso %o: «%s» (GH-277)', async (enPlantilla, texto) => {
    conBiblioteca(senior26, undefined, { ...RONDO, enPlantilla })
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    expect(await screen.findByText(texto)).toBeInTheDocument()
  })

  it('una casilla sin dato no se muestra (GH-275)', async () => {
    conBiblioteca(senior26, undefined, {
      ...RONDO,
      categoria: null,
      duracionMin: null,
      jugadores: null,
      material: 'Petos',
    })
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    expect(await screen.findByText('Sin categoría')).toBeInTheDocument()
    expect([...document.querySelectorAll('dl > div > dt')].map((d) => d.textContent)).toEqual([
      'Material',
    ])
  })

  it('avisa antes de subir de las HEIC y de lo que pasa del límite, y sube lo demás', async () => {
    const envios: FormData[] = []
    // XMLHttpRequest simulado: la subida va al momento con progreso
    class SubidaFalsa {
      upload: {
        onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void
      } = {}
      onload?: () => void
      status = 201
      response = medio('m9', {})
      responseType = ''
      open() {}
      abort() {}
      send(cuerpo: FormData) {
        envios.push(cuerpo)
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 })
        setTimeout(() => this.onload?.(), 0)
      }
    }
    vi.stubGlobal('XMLHttpRequest', SubidaFalsa)
    conBiblioteca()
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    const entrada = await screen.findByLabelText('Fotos o vídeos del ejercicio')
    const heic = new File(['x'], 'IMG_1.HEIC', { type: 'image/heic' })
    const enorme = new File(['x'], 'largo.mp4', { type: 'video/mp4' })
    Object.defineProperty(enorme, 'size', { value: 200 * 1024 * 1024 })
    const buena = new File(['x'], 'campo.jpg', { type: 'image/jpeg' })
    await userEvent.upload(entrada, [heic, enorme, buena], { applyAccept: false })
    const subidas = await screen.findByRole('list', { name: 'Subidas' })
    expect(await within(subidas).findByText(/HEIC no se admiten/)).toBeInTheDocument()
    expect(
      within(subidas).getByText('Pesa 200 MB y el máximo para vídeos es 150 MB'),
    ).toBeInTheDocument()
    await waitFor(() => expect(envios).toHaveLength(1))
    expect(((envios[0] as FormData).get('archivo') as File).name).toBe('campo.jpg')
    // Los avisos se cierran
    await userEvent.click(
      within(subidas).getByRole('button', { name: 'Cerrar aviso de IMG_1.HEIC' }),
    )
    expect(within(subidas).queryByText(/HEIC/)).not.toBeInTheDocument()
  })

  it('sin permiso no hay herramientas; con usos no se puede borrar', async () => {
    conBiblioteca(plantilla('p1', 'Senior', '2026-27', { rol: 'jugador', esAdminClub: false }))
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    await screen.findByRole('list', { name: 'Fotos, vídeos y enlaces' })
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Opciones del ejercicio' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Quitar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Opciones (de la|del) / })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Añadir foto, vídeo o enlace' }),
    ).not.toBeInTheDocument()
  })

  it('un ejercicio usado no se puede borrar, solo archivar', async () => {
    conBiblioteca(senior26, undefined, { ...RONDO, usos: 2 })
    abrir('/plantillas/p1/entrenos/ejercicios/e1')
    await userEvent.click(await screen.findByRole('button', { name: 'Opciones del ejercicio' }))
    const hoja = screen.getByRole('dialog', { name: 'Opciones del ejercicio' })
    expect(within(hoja).getByRole('button', { name: 'Archivar' })).toBeInTheDocument()
    expect(within(hoja).queryByRole('button', { name: 'Borrar' })).not.toBeInTheDocument()
  })
})
