import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { aplicarTemaGuardado } from './diseno/tema'
import { crearClienteConsultas, Proveedores } from './proveedores'
import { crearRouter } from './rutas'
// Saira Condensed para los títulos y los números (GH-227): solo los caracteres latinos y dos pesos
import '@fontsource/saira-condensed/latin-600.css'
import '@fontsource/saira-condensed/latin-700.css'
import './estilos/tokens.css'
import './estilos/base.css'

// Los colores del club de la última plantilla, antes de pintar nada: sin parpadeo del tema por
// defecto (GH-29)
aplicarTemaGuardado()

const raiz = document.getElementById('root')
if (!raiz) throw new Error('Falta el elemento #root en index.html')

createRoot(raiz).render(
  <StrictMode>
    <Proveedores cliente={crearClienteConsultas()}>
      <RouterProvider router={crearRouter()} />
    </Proveedores>
  </StrictMode>,
)
