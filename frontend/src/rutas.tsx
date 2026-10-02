import { createBrowserRouter, Navigate } from 'react-router'
import { PaginaLogin } from './auth/PaginaLogin'
import { RequiereSesion } from './auth/RequiereSesion'
import { PaginaConfiguracion } from './configuracion/PaginaConfiguracion'
import { Aplicacion } from './diseno/Aplicacion'
import { PaginaComponentes } from './paginas/PaginaComponentes'
import { PaginaMas } from './paginas/PaginaMas'
import { PaginaNoEncontrada } from './paginas/PaginaNoEncontrada'
import { PaginaEntrenos, PaginaMultas, PaginaPartidos, PaginaPlantilla } from './paginas/Secciones'
import { Inicio } from './plantillas/Inicio'
import { PaginaElegirPlantilla } from './plantillas/PaginaElegirPlantilla'
import { PlantillaActiva } from './plantillas/PlantillaActiva'

// /login es la única ruta sin sesión. La plantilla activa va en la URL: /p/:plantillaId/<sección>
export const rutas = [
  { path: '/login', element: <PaginaLogin /> },
  // Catálogo de componentes: solo en desarrollo, no existe en la versión compilada
  ...(import.meta.env.DEV
    ? [
        {
          path: '/componentes',
          element: (
            <main style={{ padding: '1rem' }}>
              <PaginaComponentes />
            </main>
          ),
        },
      ]
    : []),
  {
    path: '/',
    element: <RequiereSesion />,
    children: [
      { index: true, element: <Inicio /> },
      { path: 'plantillas', element: <PaginaElegirPlantilla /> },
      {
        path: 'p/:plantillaId',
        element: <PlantillaActiva />,
        children: [
          {
            element: <Aplicacion />,
            children: [
              { index: true, element: <Navigate to="plantilla" replace /> },
              { path: 'plantilla', element: <PaginaPlantilla /> },
              { path: 'entrenos', element: <PaginaEntrenos /> },
              { path: 'partidos', element: <PaginaPartidos /> },
              { path: 'multas', element: <PaginaMultas /> },
              { path: 'mas', element: <PaginaMas /> },
              { path: 'mas/configuracion', element: <PaginaConfiguracion /> },
              { path: '*', element: <PaginaNoEncontrada /> },
            ],
          },
        ],
      },
      { path: '*', element: <PaginaNoEncontrada /> },
    ],
  },
]

export const crearRouter = () => createBrowserRouter(rutas)
