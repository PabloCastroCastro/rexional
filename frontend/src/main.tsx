import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { crearClienteConsultas, Proveedores } from './proveedores'
import { crearRouter } from './rutas'
import './estilos/tokens.css'
import './estilos/base.css'

const raiz = document.getElementById('root')
if (!raiz) throw new Error('Falta el elemento #root en index.html')

createRoot(raiz).render(
  <StrictMode>
    <Proveedores cliente={crearClienteConsultas()}>
      <RouterProvider router={crearRouter()} />
    </Proveedores>
  </StrictMode>,
)
