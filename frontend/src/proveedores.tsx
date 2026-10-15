import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ErrorApi } from './api/cliente'
import { CLAVE_SESION, marcarSesionCaducada } from './auth/sesion'
import { ProveedorAvisos } from './componentes/Avisos'
import { ProveedorConfirmacion } from './componentes/Confirmacion'

export function crearClienteConsultas() {
  // Si la API responde 401 a mitad de uso, la sesión ha caducado: se olvida y la app vuelve al login,
  // que avisa y después devuelve a la pantalla donde se estaba
  const alFallar = (error: unknown) => {
    if (error instanceof ErrorApi && error.estado === 401) {
      marcarSesionCaducada()
      cliente.setQueryData(CLAVE_SESION, null)
    }
  }
  const cliente: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: alFallar }),
    mutationCache: new MutationCache({ onError: alFallar }),
    defaultOptions: {
      queries: {
        // En el campo la cobertura falla: un reintento (salvo errores 4xx), y los datos valen 30 s
        retry: (fallos, error) =>
          !(error instanceof ErrorApi && error.estado >= 400 && error.estado < 500) && fallos < 1,
        staleTime: 30_000,
      },
    },
  })
  return cliente
}

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
