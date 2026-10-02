import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, datos, ErrorApi } from '../src/api/cliente'
import { type Plantilla, temporadaDe } from '../src/plantillas/datos'
import { crearClienteConsultas, Proveedores } from '../src/proveedores'
import { rutas } from '../src/rutas'

// --- API simulada: cada prueba define qué responde cada "MÉTODO /ruta" ---

type Manejador = (peticion: Request) => Response | Promise<Response>

const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })

let manejadores: Record<string, Manejador> = {}
const peticiones: { clave: string; cuerpo: unknown }[] = []

beforeEach(() => {
  manejadores = {}
  peticiones.length = 0
  localStorage.clear()
  sessionStorage.clear()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (entrada, opciones) => {
    const peticion =
      entrada instanceof Request
        ? entrada
        : new Request(new URL(String(entrada), 'http://localhost:3000'), opciones)
    const clave = `${peticion.method} ${new URL(peticion.url).pathname}`
    const texto = await peticion.clone().text()
    peticiones.push({ clave, cuerpo: texto ? JSON.parse(texto) : undefined })
    const manejador = manejadores[clave]
    return manejador
      ? manejador(peticion)
      : json({ error: { codigo: 'no_encontrado', mensaje: clave } }, 404)
  })
})

afterEach(() => vi.restoreAllMocks())

const USUARIO = { id: 'u1', name: 'Ana Administradora', email: 'admin@rexional.test' }
const sesionActiva = () => json({ user: USUARIO, session: { expiresAt: '2026-11-01T00:00:00Z' } })
const sinSesion = () => json(null)

const clubRexional = {
  id: 'c1',
  nombre: 'CD Rexional',
  escudo: null,
  colorPrincipal: '#14553d',
  colorSecundario: '#f2c230',
}

const plantilla = (
  id: string,
  nombre: string,
  temporada: string,
  extra: Partial<Plantilla> = {},
): Plantilla => ({
  id,
  clubId: 'c1',
  nombre,
  categoria: nombre === 'Juvenil' ? 'juvenil' : 'sénior',
  temporada,
  plantillaAnteriorId: null,
  rol: 'admin',
  esAdminClub: true,
  club: clubRexional,
  ...extra,
})

const senior26 = plantilla('p1', 'Senior', '2026-27')
const juvenil26 = plantilla('p2', 'Juvenil', '2026-27')
const senior25 = plantilla('p3', 'Senior', '2025-26')

function conDatos({
  plantillas,
  administra = true,
}: {
  plantillas: Plantilla[]
  administra?: boolean
}) {
  manejadores['GET /api/auth/get-session'] = sesionActiva
  manejadores['GET /api/plantillas'] = () => json(plantillas)
  manejadores['GET /api/clubes'] = () => json([{ ...clubRexional, esAdmin: administra }])
}

function abrir(ruta: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [ruta] })
  render(
    <Proveedores cliente={crearClienteConsultas()}>
      <RouterProvider router={router} />
    </Proveedores>,
  )
  return router
}

const ruta = (router: ReturnType<typeof abrir>) => router.state.location.pathname

describe('login', () => {
  it('sin sesión cualquier página lleva al login', async () => {
    manejadores['GET /api/auth/get-session'] = sinSesion
    const router = abrir('/p/p1/entrenos')
    expect(await screen.findByLabelText(/Email/)).toBeInTheDocument()
    expect(ruta(router)).toBe('/login')
  })

  it('con datos incorrectos muestra el error', async () => {
    manejadores['GET /api/auth/get-session'] = sinSesion
    manejadores['POST /api/auth/sign-in/email'] = () =>
      json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, 401)
    abrir('/login')
    await userEvent.type(await screen.findByLabelText(/Email/), 'admin@rexional.test')
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'mala')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El email o la contraseña no son correctos',
    )
  })

  it('con demasiados intentos pide esperar', async () => {
    manejadores['GET /api/auth/get-session'] = sinSesion
    manejadores['POST /api/auth/sign-in/email'] = () => json({}, 429)
    abrir('/login')
    await userEvent.type(await screen.findByLabelText(/Email/), 'a@b.test')
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Espera un minuto')
  })

  it('al entrar con una sola plantilla va directamente a ella y devuelve a donde se estaba', async () => {
    let conectado = false
    manejadores['GET /api/auth/get-session'] = () => (conectado ? sesionActiva() : sinSesion())
    manejadores['POST /api/auth/sign-in/email'] = async (peticion) => {
      expect(await peticion.json()).toEqual({
        email: 'admin@rexional.test',
        password: 'vestuario-dev',
      })
      conectado = true
      return json({ user: USUARIO })
    }
    manejadores['GET /api/plantillas'] = () => json([senior26])
    manejadores['GET /api/clubes'] = () => json([{ ...clubRexional, esAdmin: true }])

    const router = abrir('/')
    await userEvent.type(await screen.findByLabelText(/Email/), ' admin@rexional.test ')
    await userEvent.type(screen.getByLabelText(/Contraseña/), 'vestuario-dev')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(
      await screen.findByRole('button', { name: /Plantilla Senior, temporada 2026-27/ }),
    ).toBeInTheDocument()
    expect(ruta(router)).toBe('/p/p1/plantilla')
  })

  it('el botón muestra y oculta la contraseña', async () => {
    manejadores['GET /api/auth/get-session'] = sinSesion
    abrir('/login')
    const campo = await screen.findByLabelText(/Contraseña/)
    expect(campo).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar la contraseña' }))
    expect(campo).toHaveAttribute('type', 'text')
  })
})

describe('elegir la plantilla', () => {
  it('con varias muestra el selector agrupado por temporada, la más reciente primero', async () => {
    conDatos({ plantillas: [juvenil26, senior26, senior25] })
    const router = abrir('/')
    expect(await screen.findByRole('heading', { name: 'Elige la plantilla' })).toBeInTheDocument()
    expect(ruta(router)).toBe('/plantillas')
    const temporadas = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(temporadas).toEqual(['Temporada 2026-27', 'Temporada 2025-26'])

    await userEvent.click(screen.getByRole('button', { name: /Juvenil/ }))
    expect(ruta(router)).toBe('/p/p2/plantilla')
  })

  it('entra directamente en la última plantilla usada', async () => {
    conDatos({ plantillas: [juvenil26, senior26] })
    localStorage.setItem('vestuario:ultima-plantilla:u1', 'p2')
    const router = abrir('/')
    expect(await screen.findByRole('button', { name: /Plantilla Juvenil/ })).toBeInTheDocument()
    expect(ruta(router)).toBe('/p/p2/plantilla')
  })

  it('cambia de plantilla desde la cabecera manteniendo la sección', async () => {
    conDatos({ plantillas: [juvenil26, senior26, senior25] })
    const router = abrir('/p/p1/entrenos')
    await userEvent.click(await screen.findByRole('button', { name: /Cambiar de plantilla/ }))
    const hoja = screen.getByRole('dialog', { name: 'Cambiar de plantilla' })
    expect(within(hoja).getByRole('button', { name: /Senior/, current: true })).toBeInTheDocument()

    await userEvent.click(within(hoja).getAllByRole('button', { name: /Senior/ })[1] as HTMLElement)
    expect(ruta(router)).toBe('/p/p3/entrenos')
    expect(
      screen.getByRole('button', { name: /Plantilla Senior, temporada 2025-26/ }),
    ).toBeInTheDocument()
    expect(localStorage.getItem('vestuario:ultima-plantilla:u1')).toBe('p3')
  })

  it('una plantilla sin acceso muestra el aviso y el enlace al selector', async () => {
    conDatos({ plantillas: [senior26] })
    abrir('/p/otra/plantilla')
    expect(
      await screen.findByRole('heading', { name: 'No tienes acceso a esta plantilla' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Elegir otra plantilla' })).toHaveAttribute(
      'href',
      '/plantillas',
    )
  })

  it('sin plantillas ni club que administrar lo explica', async () => {
    conDatos({ plantillas: [], administra: false })
    abrir('/')
    expect(
      await screen.findByRole('heading', { name: 'Todavía no tienes acceso a ninguna plantilla' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva plantilla' })).not.toBeInTheDocument()
  })
})

describe('crear una plantilla', () => {
  it('el administrador de un club sin plantillas crea la primera y entra en ella', async () => {
    let plantillas: Plantilla[] = []
    conDatos({ plantillas: [] })
    manejadores['GET /api/plantillas'] = () => json(plantillas)
    manejadores['POST /api/plantillas'] = async (peticion) => {
      const cuerpo = await peticion.json()
      plantillas = [plantilla('nueva', cuerpo.nombre, cuerpo.temporada)]
      return json(plantillas[0], 201)
    }

    const router = abrir('/')
    expect(
      await screen.findByRole('heading', { name: 'Crea la primera plantilla' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva plantilla' })

    // Sin nombre ni categoría no se envía
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear' }))
    expect(within(hoja).getByText(/Escribe el nombre/)).toBeInTheDocument()
    expect(peticiones.some((p) => p.clave === 'POST /api/plantillas')).toBe(false)

    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Senior')
    await userEvent.type(within(hoja).getByLabelText(/Categoría/), 'sénior')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear' }))

    expect(await screen.findByRole('button', { name: /Plantilla Senior/ })).toBeInTheDocument()
    expect(ruta(router)).toBe('/p/nueva/plantilla')
    expect(peticiones.find((p) => p.clave === 'POST /api/plantillas')?.cuerpo).toEqual({
      clubId: 'c1',
      nombre: 'Senior',
      categoria: 'sénior',
      temporada: temporadaDe(new Date()),
      plantillaAnteriorId: null,
    })
  })

  it('propone como anterior la plantilla con el mismo nombre de la temporada previa', async () => {
    const actual = temporadaDe(new Date())
    const previa = plantilla(
      'previa',
      'Senior',
      `${Number(actual.slice(0, 4)) - 1}-${actual.slice(2, 4)}`,
    )
    conDatos({ plantillas: [previa] })
    abrir('/p/previa/plantilla')
    await userEvent.click(await screen.findByRole('button', { name: /Cambiar de plantilla/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Nueva plantilla' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva plantilla' })
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'senior')
    expect(within(hoja).getByLabelText('Plantilla de la temporada anterior')).toHaveValue('previa')
    expect(within(hoja).getByLabelText(/Categoría/)).toHaveValue('sénior')
  })

  it('un nombre repetido se muestra en el campo', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['POST /api/plantillas'] = () =>
      json(
        {
          error: {
            codigo: 'plantilla_duplicada',
            mensaje: 'El club ya tiene una plantilla "Senior"',
          },
        },
        409,
      )
    abrir('/plantillas')
    await userEvent.click(await screen.findByRole('button', { name: 'Nueva plantilla' }))
    const hoja = screen.getByRole('dialog', { name: 'Nueva plantilla' })
    await userEvent.type(within(hoja).getByLabelText(/Nombre/), 'Senior')
    await userEvent.type(within(hoja).getByLabelText(/Categoría/), 'sénior')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Crear' }))
    expect(
      await within(hoja).findByText('El club ya tiene una plantilla "Senior"'),
    ).toBeInTheDocument()
  })
})

describe('sesión', () => {
  it('si la sesión caduca a mitad de uso vuelve al login avisando', async () => {
    manejadores['GET /api/auth/get-session'] = sesionActiva
    manejadores['GET /api/plantillas'] = () =>
      json({ error: { codigo: 'no_autenticado', mensaje: 'x' } }, 401)
    const router = abrir('/p/p1/entrenos')
    expect(await screen.findByText(/Tu sesión ha caducado/)).toBeInTheDocument()
    expect(ruta(router)).toBe('/login')
    expect(router.state.location.state).toEqual({ volver: '/p/p1/entrenos' })
  })

  it('cerrar sesión vuelve al login', async () => {
    let conectado = true
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/auth/get-session'] = () => (conectado ? sesionActiva() : sinSesion())
    manejadores['POST /api/auth/sign-out'] = () => {
      conectado = false
      return json({ success: true })
    }
    const router = abrir('/p/p1/mas')
    expect(await screen.findByText('Ana Administradora')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByLabelText(/Email/)).toBeInTheDocument()
    expect(ruta(router)).toBe('/login')
  })
})

describe('navegación de una plantilla', () => {
  it('muestra las cinco secciones de la plantilla activa y marca la actual', async () => {
    conDatos({ plantillas: [senior26] })
    abrir('/p/p1/plantilla')
    const navegacion = await screen.findByRole('navigation', { name: 'Secciones' })
    const enlaces = within(navegacion).getAllByRole('link')
    expect(enlaces.map((a) => a.textContent)).toEqual([
      'Plantilla',
      'Entrenos',
      'Partidos',
      'Multas',
      'Más',
    ])
    expect(enlaces.map((a) => a.getAttribute('href'))).toContain('/p/p1/entrenos')
    await userEvent.click(within(navegacion).getByRole('link', { name: 'Entrenos' }))
    expect(within(navegacion).getByRole('link', { name: 'Entrenos' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('una sección desconocida muestra la página de no encontrada', async () => {
    conDatos({ plantillas: [senior26] })
    abrir('/p/p1/no-existe')
    expect(
      await screen.findByRole('heading', { name: 'Esta página no existe' }),
    ).toBeInTheDocument()
  })
})

describe('temporada en curso', () => {
  it.each([
    ['2026-06-30', '2025-26'],
    ['2026-07-01', '2026-27'],
    ['2099-09-15', '2099-00'],
  ])('el %s es la temporada %s', (fecha, temporada) => {
    expect(temporadaDe(new Date(`${fecha}T12:00:00`))).toBe(temporada)
  })
})

describe('cliente de la API', () => {
  it('convierte el formato de error común en un ErrorApi', async () => {
    manejadores['GET /api/health'] = () =>
      json({ error: { codigo: 'sin_permiso', mensaje: 'No tienes acceso a esta plantilla' } }, 403)
    const error = await datos(api.GET('/api/health')).catch((e) => e)
    expect(error).toBeInstanceOf(ErrorApi)
    expect(error).toMatchObject({
      estado: 403,
      codigo: 'sin_permiso',
      message: 'No tienes acceso a esta plantilla',
    })
  })

  it('sin un cuerpo de error reconocible da un mensaje genérico', async () => {
    manejadores['GET /api/health'] = () => new Response('Bad Gateway', { status: 502 })
    const error = await datos(api.GET('/api/health')).catch((e) => e)
    expect(error).toMatchObject({ estado: 502, codigo: 'error' })
    expect(error.message).toMatch(/No se ha podido conectar/)
  })
})
