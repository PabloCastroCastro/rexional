import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ProveedorAvisos } from './componentes/Avisos'
import { ProveedorConfirmacion } from './componentes/Confirmacion'

export const crearClienteConsultas = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        // En el campo la cobertura falla: un reintento, y los datos valen 30 s antes de volver a pedirlos
        retry: 1,
        staleTime: 30_000,
      },
    },
  })

// Contextos comunes de la aplicación (también los usan los tests)
export function Proveedores({ children, cliente }: { children: ReactNode; cliente: QueryClient }) {
  return (
    <QueryClientProvider client={cliente}>
      <ProveedorAvisos>
        <ProveedorConfirmacion>{children}</ProveedorConfirmacion>
      </ProveedorAvisos>
    </QueryClientProvider>
  )
}
