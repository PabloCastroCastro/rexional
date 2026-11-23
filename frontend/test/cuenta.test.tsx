import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { abrir, conDatos, json, manejadores, peticiones, senior26 } from './simulacion'

// GH-177: sesiones abiertas y cambio de contraseña, en Más → Cuenta
const ESTA = {
  id: 's1',
  actual: true,
  navegador: 'Chrome',
  sistema: 'Android',
  ip: '10.0.0.5',
  iniciada: '2026-11-01T10:00:00Z',
  ultimoUso: '2026-11-10T10:00:00Z',
  caduca: '2026-12-10T10:00:00Z',
}
const IPHONE = {
  ...ESTA,
  id: 's2',
  actual: false,
  navegador: 'Safari',
  sistema: 'iPhone',
  ip: '203.0.113.4',
}
const PORTATIL = {
  ...ESTA,
  id: 's3',
  actual: false,
  navegador: 'Firefox',
  sistema: 'Windows',
  ip: null,
}

function conSesiones(sesiones: unknown[]) {
  conDatos({ plantillas: [senior26] })
  manejadores['GET /api/cuenta/sesiones'] = () => json(sesiones)
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

async function confirmar(texto: string) {
  const dialogo = await screen.findByRole('alertdialog')
  await userEvent.click(within(dialogo).getByRole('button', { name: texto }))
}

describe('sesiones abiertas', () => {
  it('se llega desde Más y muestra este dispositivo y los demás', async () => {
    conSesiones([ESTA, IPHONE, PORTATIL])
    abrir('/plantillas/p1/mas')
    await userEvent.click(await screen.findByRole('link', { name: /Cuenta/ }))
    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument()
    expect(screen.getByText('Este dispositivo')).toBeInTheDocument()
    expect(screen.getByText('Safari en iPhone')).toBeInTheDocument()
    expect(screen.getByText(/IP 203\.0\.113\.4/)).toBeInTheDocument()
    // La actual no se cierra desde aquí
    expect(
      screen.queryByRole('button', { name: 'Cerrar la sesión en Chrome en Android' }),
    ).not.toBeInTheDocument()
  })

  it('cierra otra sesión tras confirmarlo', async () => {
    conSesiones([ESTA, IPHONE])
    manejadores['DELETE /api/cuenta/sesiones/s2'] = () => new Response(null, { status: 204 })
    abrir('/plantillas/p1/mas/cuenta')
    await userEvent.click(
      await screen.findByRole('button', { name: 'Cerrar la sesión en Safari en iPhone' }),
    )
    manejadores['GET /api/cuenta/sesiones'] = () => json([ESTA])
    await confirmar('Cerrar sesión')
    expect(await screen.findByText('Sesión cerrada en ese dispositivo')).toBeInTheDocument()
    expect(enviado('DELETE /api/cuenta/sesiones/s2')).toHaveLength(1)
    expect(
      await screen.findByText('No tienes la sesión abierta en ningún otro dispositivo.'),
    ).toBeInTheDocument()
  })

  it('cierra todas las demás tras confirmarlo', async () => {
    conSesiones([ESTA, IPHONE, PORTATIL])
    manejadores['POST /api/cuenta/sesiones/cerrar-otras'] = () => json({ cerradas: 2 })
    abrir('/plantillas/p1/mas/cuenta')
    await userEvent.click(await screen.findByRole('button', { name: 'Cerrar las demás sesiones' }))
    expect(await screen.findByText(/Los otros 2 dispositivos/)).toBeInTheDocument()
    await confirmar('Cerrar las demás')
    expect(await screen.findByText('Sesión cerrada en 2 dispositivos')).toBeInTheDocument()
  })

  it('si no se pueden cargar, permite reintentar', async () => {
    conDatos({ plantillas: [senior26] })
    manejadores['GET /api/cuenta/sesiones'] = () =>
      json({ error: { codigo: 'error', mensaje: 'x' } }, 500)
    abrir('/plantillas/p1/mas/cuenta')
    expect(await screen.findByText('No se han podido cargar las sesiones.')).toBeInTheDocument()
    manejadores['GET /api/cuenta/sesiones'] = () => json([ESTA])
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument()
  })
})

describe('cambio de contraseña', () => {
  async function rellenar(actual: string, nueva: string, repetida = nueva) {
    const campoActual = await screen.findByLabelText('Contraseña actual')
    if (actual) await userEvent.type(campoActual, actual)
    await userEvent.type(screen.getByLabelText('Nueva contraseña'), nueva)
    await userEvent.type(screen.getByLabelText('Repite la nueva contraseña'), repetida)
    await userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))
  }

  it('la cambia y cierra las demás sesiones', async () => {
    conSesiones([ESTA, IPHONE])
    manejadores['POST /api/auth/change-password'] = () => json({ token: 't' })
    abrir('/plantillas/p1/mas/cuenta')
    await rellenar('la-de-siempre', 'una-contraseña-nueva')
    expect(
      await screen.findByText(
        'Contraseña cambiada. Se ha cerrado la sesión en los demás dispositivos.',
      ),
    ).toBeInTheDocument()
    expect(enviado('POST /api/auth/change-password')).toEqual([
      {
        currentPassword: 'la-de-siempre',
        newPassword: 'una-contraseña-nueva',
        revokeOtherSessions: true,
      },
    ])
  })

  it('valida antes de enviar: obligatoria, al menos 10 caracteres y repetida igual', async () => {
    conSesiones([ESTA])
    abrir('/plantillas/p1/mas/cuenta')
    await rellenar('', 'corta', 'otra')
    expect(await screen.findByText('Escribe tu contraseña actual')).toBeInTheDocument()
    expect(screen.getByText('Tiene que tener al menos 10 caracteres')).toBeInTheDocument()
    expect(screen.getByText('No coincide con la nueva contraseña')).toBeInTheDocument()
    expect(enviado('POST /api/auth/change-password')).toEqual([])
  })

  it('con la contraseña actual mal lo dice en su campo', async () => {
    conSesiones([ESTA])
    manejadores['POST /api/auth/change-password'] = () =>
      json({ code: 'INVALID_PASSWORD', message: 'Invalid password' }, 400)
    abrir('/plantillas/p1/mas/cuenta')
    await rellenar('mal-escrita', 'una-contraseña-nueva')
    expect(await screen.findByText('La contraseña actual no es correcta')).toBeInTheDocument()
  })

  it('con la cuenta bloqueada dice cuánto esperar', async () => {
    conSesiones([ESTA])
    manejadores['POST /api/auth/change-password'] = () =>
      json(
        {
          error: {
            codigo: 'demasiados_intentos',
            mensaje: 'Demasiados intentos fallidos. Espera 2 minutos y vuelve a probar.',
          },
        },
        429,
      )
    abrir('/plantillas/p1/mas/cuenta')
    await rellenar('mal-escrita', 'una-contraseña-nueva')
    expect(await screen.findByText(/Espera 2 minutos/)).toBeInTheDocument()
  })
})

describe('muchas sesiones (GH-297)', () => {
  // La actual llega la última; las demás, desordenadas
  const sesion = (n: number) => ({
    ...IPHONE,
    id: `o${n}`,
    navegador: `Navegador ${n}`,
    ultimoUso: `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`,
  })
  const MUCHAS = [sesion(3), sesion(9), sesion(1), sesion(7), sesion(5), sesion(8), ESTA]

  it('muestra la actual y las 4 más recientes, con «Cerrar las demás» justo debajo', async () => {
    conSesiones(MUCHAS)
    abrir('/plantillas/p1/mas/cuenta')
    const recientes = await screen.findByRole('list', { name: 'Sesiones recientes' })
    const filas = within(recientes).getAllByRole('listitem')
    expect(filas.map((f) => f.querySelector('strong')?.textContent)).toEqual([
      'Chrome en Android',
      'Navegador 9 en iPhone',
      'Navegador 8 en iPhone',
      'Navegador 7 en iPhone',
      'Navegador 5 en iPhone',
    ])
    expect(filas[1]).toHaveTextContent(/Último uso/)
    expect(screen.queryByText('Navegador 3 en iPhone')).not.toBeInTheDocument()

    // El botón va justo después de la lista, antes de «Ver las 2 restantes»
    const cerrar = screen.getByRole('button', { name: 'Cerrar las demás sesiones' })
    const ver = screen.getByRole('button', { name: 'Ver las 2 restantes' })
    expect(
      recientes.compareDocumentPosition(cerrar) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(cerrar.compareDocumentPosition(ver) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await userEvent.click(ver)
    const antiguas = screen.getByRole('list', { name: 'Sesiones más antiguas' })
    expect(
      within(antiguas)
        .getAllByRole('listitem')
        .map((f) => f.querySelector('strong')?.textContent),
    ).toEqual(['Navegador 3 en iPhone', 'Navegador 1 en iPhone'])
    expect(screen.queryByRole('button', { name: /restantes/ })).not.toBeInTheDocument()

    // Misma confirmación de antes, con todas las demás
    manejadores['POST /api/cuenta/sesiones/cerrar-otras'] = () => json({ cerradas: 6 })
    await userEvent.click(cerrar)
    expect(await screen.findByText(/Los otros 6 dispositivos/)).toBeInTheDocument()
    await confirmar('Cerrar las demás')
    expect(await screen.findByText('Sesión cerrada en 6 dispositivos')).toBeInTheDocument()
  })

  it('con 5 o menos se ven todas, sin «Ver las restantes»', async () => {
    conSesiones(MUCHAS.slice(2))
    abrir('/plantillas/p1/mas/cuenta')
    const recientes = await screen.findByRole('list', { name: 'Sesiones recientes' })
    expect(within(recientes).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.queryByRole('button', { name: /restante/ })).not.toBeInTheDocument()
  })
})
