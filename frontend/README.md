# Vestuario · Frontend

Aplicación web de Vestuario (PWA) en **React + TypeScript + Vite**.

Es un proyecto independiente: tiene sus propias dependencias y no importa código de `backend/` ni de `proxy/`. Su relación con el resto es:

- **Con el backend:** llama a la API bajo `/api` en el mismo origen. Desde GH-9, el cliente se genera a partir del contrato `backend/openapi.json`.
- **Con el proxy:** `npm ci && npm run build` deja los estáticos en `dist/`. La imagen de `proxy/` los compila así y los sirve con nginx.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo de Vite en `http://localhost:5173` |
| `npm run build` | Comprueba los tipos y genera los estáticos en `dist/` |
| `npm run preview` | Sirve localmente la versión compilada |
| `npm run typecheck` | Comprueba los tipos |

## Variables de entorno (desarrollo)

| Variable | Por defecto | Descripción |
|---|---|---|
| `API_PROXY_TARGET` | `http://localhost:3000` | Adónde redirige Vite las peticiones a `/api` |
| `VITE_USE_POLLING` | `false` | `true` si los cambios no se detectan con el código montado en Docker (p. ej. en Windows) |

## Desarrollo

Lo habitual es arrancarlo con el resto de servicios desde la raíz del repositorio (ver el README principal). Para trabajar solo en el frontend, con el backend arrancado en `localhost:3000`:

```
npm install
npm run dev
```

## Imagen Docker

El `Dockerfile` tiene dos etapas:

- `dev`: ejecuta el servidor de Vite con el código montado desde el host.
- `build`: compila los estáticos en `/app/dist`, útil para comprobar la compilación de forma aislada.

```
docker build --target build -t vestuario-frontend-build .
```
