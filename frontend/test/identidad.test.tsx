import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  abrir,
  clubRexional,
  conDatos,
  json,
  manejadores,
  peticiones,
  plantilla,
  senior26,
} from './simulacion'

// Identidad del club en la configuración (GH-30): escudo y colores, solo administradores del club

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)
const pedido = (clave: string) => peticiones.some((p) => p.clave === clave)

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:vista-previa')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.restoreAllMocks())

type Club = Omit<typeof clubRexional, 'escudo'> & { escudo: string | null }

function conClub(club: Club = clubRexional, p = senior26) {
  conDatos({ plantillas: [{ ...p, club }] })
  manejadores['GET /api/clubes'] = () => json([{ ...club, esAdmin: p.esAdminClub }])
  manejadores['GET /api/clubes/c1/admins'] = () => json([])
  manejadores['GET /api/clubes/c1/invitaciones'] = () => json([])
  manejadores['GET /api/plantillas/p1/miembros'] = () =>
    json({ miembros: [], jugadoresSinCuenta: [] })
  manejadores['GET /api/plantillas/p1/invitaciones'] = () => json([])
  manejadores['GET /api/medios/limites'] = () =>
    json({ maxFotoBytes: 1, maxVideoBytes: 1, maxEscudoBytes: 2 * 1024 * 1024 })
  manejadores['PATCH /api/clubes/c1'] = async (peticion) =>
    json({ ...club, esAdmin: true, ...((await peticion.json()) as object) })
}

const seccion = async () => {
  const titulo = await screen.findByRole('heading', { name: 'Identidad del club' })
  return within(titulo.closest('section') as HTMLElement)
}

describe('identidad del club', () => {
  it('solo la ven los administradores del club', async () => {
    conClub(
      clubRexional,
      plantilla('p1', 'Senior', '2026-27', { rol: 'admin', esAdminClub: false }),
    )
    abrir('/plantillas/p1/mas/configuracion')
    expect(await screen.findByRole('heading', { name: 'Esta plantilla' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Identidad del club' })).not.toBeInTheDocument()
  })

  it('elige colores con vista previa en vivo y los guarda', async () => {
    conClub()
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    const guardar = s.getByRole('button', { name: 'Guardar colores' })
    expect(guardar).toBeDisabled()

    fireEvent.change(s.getByLabelText(/Principal/), { target: { value: '#f2c230' } })
    fireEvent.change(s.getByLabelText(/Secundario/), { target: { value: '#1d3a8a' } })
    // La vista previa ya los usa, con texto oscuro sobre el amarillo; la app, todavía no
    const vista = s.getByRole('region', { name: 'Vista previa' })
    expect(vista.style.getPropertyValue('--color-primario')).toBe('#f2c230')
    expect(vista.style.getPropertyValue('--color-sobre-primario')).toBe('#1b1f1d')
    expect(document.documentElement.style.getPropertyValue('--color-primario')).not.toBe('#f2c230')

    await userEvent.click(guardar)
    expect(enviado('PATCH /api/clubes/c1')).toEqual([
      { colorPrincipal: '#f2c230', colorSecundario: '#1d3a8a' },
    ])
  })

  it('restablece los colores por defecto', async () => {
    conClub({ ...clubRexional, colorPrincipal: '#1d3a8a', colorSecundario: '#ffffff' })
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    await userEvent.click(s.getByRole('button', { name: 'Restablecer los de por defecto' }))
    expect(enviado('PATCH /api/clubes/c1')).toEqual([
      { colorPrincipal: null, colorSecundario: null },
    ])
  })

  it('sube el escudo tras verlo en la vista previa', async () => {
    conClub()
    manejadores['PUT /api/clubes/c1/escudo'] = () =>
      json({ ...clubRexional, escudo: '/api/clubes/c1/escudo?v=nuevo', esAdmin: true })
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    const archivo = new File(['png'], 'escudo.png', { type: 'image/png' })
    await userEvent.upload(s.getByLabelText('Escudo del club'), archivo)
    expect(s.getByRole('img', { name: 'Vista previa del escudo nuevo' })).toHaveAttribute(
      'src',
      'blob:vista-previa',
    )
    expect(pedido('PUT /api/clubes/c1/escudo')).toBe(false)
    await userEvent.click(s.getByRole('button', { name: 'Guardar escudo' }))
    expect(await screen.findByText('Escudo guardado')).toBeInTheDocument()
    expect(pedido('PUT /api/clubes/c1/escudo')).toBe(true)
  })

  it('avisa antes de subir un archivo que no es PNG ni WebP o que es demasiado grande', async () => {
    conClub()
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    const usuario = userEvent.setup({ applyAccept: false })
    await usuario.upload(
      s.getByLabelText('Escudo del club'),
      new File(['jpg'], 'escudo.jpg', { type: 'image/jpeg' }),
    )
    expect(s.getByRole('alert')).toHaveTextContent('El escudo tiene que ser una imagen PNG o WebP')
    await usuario.upload(
      s.getByLabelText('Escudo del club'),
      new File([new Uint8Array(3 * 1024 * 1024)], 'enorme.png', { type: 'image/png' }),
    )
    expect(s.getByRole('alert')).toHaveTextContent('El escudo no puede pasar de 2 MB')
    expect(pedido('PUT /api/clubes/c1/escudo')).toBe(false)
  })

  it('muestra el error de la API al subir', async () => {
    conClub()
    manejadores['PUT /api/clubes/c1/escudo'] = () =>
      json(
        {
          error: {
            codigo: 'tipo_no_admitido',
            mensaje: 'El escudo está dañado o no se puede leer',
          },
        },
        415,
      )
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    await userEvent.upload(
      s.getByLabelText('Escudo del club'),
      new File(['png'], 'roto.png', { type: 'image/png' }),
    )
    await userEvent.click(s.getByRole('button', { name: 'Guardar escudo' }))
    expect(await s.findByRole('alert')).toHaveTextContent(
      'El escudo está dañado o no se puede leer',
    )
  })

  it('quita el escudo tras confirmarlo', async () => {
    conClub({ ...clubRexional, escudo: '/api/clubes/c1/escudo?v=uno' })
    manejadores['DELETE /api/clubes/c1/escudo'] = () =>
      json({ ...clubRexional, escudo: null, esAdmin: true })
    abrir('/plantillas/p1/mas/configuracion')
    const s = await seccion()
    expect(s.getByRole('button', { name: 'Cambiar escudo' })).toBeInTheDocument()
    await userEvent.click(s.getByRole('button', { name: 'Quitar escudo' }))
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Quitar el escudo?' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Quitar el escudo' }))
    expect(await screen.findByText('Escudo quitado')).toBeInTheDocument()
    expect(pedido('DELETE /api/clubes/c1/escudo')).toBe(true)
  })
})
