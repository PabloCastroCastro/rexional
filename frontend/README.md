# Vestuario · Frontend

Aplicación web de Vestuario: una **PWA** instalable en el móvil, en **React 19 + TypeScript + Vite**.

Es un proyecto independiente: tiene sus propias dependencias y no importa código de `backend/` ni de `proxy/`. Su relación con el resto es:

- **Con el backend:** llama a la API bajo `/api` en el mismo origen, con un cliente tipado generado del contrato `backend/openapi.json`.
- **Con el proxy:** `npm ci && npm run build` deja los estáticos en `dist/`. La imagen de `proxy/` los compila así y los sirve con nginx.

## Estructura

```
src/
  main.tsx          punto de entrada
  rutas.tsx         rutas (React Router)
  proveedores.tsx   TanStack Query, avisos y confirmaciones
  api/              cliente de la API: esquema.ts (generado) y cliente.ts
  auth/             sesión, login y protección de rutas
  plantillas/       plantilla activa, selector y nueva plantilla
  componentes/      componentes base
  diseno/           estructura común: cabecera y navegación inferior
  paginas/          una página por sección
  pwa/              aviso de versión nueva
  estilos/          tokens.css (variables de diseño) y base.css
public/             logo.svg e iconos de la PWA (generados)
test/               tests con Vitest y Testing Library
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo de Vite en `http://localhost:5173` |
| `npm run build` | Comprueba los tipos y genera los estáticos y el service worker en `dist/` |
| `npm run preview` | Sirve localmente la versión compilada |
| `npm test` | Tests con Vitest (en Docker, ver abajo) |
| `npm run lint` / `npm run format` | Lint y formato con Biome |
| `npm run typecheck` | Comprueba los tipos |
| `npm run api:generar` | Regenera `src/api/esquema.ts` desde `../backend/openapi.json` |
| `npm run api:check` | Falla si `src/api/esquema.ts` no coincide con el contrato (lo ejecuta la CI) |
| `npm run iconos` | Genera los iconos de la PWA desde `public/logo.svg` |

## Diseño

- **Tokens** en `src/estilos/tokens.css`: colores, tipografía, espaciado, radios y medidas. Los componentes usan solo estas variables, nunca colores sueltos. En el ciclo 5 el tema de cada club se aplicará cambiando `--color-primario` y `--color-secundario`.
- **Modo claro y oscuro** automático según el sistema (`prefers-color-scheme`).
- **CSS Modules** por componente (`Boton.module.css`…), sin librerías de estilos.
- **Móvil primero**: cabecera y navegación inferior respetan el área segura (`safe-area-inset`); objetivos táctiles de al menos 44 px; campos de 16 px para que iOS no haga zoom.
- **Accesibilidad**: foco visible con teclado, enlace para saltar al contenido, `prefers-reduced-motion`, diálogos nativos y avisos anunciados a lectores de pantalla.
- Iconos de [Lucide](https://lucide.dev) (`lucide-react`).

## Componentes base

| Componente | Uso |
|---|---|
| `Boton` | Variantes `primario`, `secundario`, `peligro` y `texto`; `cargando` lo desactiva y muestra un indicador |
| `Campo` | Campo de texto con etiqueta, ayuda y error asociados |
| `HojaInferior` | Panel que sube desde abajo para formularios rápidos; se cierra con el botón, Escape o tocando fuera |
| `useConfirmacion()` | `if (await confirmar({ titulo, peligrosa: true })) …` |
| `useAvisos()` | `avisar({ tipo: 'exito', mensaje })`, con acción opcional ("Deshacer") |
| `EstadoVacio` | Pantalla sin datos que invita a actuar |

En desarrollo, **http://localhost:5173/componentes** muestra todos los componentes y colores para probarlos en claro y oscuro. Esta página no existe en la versión compilada.

## Sesión y plantilla activa

| Ruta | Pantalla |
|---|---|
| `/login` | Login. Es la única ruta sin sesión: cualquier otra lleva aquí y, al entrar, devuelve a donde se estaba |
| `/` | Entra en la última plantilla usada o, si solo hay una, en esa; si no, va al selector |
| `/plantillas` | Selector de plantilla, agrupado por club y temporada; los administradores del club pueden crear plantillas |
| `/p/:plantillaId/<sección>` | Las secciones de la plantilla activa: `plantilla`, `entrenos`, `partidos`, `multas` y `mas` |

- **La plantilla activa va en la URL**: el botón Atrás y los enlaces llevan siempre a la plantilla correcta, y se pueden tener dos pestañas con plantillas distintas. La última usada se guarda en el navegador (por usuario).
- **Cambiar de plantilla**: tocando la cabecera, desde cualquier pantalla; se mantiene la sección.
- **Nueva plantilla**: nombre, categoría (lista sugerida o libre), temporada (anterior, actual o siguiente; desde julio cuenta la siguiente) y plantilla anterior, que se propone sola si hay una con el mismo nombre en la temporada previa.
- **Sesión caducada**: si la API responde 401, la app vuelve al login avisando y, al entrar, devuelve a la misma pantalla.
- `src/auth/sesion.ts` usa directamente las tres rutas de Better Auth (entrar, salir y sesión actual), sin su cliente.
- `usePlantillaActiva()` da la plantilla de la URL, con su club y el rol del usuario.

## API

```ts
import { api, datos } from './api/cliente'

const salud = useQuery({ queryKey: ['salud'], queryFn: () => datos(api.GET('/api/health')) })
```

- `api` es un cliente de [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) tipado con `src/api/esquema.ts`: una ruta, un parámetro o un campo que no existan no compilan.
- `datos()` devuelve los datos o lanza un `ErrorApi` con el `codigo`, el `mensaje` y los `detalles` del formato de error común.
- Cuando cambie la API, regenera el cliente con `npm run api:generar` y súbelo junto con el cambio; la imagen del proxy compila el frontend sin el backend, así que el archivo generado se versiona.

El proyecto usa **TypeScript 5.9**: el generador (`openapi-typescript`) necesita la API de compilador de TypeScript 5, que la versión 7 nativa ya no tiene.

## PWA

Con `vite-plugin-pwa`:

- **Manifest**: nombre, color `#14553d`, pantalla completa e iconos (normales, *maskable* para Android y `apple-touch-icon` para iOS).
- **Service worker** generado al compilar: guarda la aplicación para abrirla al instante. **La API no se cachea**: los datos se piden siempre al servidor.
- **Versiones nuevas**: no se activan solas; aparece el aviso "Hay una versión nueva de Vestuario" con el botón *Actualizar*, para no recargar en mitad de pasar lista.
- En desarrollo no hay service worker.

Para instalarla en el móvil hace falta HTTPS (GH-13): en Android, *Instalar aplicación*; en iOS, Safari → *Compartir* → *Añadir a pantalla de inicio*.

## Desarrollo

Lo habitual es arrancarlo con el resto de servicios desde la raíz del repositorio (ver el README principal). Los tests y las herramientas con binarios nativos se ejecutan en el contenedor:

```
docker compose -f docker-compose.dev.yml exec frontend npm test
docker compose -f docker-compose.dev.yml exec frontend npm run iconos
```

Para trabajar solo en el frontend, con el backend en `localhost:3000`: `npm install` y `npm run dev`.

### Variables de entorno (desarrollo)

| Variable | Por defecto | Descripción |
|---|---|---|
| `API_PROXY_TARGET` | `http://localhost:3000` | Adónde redirige Vite las peticiones a `/api` |
| `VITE_USE_POLLING` | `false` | `true` para detectar cambios por sondeo (código montado desde Windows). En Compose se activa con `RECARGA_POLLING` |

## Imagen Docker

El `Dockerfile` tiene dos etapas:

- `dev`: ejecuta el servidor de Vite con el código montado desde el host.
- `build`: compila los estáticos en `/app/dist`, útil para comprobar la compilación de forma aislada.

```
docker build --target build -t vestuario-frontend-build .
```
