import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ProveedorAvisos, useAvisos } from '../src/componentes/Avisos'
import { Boton } from '../src/componentes/Boton'
import { Campo } from '../src/componentes/Campo'
import { ProveedorConfirmacion, useConfirmacion } from '../src/componentes/Confirmacion'
import { EstadoVacio } from '../src/componentes/EstadoVacio'
import { HojaInferior } from '../src/componentes/HojaInferior'

describe('Boton', () => {
  it('ejecuta la acción al pulsarlo', async () => {
    const alPulsar = vi.fn()
    render(<Boton onClick={alPulsar}>Guardar</Boton>)
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(alPulsar).toHaveBeenCalledOnce()
  })

  it('mientras carga está desactivado y lo anuncia', async () => {
    const alPulsar = vi.fn()
    render(
      <Boton cargando onClick={alPulsar}>
        Guardar
      </Boton>,
    )
    const boton = screen.getByRole('button', { name: 'Guardar' })
    expect(boton).toBeDisabled()
    expect(boton).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(boton)
    expect(alPulsar).not.toHaveBeenCalled()
  })
})

describe('Campo', () => {
  it('asocia la etiqueta y la ayuda al campo', () => {
    render(<Campo etiqueta="Dorsal" ayuda="Entre 0 y 99" />)
    const campo = screen.getByLabelText('Dorsal')
    expect(campo).toHaveAccessibleDescription('Entre 0 y 99')
    expect(campo).not.toHaveAttribute('aria-invalid')
  })

  it('marca el error y lo anuncia', () => {
    render(<Campo etiqueta="Dorsal" error="El dorsal 7 ya está en uso" />)
    const campo = screen.getByLabelText('Dorsal')
    expect(campo).toHaveAttribute('aria-invalid', 'true')
    expect(campo).toHaveAccessibleDescription('El dorsal 7 ya está en uso')
    expect(screen.getByRole('alert')).toHaveTextContent('El dorsal 7 ya está en uso')
  })
})

describe('EstadoVacio', () => {
  it('muestra el título, la descripción y la acción', () => {
    render(
      <EstadoVacio
        titulo="Sin jugadores"
        descripcion="Añade el primero"
        accion={<Boton>Añadir</Boton>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Sin jugadores' })).toBeInTheDocument()
    expect(screen.getByText('Añade el primero')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Añadir' })).toBeInTheDocument()
  })
})

describe('HojaInferior', () => {
  function Prueba({ alCerrar }: { alCerrar?: () => void }) {
    const [abierta, setAbierta] = useState(false)
    return (
      <>
        <Boton onClick={() => setAbierta(true)}>Abrir</Boton>
        <HojaInferior
          abierta={abierta}
          titulo="Nuevo jugador"
          alCerrar={() => {
            alCerrar?.()
            setAbierta(false)
          }}
        >
          <Campo etiqueta="Nombre" />
        </HojaInferior>
      </>
    )
  }

  it('se abre con su título y se cierra con el botón Cerrar', async () => {
    render(<Prueba />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo jugador' })
    expect(hoja).toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(hoja).not.toHaveAttribute('open')
  })

  it('se cierra con Escape y tocando fuera', async () => {
    const alCerrar = vi.fn()
    render(<Prueba alCerrar={alCerrar} />)
    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    const hoja = screen.getByRole('dialog', { name: 'Nuevo jugador' })
    fireEvent(hoja, new Event('cancel', { cancelable: true }))
    expect(alCerrar).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Abrir' }))
    fireEvent.click(hoja)
    expect(alCerrar).toHaveBeenCalledTimes(2)
  })
})

describe('Confirmacion', () => {
  function Prueba({ alResponder }: { alResponder: (valor: boolean) => void }) {
    const confirmar = useConfirmacion()
    return (
      <Boton
        onClick={async () =>
          alResponder(await confirmar({ titulo: '¿Borrar la multa?', peligrosa: true }))
        }
      >
        Borrar
      </Boton>
    )
  }

  it.each([
    ['Confirmar', true],
    ['Cancelar', false],
  ])('pulsando %s devuelve %s', async (boton, esperado) => {
    const alResponder = vi.fn()
    render(
      <ProveedorConfirmacion>
        <Prueba alResponder={alResponder} />
      </ProveedorConfirmacion>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Borrar' }))
    expect(screen.getByRole('alertdialog', { name: '¿Borrar la multa?' })).toHaveAttribute('open')
    await userEvent.click(screen.getByRole('button', { name: boton }))
    expect(alResponder).toHaveBeenCalledWith(esperado)
  })
})

describe('Avisos', () => {
  function Prueba() {
    const { avisar } = useAvisos()
    return (
      <>
        <Boton onClick={() => avisar({ tipo: 'exito', mensaje: 'Guardado' })}>Éxito</Boton>
        <Boton onClick={() => avisar({ tipo: 'error', mensaje: 'Sin conexión' })}>Error</Boton>
        <Boton
          onClick={() =>
            avisar({
              mensaje: 'Multa borrada',
              accion: { texto: 'Deshacer', alPulsar: deshacer },
              duracion: null,
            })
          }
        >
          Con acción
        </Boton>
      </>
    )
  }
  const deshacer = vi.fn()

  it('muestra el aviso y desaparece solo a los 4 segundos', () => {
    vi.useFakeTimers()
    try {
      render(
        <ProveedorAvisos>
          <Prueba />
        </ProveedorAvisos>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Éxito' }))
      expect(screen.getByRole('status')).toHaveTextContent('Guardado')
      act(() => vi.advanceTimersByTime(4000))
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('los errores se anuncian como alerta', async () => {
    render(
      <ProveedorAvisos>
        <Prueba />
      </ProveedorAvisos>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Error' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
  })

  it('la acción se ejecuta y cierra el aviso', async () => {
    render(
      <ProveedorAvisos>
        <Prueba />
      </ProveedorAvisos>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Con acción' }))
    await userEvent.click(screen.getByRole('button', { name: 'Deshacer' }))
    expect(deshacer).toHaveBeenCalledOnce()
    expect(screen.queryByText('Multa borrada')).not.toBeInTheDocument()
  })
})
