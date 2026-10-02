import { createBrowserRouter, Navigate } from 'react-router'
import { Aplicacion } from './diseno/Aplicacion'
import { PaginaComponentes } from './paginas/PaginaComponentes'
import { PaginaMas } from './paginas/PaginaMas'
import { PaginaNoEncontrada } from './paginas/PaginaNoEncontrada'
import { PaginaEntrenos, PaginaMultas, PaginaPartidos, PaginaPlantilla } from './paginas/Secciones'

export const rutas = [
  {
    path: '/',
    element: <Aplicacion />,
    children: [
      { index: true, element: <Navigate to="/plantilla" replace /> },
      { path: 'plantilla', element: <PaginaPlantilla /> },
      { path: 'entrenos', element: <PaginaEntrenos /> },
      { path: 'partidos', element: <PaginaPartidos /> },
      { path: 'multas', element: <PaginaMultas /> },
      { path: 'mas', element: <PaginaMas /> },
      // Catálogo de componentes: no existe en la versión compilada
      ...(import.meta.env.DEV ? [{ path: 'componentes', element: <PaginaComponentes /> }] : []),
      { path: '*', element: <PaginaNoEncontrada /> },
    ],
  },
]

export const crearRouter = () => createBrowserRouter(rutas)
