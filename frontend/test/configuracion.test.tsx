import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { Plantilla } from '../src/plantillas/datos'
import {
  abrir,
  clubRexional,
  conDatos,
  json,
  juvenil26,
  manejadores,
  peticiones,
  plantilla,
  ruta,
  senior25,
  senior26,
  USUARIO,
} from './simulacion'

const ADMINS = [
  { usuarioId: 'u1', nombre: 'Ana Administradora', email: 'admin@rexional.test' },
  { usuarioId: 'u9', nombre: 'Berta Bouzas', email: 'berta@rexional.test' },
]

// Datos del club: la API de administradores, además de plantillas y clubes
function conClub(plantillas: Plantilla[], admins = ADMINS) {
  conDatos({ plantillas })
  manejadores['GET /api/clubes/c1/admins'] = () => json(admins)
}

const enviado = (clave: string) => peticiones.filter((p) => p.clave === clave).map((p) => p.cuerpo)

describe('acceso a la configuración', () => {
  it('el entrenador ve Configuración en Más, con los datos de su plantilla pero no los del club', async () => {
    conClub([plantilla('p1', 'Senior', '2026-27', { rol: 'entrenador', esAdminClub: false })])
    abrir('/p/p1/mas')
    await userEvent.click(await screen.findByRole('link', { name: 'Configuración' }))
    expect(await screen.findByRole('heading', { name: 'Esta plantilla' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Plantillas del club' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Administradores del club' }),
    ).not.toBeInTheDocument()
  })

  it.each(['delegado', 'jugador'] as const)('el %s no ve Configuración', async (rol) => {
    conClub([plantilla('p1', 'Senior', '2026-27', { rol, esAdminClub: false })])
    abrir('/p/p1/mas')
    expect(await screen.findByText('Ana Administradora')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Configuración' })).not.toBeInTheDocument()
  })

  it('el administrador del club ve todos los bloques', async () => {
    conClub([senior26])
    abrir('/p/p1/mas/configuracion')
    for (const titulo of [
      'Esta plantilla',
      'Club',
      'Plantillas del club',
      'Administradores del club',
    ]) {
      expect(await screen.findByRole('heading', { name: titulo })).toBeInTheDocument()
    }
  })
})

describe('datos de la plantilla', () => {
  it('guarda el nombre y la categoría y refresca la cabecera', async () => {
    let actual = senior26
    conClub([senior26])
    manejadores['GET /api/plantillas'] = () => json([actual])
    manejadores['PATCH /api/plantillas/p1'] = async (peticion) => {
      actual = { ...actual, ...(await peticion.json()) }
      return json(actual)
    }
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Esta plantilla' })
    const guardar = within(bloque).getByRole('button', { name: 'Guardar' })
    expect(guardar).toBeDisabled()

    const nombre = within(bloque).getByLabelText(/Nombre/)
    await userEvent.clear(nombre)
    await userEvent.type(nombre, 'Senior A')
    await userEvent.click(guardar)

    expect(
      await screen.findByRole('button', { name: /Plantilla Senior A, temporada 2026-27/ }),
    ).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p1')).toEqual([
      { nombre: 'Senior A', categoria: 'sénior' },
    ])
    expect(await screen.findByRole('status')).toHaveTextContent('Plantilla guardada')
  })

  it('un nombre repetido se muestra en el campo', async () => {
    conClub([senior26, juvenil26])
    manejadores['PATCH /api/plantillas/p1'] = () =>
      json(
        {
          error: {
            codigo: 'plantilla_duplicada',
            mensaje: 'El club ya tiene una plantilla "Juvenil"',
          },
        },
        409,
      )
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Esta plantilla' })
    const nombre = within(bloque).getByLabelText(/Nombre/)
    await userEvent.clear(nombre)
    await userEvent.type(nombre, 'Juvenil')
    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))
    expect(
      await within(bloque).findByText('El club ya tiene una plantilla "Juvenil"'),
    ).toBeInTheDocument()
  })
})

describe('club', () => {
  it('el administrador cambia el nombre del club', async () => {
    conClub([senior26])
    manejadores['PATCH /api/clubes/c1'] = async (peticion) =>
      json({ ...clubRexional, ...(await peticion.json()), esAdmin: true })
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Club' })
    const campo = within(bloque).getByLabelText(/Nombre del club/)
    await userEvent.clear(campo)
    await userEvent.type(campo, 'CD Rexional Galicia')
    await userEvent.click(within(bloque).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Nombre del club guardado')).toBeInTheDocument()
    expect(enviado('PATCH /api/clubes/c1')).toEqual([{ nombre: 'CD Rexional Galicia' }])
  })
})

describe('plantillas del club', () => {
  it('lista todas por temporada, la más reciente primero', async () => {
    conClub([juvenil26, senior26, senior25])
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Plantillas del club' })
    expect(
      within(bloque)
        .getAllByRole('heading', { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(['Temporada 2026-27', 'Temporada 2025-26'])
    expect(within(bloque).getByText('Senior (actual)')).toBeInTheDocument()
  })

  it('edita otra plantilla desde la lista', async () => {
    conClub([juvenil26, senior26])
    manejadores['PATCH /api/plantillas/p2'] = async (peticion) =>
      json({ ...juvenil26, ...(await peticion.json()) })
    abrir('/p/p1/mas/configuracion')
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Juvenil 2026-27' }))
    const hoja = screen.getByRole('dialog', { name: 'Editar Juvenil 2026-27' })
    const categoria = within(hoja).getByLabelText(/Categoría/)
    await userEvent.clear(categoria)
    await userEvent.type(categoria, 'juvenil A')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Plantilla guardada')).toBeInTheDocument()
    expect(enviado('PATCH /api/plantillas/p2')).toEqual([
      { nombre: 'Juvenil', categoria: 'juvenil A' },
    ])
    expect(hoja).not.toHaveAttribute('open')
  })

  it('borrar exige escribir el nombre exacto', async () => {
    let plantillas = [juvenil26, senior26]
    conClub(plantillas)
    manejadores['GET /api/plantillas'] = () => json(plantillas)
    manejadores['DELETE /api/plantillas/p2'] = () => {
      plantillas = [senior26]
      return new Response(null, { status: 204 })
    }
    abrir('/p/p1/mas/configuracion')
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar Juvenil 2026-27' }))
    const hoja = screen.getByRole('dialog', { name: 'Borrar Juvenil 2026-27' })
    const borrar = within(hoja).getByRole('button', { name: 'Borrar plantilla' })
    expect(borrar).toBeDisabled()
    await userEvent.type(within(hoja).getByLabelText('Escribe Juvenil para confirmar'), 'juvenil')
    expect(borrar).toBeDisabled()
    await userEvent.clear(within(hoja).getByLabelText('Escribe Juvenil para confirmar'))
    await userEvent.type(within(hoja).getByLabelText('Escribe Juvenil para confirmar'), 'Juvenil')
    await userEvent.click(borrar)

    expect(await screen.findByText('Plantilla Juvenil 2026-27 borrada')).toBeInTheDocument()
    expect(enviado('DELETE /api/plantillas/p2')).toEqual([{ confirmacion: 'Juvenil' }])
    expect(screen.queryByRole('button', { name: 'Borrar Juvenil 2026-27' })).not.toBeInTheDocument()
  })

  it('borrar la plantilla activa vuelve al selector', async () => {
    let plantillas = [juvenil26, senior26]
    conClub(plantillas)
    manejadores['GET /api/plantillas'] = () => json(plantillas)
    manejadores['DELETE /api/plantillas/p1'] = () => {
      plantillas = [juvenil26]
      return new Response(null, { status: 204 })
    }
    const router = abrir('/p/p1/mas/configuracion')
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar Senior 2026-27' }))
    const hoja = screen.getByRole('dialog', { name: 'Borrar Senior 2026-27' })
    await userEvent.type(within(hoja).getByLabelText('Escribe Senior para confirmar'), 'Senior')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Borrar plantilla' }))
    expect(await screen.findByRole('heading', { name: 'Elige la plantilla' })).toBeInTheDocument()
    expect(ruta(router)).toBe('/plantillas')
  })
})

describe('administradores del club', () => {
  it('lista los administradores marcando al usuario actual', async () => {
    conClub([senior26])
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Administradores del club' })
    expect(await within(bloque).findByText(`${USUARIO.name} (tú)`)).toBeInTheDocument()
    expect(within(bloque).getByText('berta@rexional.test')).toBeInTheDocument()
  })

  it('añade un administrador por email y muestra el error si no existe', async () => {
    conClub([senior26])
    manejadores['POST /api/clubes/c1/admins'] = async (peticion) => {
      const { email } = await peticion.json()
      if (email === 'nadie@prueba.test') {
        return json(
          {
            error: {
              codigo: 'usuario_no_encontrado',
              mensaje: `No hay ningún usuario con el email ${email}`,
            },
          },
          404,
        )
      }
      return json({ usuarioId: 'u7', nombre: 'Carlos', email }, 201)
    }
    abrir('/p/p1/mas/configuracion')
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir administrador' }))
    const hoja = screen.getByRole('dialog', { name: 'Añadir administrador' })
    await userEvent.type(within(hoja).getByLabelText(/Email/), 'nadie@prueba.test')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(
      await within(hoja).findByText('No hay ningún usuario con el email nadie@prueba.test'),
    ).toBeInTheDocument()

    await userEvent.clear(within(hoja).getByLabelText(/Email/))
    await userEvent.type(within(hoja).getByLabelText(/Email/), 'carlos@rexional.test')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Añadir' }))
    expect(await screen.findByText('Carlos ya es administrador del club')).toBeInTheDocument()
  })

  it('retirar pide confirmación y muestra el error del último administrador', async () => {
    conClub([senior26], [ADMINS[0] as (typeof ADMINS)[number]])
    manejadores['DELETE /api/clubes/c1/admins/u1'] = () =>
      json(
        {
          error: {
            codigo: 'ultimo_administrador',
            mensaje: 'Un club no puede quedarse sin administradores',
          },
        },
        409,
      )
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Administradores del club' })
    expect(await within(bloque).findByText(/añade otro antes de retirarte/)).toBeInTheDocument()

    await userEvent.click(within(bloque).getByRole('button', { name: `Retirar a ${USUARIO.name}` }))
    const confirmacion = screen.getByRole('alertdialog', { name: '¿Dejar de ser administrador?' })
    await userEvent.click(
      within(confirmacion).getByRole('button', { name: 'Dejar de ser administrador' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Un club no puede quedarse sin administradores',
    )
  })

  it('cancelar la confirmación no retira a nadie', async () => {
    conClub([senior26])
    abrir('/p/p1/mas/configuracion')
    const bloque = await screen.findByRole('region', { name: 'Administradores del club' })
    await userEvent.click(
      await within(bloque).findByRole('button', { name: 'Retirar a Berta Bouzas' }),
    )
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(enviado('DELETE /api/clubes/c1/admins/u9')).toEqual([])
  })
})
