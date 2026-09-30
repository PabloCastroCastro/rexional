# Vestuario · Backend

API REST de Vestuario en **Node.js 24 + TypeScript** con **Hono**. Incluye la base de datos: esquema, migraciones y seed de PostgreSQL (a partir de GH-3).

Es un proyecto independiente: tiene sus propias dependencias y no importa código de `frontend/` ni de `proxy/`. Su contrato con el frontend es la API HTTP bajo `/api`, descrita en OpenAPI (a partir de GH-4).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga en caliente (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Arranca la versión compilada |
| `npm run typecheck` | Comprueba los tipos sin compilar |

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DATABASE_URL` | | Cadena de conexión a PostgreSQL (se usa a partir de GH-3) |
| `TZ` | | Zona horaria; debe ser `Europe/Madrid` |

## Desarrollo

Lo habitual es arrancarlo con el resto de servicios desde la raíz del repositorio (ver el README principal):

```
docker compose -f docker-compose.dev.yml up
```

Para trabajar solo en el backend, sin Docker:

```
npm install
npm run dev
```

La API queda en `http://localhost:3000/api/health`.

## Imagen Docker

El `Dockerfile` tiene varias etapas:

- `dev`: dependencias completas; ejecuta `npm run dev` con el código montado desde el host.
- `runtime` (la final): solo el código compilado y las dependencias de producción, con el usuario `node` sin privilegios.

```
docker build -t vestuario-backend .
```
