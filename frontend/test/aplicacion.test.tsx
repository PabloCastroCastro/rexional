import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, datos, ErrorApi } from '../src/api/cliente'
import { crearClienteConsultas, Proveedores } from '../src/proveedores'
import { rutas } from '../src/rutas'

function abrir(ruta: string) {
  const router = createMemoryRouter(rutas, { initialEntries: [ruta] })
  render(
    <Proveedores cliente={crearClienteConsultas()}>
      <RouterProvider router={router} />
    </Proveedores>,
  )
  return router
}

const respuesta = (estado: number, cuerpo: unknown) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => vi.restoreAllMocks())

describe('navegación', () => {
  it('la raíz lleva a la plantilla', () => {
    const router = abrir('/')
    expect(router.state.location.pathname).toBe('/plantilla')
    expect(screen.getByRole('heading', { name: 'Plantilla' })).toBeInTheDocument()
  })

  it('muestra las cinco secciones y marca la actual', async () => {
    abrir('/plantilla')
    const navegacion = screen.getByRole('navigation', { name: 'Secciones' })
    const enlaces = Array.from(navegacion.querySelectorAll('a')).map((a) => a.textContent)
    expect(enlaces).toEqual(['Plantilla', 'Entrenos', 'Partidos', 'Multas', 'Más'])

    await userEvent.click(screen.getByRole('link', { name: 'Entrenos' }))
    expect(screen.getByRole('link', { name: 'Entrenos' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('heading', { name: 'Entrenos' })).toBeInTheDocument()
  })

  it('una ruta desconocida muestra la página de no encontrada', () => {
    abrir('/no-existe')
    expect(screen.getByRole('heading', { name: 'Esta página no existe' })).toBeInTheDocument()
  })

  it('Más consulta el estado del servidor a través del cliente de la API', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respuesta(200, { estado: 'ok', api: 'ok', baseDeDatos: 'ok' }),
    )
    abrir('/mas')
    expect(await screen.findByText('Disponible')).toBeInTheDocument()
  })
})

describe('cliente de la API', () => {
  it('devuelve los datos de una respuesta correcta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respuesta(200, { estado: 'ok', api: 'ok', baseDeDatos: 'ok' }),
    )
    await expect(datos(api.GET('/api/health'))).resolves.toEqual({
      estado: 'ok',
      api: 'ok',
      baseDeDatos: 'ok',
    })
  })

  it('convierte el formato de error común en un ErrorApi', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      respuesta(403, {
        error: { codigo: 'sin_permiso', mensaje: 'No tienes acceso a esta plantilla' },
      }),
    )
    const error = await datos(api.GET('/api/health')).catch((e) => e)
    expect(error).toBeInstanceOf(ErrorApi)
    expect(error).toMatchObject({
      estado: 403,
      codigo: 'sin_permiso',
      message: 'No tienes acceso a esta plantilla',
    })
  })

  it('sin un cuerpo de error reconocible da un mensaje genérico', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Bad Gateway', { status: 502 }))
    const error = await datos(api.GET('/api/health')).catch((e) => e)
    expect(error).toMatchObject({ estado: 502, codigo: 'error' })
    expect(error.message).toMatch(/No se ha podido conectar/)
  })
})
