import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, vi } from 'vitest'
import type { Plantilla } from '../src/plantillas/datos'
import { crearClienteConsultas, Proveedores } from '../src/proveedores'
import { rutas } from '../src/rutas'

// --- API simulada: cada prueba define qué responde cada "MÉTODO /ruta" ---

export type Manejador = (peticion: Request) => Response | Promise<Response>

export const json = (cuerpo: unknown, estado = 200) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })

export let manejadores: Record<string, Manejador> = {}
export const peticiones: { clave: string; cuerpo: unknown }[] = []

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

export const USUARIO = { id: 'u1', name: 'Ana Administradora', email: 'admin@rexional.test' }
export const sesionActiva = () =>
  json({ user: USUARIO, session: { expiresAt: '2026-11-01T00:00:00Z' } })
export const sinSesion = () => json(null)

export const clubRexional = {
  id: 'c1',
  nombre: 'CD Rexional',
  escudo: null,
  colorPrincipal: '#14553d',
  colorSecundario: '#f2c230',
}

export const plantilla = (
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

export const senior26 = plantilla('p1', 'Senior', '2026-27')
export const juvenil26 = plantilla('p2', 'Juvenil', '2026-27')
export const senior25 = plantilla('p3', 'Senior', '2025-26')

export function conDatos({
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

export function abrir(ruta: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [ruta] })
  render(
    <Proveedores cliente={crearClienteConsultas()}>
      <RouterProvider router={router} />
    </Proveedores>,
  )
  return router
}

export const ruta = (router: ReturnType<typeof abrir>) => router.state.location.pathname
