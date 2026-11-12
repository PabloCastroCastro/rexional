import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  abrir,
  conDatos,
  json,
  manejadores,
  peticiones,
  ruta,
  senior26,
  sesionActiva,
  sinSesion,
  USUARIO,
} from './simulacion'

// Aceptar una invitación (GH-50): la página a la que lleva el enlace, con el token tras «#»

const TOKEN = 'token-de-prueba-con-mas-de-veinte-caracteres'
const CONSULTAR = 'POST /api/invitaciones/consultar'
const ACEPTAR = 'POST /api/invitaciones/aceptar'
const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

const invitacion = (extra = {}) => ({
  email: 'brais@example.com',
  club: 'CD Rexional',
  clubId: 'c1',
  plantilla: { id: 'p1', nombre: 'Senior', temporada: '2026-27' },
  rol: 'jugador',
  jugador: 'Brais',
  cuentaExiste: false,
  ...extra,
})

function abrirEnlace(token = TOKEN) {
  window.history.replaceState(null, '', `/invitacion${token ? `#${token}` : ''}`)
  return abrir('/invitacion')
}

beforeEach(() => {
  conDatos({ plantillas: [senior26] })
  manejadores['GET /api/auth/get-session'] = sinSesion
})

describe('aceptar una invitación', () => {
  it('sin cuenta: crea la cuenta, entra y va a la plantilla; el token sale de la barra', async () => {
    manejadores[CONSULTAR] = () => json(invitacion())
    manejadores[ACEPTAR] = () => {
      manejadores['GET /api/auth/get-session'] = sesionActiva
      return json({ clubId: 'c1', plantillaId: 'p1' })
    }
    const router = abrirEnlace()
    expect(await screen.findByText(/Te invitan a/)).toHaveTextContent(
      'Te invitan a Senior (2026-27) de CD Rexional como jugador.',
    )
    expect(screen.getByText('Tu ficha de jugador: Brais')).toBeInTheDocument()
    expect(enviado(CONSULTAR)).toEqual([{ token: TOKEN }])
    expect(window.location.hash).toBe('')
    expect(screen.getByLabelText('Email')).toHaveValue('brais@example.com')

    // Contraseñas que no coinciden: no se envía
    await userEvent.type(screen.getByLabelText(/Tu nombre/), 'Brais Pazos')
    await userEvent.type(screen.getByLabelText(/^Contraseña/), 'una-contraseña-larga')
    await userEvent.type(screen.getByLabelText(/Repite la contraseña/), 'otra-contraseña-larga')
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden')
    expect(enviado(ACEPTAR)).toHaveLength(0)

    await userEvent.clear(screen.getByLabelText(/Repite la contraseña/))
    await userEvent.type(screen.getByLabelText(/Repite la contraseña/), 'una-contraseña-larga')
    await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta y entrar' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/jugadores'))
    expect(enviado(ACEPTAR)).toEqual([
      { token: TOKEN, nombre: 'Brais Pazos', contrasena: 'una-contraseña-larga' },
    ])
  })

  it('con cuenta: entra con su contraseña y acepta', async () => {
    manejadores[CONSULTAR] = () => json(invitacion({ cuentaExiste: true }))
    manejadores['POST /api/auth/sign-in/email'] = () => {
      manejadores['GET /api/auth/get-session'] = sesionActiva
      return json({})
    }
    manejadores[ACEPTAR] = () => json({ clubId: 'c1', plantillaId: 'p1' })
    const router = abrirEnlace()
    await userEvent.type(await screen.findByLabelText(/^Contraseña/), 'mi-contraseña')
    expect(screen.queryByLabelText(/Tu nombre/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar y aceptar' }))
    await waitFor(() => expect(ruta(router)).toBe('/plantillas/p1/jugadores'))
    expect(enviado('POST /api/auth/sign-in/email')).toEqual([
      { email: 'brais@example.com', password: 'mi-contraseña' },
    ])
    expect(enviado(ACEPTAR)).toEqual([{ token: TOKEN }])
  })

  it('con la sesión de ese email, basta con aceptar', async () => {
    manejadores['GET /api/auth/get-session'] = sesionActiva
    manejadores[CONSULTAR] = () =>
      json(invitacion({ email: USUARIO.email, cuentaExiste: true, plantilla: null, rol: null }))
    manejadores[ACEPTAR] = () => json({ clubId: 'c1', plantillaId: null })
    abrirEnlace()
    expect(await screen.findByText(/Te invitan a ser/)).toHaveTextContent(
      'Te invitan a ser administrador de CD Rexional.',
    )
    expect(screen.queryByLabelText(/Contraseña/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar invitación' }))
    await waitFor(() => expect(enviado(ACEPTAR)).toEqual([{ token: TOKEN }]))
  })

  it('con la sesión de otro email, pide cerrarla', async () => {
    manejadores['GET /api/auth/get-session'] = sesionActiva
    manejadores[CONSULTAR] = () => json(invitacion({ cuentaExiste: true }))
    manejadores['POST /api/auth/sign-out'] = () => {
      manejadores['GET /api/auth/get-session'] = sinSesion
      return json({})
    }
    abrirEnlace()
    expect(await screen.findByText(/Has entrado como/)).toHaveTextContent(
      `Has entrado como ${USUARIO.email} y la invitación es para brais@example.com`,
    )
    expect(screen.queryByRole('button', { name: /Aceptar/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }))
    expect(await screen.findByRole('button', { name: 'Entrar y aceptar' })).toBeInTheDocument()
  })

  it('un enlace usado, caducado o sin token se explica', async () => {
    manejadores[CONSULTAR] = () =>
      json(
        {
          error: {
            codigo: 'invitacion_caducada',
            mensaje: 'Esta invitación ha caducado. Pide a quien te invitó que te envíe otra.',
          },
        },
        410,
      )
    abrirEnlace()
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta invitación ha caducado')
    expect(
      screen.getByRole('heading', { name: 'No se puede usar esta invitación' }),
    ).toBeInTheDocument()
  })

  it('sin token en el enlace', async () => {
    abrirEnlace('')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El enlace de la invitación no es válido',
    )
    expect(enviado(CONSULTAR)).toHaveLength(0)
  })
})
