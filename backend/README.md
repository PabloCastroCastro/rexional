# Vestuario · Backend

API REST de Vestuario en **Node.js 24 + TypeScript** con **Hono**. Incluye la base de datos PostgreSQL: esquema, migraciones y datos de ejemplo.

Es un proyecto independiente: tiene sus propias dependencias y no importa código de `frontend/` ni de `proxy/`. Su contrato con el frontend es la API HTTP bajo `/api`, descrita en OpenAPI en [`openapi.json`](openapi.json).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga en caliente (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Arranca la versión compilada |
| `npm run lint` | Lint y formato con Biome; falla también con avisos |
| `npm run format` | Aplica el formato y las correcciones seguras de Biome |
| `npm run typecheck` | Comprueba los tipos sin compilar |
| `npm test` | Tests con Vitest contra PostgreSQL (ver [Tests](#tests)) |
| `npm run openapi` | Exporta el contrato a `openapi.json` |
| `npm run openapi:check` | Falla si `openapi.json` no coincide con la API (lo ejecuta la CI) |
| `npm run db:generate -- --name <descripcion>` | Genera una migración a partir de los cambios del esquema |
| `npm run db:migrate` | Aplica las migraciones pendientes (el backend también lo hace al arrancar) |
| `npm run db:check` | Falla si el esquema tiene cambios sin migración o si las migraciones son incoherentes (lo ejecuta la CI) |
| `npm run db:seed` | Carga los datos de ejemplo; solo con `ENTORNO=desarrollo` o `pruebas` |

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `ENTORNO` | | Obligatoria: `desarrollo`, `pruebas` o `produccion`. En producción no se publica la documentación de la API y el seed no se ejecuta |
| `DATABASE_URL` | | Obligatoria. Cadena de conexión a PostgreSQL |
| `TZ` | | Obligatoria y debe ser `Europe/Madrid` |
| `PORT` | `3000` | Puerto HTTP |
| `DB_POOL_MAX` | `10` | Conexiones máximas del pool de PostgreSQL |
| `DB_TIMEOUT_CONEXION_MS` | `5000` | Tiempo máximo para obtener una conexión |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` o `silent` |
| `TEST_DATABASE_URL` | | Base de datos de los tests; debe terminar en `_test`. Si no está, se usa `DATABASE_URL` |
| `CHOKIDAR_USEPOLLING` | `false` | `true` para que `npm run dev` detecte cambios por sondeo (código montado desde Windows). En Compose se activa con `RECARGA_POLLING` |

La configuración se valida al arrancar (`src/config.ts`): si falta una variable o no es válida, el backend no arranca y dice cuál.

## API

```
src/
  index.ts        arranque: migraciones y servidor
  app.ts          crearApp(): middleware, errores, rutas y documentación
  config.ts       configuración validada
  errores.ts      formato de error común y ErrorApi
  peticiones.ts   log de cada petición
  rutas/          una carpeta de rutas por módulo (salud.ts)
```

- **Rutas** con `@hono/zod-openapi`: el esquema de Zod valida la petición y a la vez genera el contrato OpenAPI.
- **Errores** con el formato `{ error: { codigo, mensaje, detalles? } }`:
  - validación → 400 `validacion`, con los campos que fallan en `detalles` y los mensajes de Zod en español;
  - ruta inexistente → 404 `no_encontrado`;
  - `throw new ErrorApi(409, 'dorsal_en_uso', 'El dorsal 7 ya está en uso')` → ese estado y código;
  - cualquier otro error → 500 `error_interno`, sin detalles internos (que sí quedan en el log).
- **`GET /api/health`**: 200 si la API y la base de datos funcionan; 503 si PostgreSQL no responde, lo que marca el contenedor como no sano.
- **Documentación** interactiva en `/api/docs` (Scalar) y contrato en `/api/openapi.json`, salvo con `ENTORNO=produccion`. Tras cambiar la API, actualiza el contrato versionado con `npm run openapi`.
- **Logs** con pino: JSON de una línea en pruebas y producción, legibles en desarrollo. Cada petición registra método, ruta, estado y duración, sin cuerpos, cabeceras ni parámetros; los healthchecks solo con `LOG_LEVEL=debug`.

## Tests

Vitest contra un PostgreSQL real. Los tests crean y borran datos, así que solo se ejecutan contra una base cuyo nombre termine en `_test`; si no existe, se crea y se le aplican las migraciones.

```
docker compose -f docker-compose.dev.yml exec backend npm test      # desde la raíz del repositorio
```

En Docker la base es `vestuario_test`, en el mismo PostgreSQL de desarrollo. Fuera de Docker, define `TEST_DATABASE_URL` (por ejemplo `postgres://vestuario:vestuario@localhost:5432/vestuario_test`).

- `test/api.test.ts`: salud, documentación y formato de errores.
- `test/config.test.ts`: validación de la configuración.
- `test/restricciones.test.ts`: reglas del modelo que garantiza la base de datos; cada caso en una transacción que se deshace.

## Base de datos

```
src/db/
  schema/      esquema de Drizzle: auth.ts (Better Auth) y clubes.ts (clubes, plantillas, jugadores y fichas)
  cliente.ts   conexión (pool de pg + Drizzle)
  migrar.ts    aplica las migraciones pendientes; se llama al arrancar
  seed.ts      datos de ejemplo
drizzle/       migraciones SQL generadas y versionadas (no se editan a mano una vez desplegadas)
scripts/db-check.mjs
```

El modelo sigue la sección 6 del documento de proyecto: un **club** tiene **plantillas** (una categoría en una temporada); los **jugadores** son del club y participan en cada temporada con una **ficha**. Muchas reglas las garantiza la propia base de datos:

- Temporada con formato `AAAA-AA` y años consecutivos.
- Nombre de plantilla único por club y temporada.
- Jugador y plantilla de una ficha del mismo club, y una sola ficha por jugador y temporada (claves foráneas compuestas).
- Dorsal 0–99 y único entre los jugadores activos de la plantilla.
- Colores en hex y textos obligatorios no vacíos.

Los identificadores son UUID v7 generados por PostgreSQL (`uuidv7()`).

### Cambiar el esquema

1. Modifica `src/db/schema/`.
2. Genera la migración: `npm run db:generate -- --name descripcion_del_cambio`.
3. Revisa el SQL generado en `drizzle/` y súbelo junto con el cambio del esquema.

### Datos de ejemplo

`npm run db:seed` carga dos clubes con las temporadas 2025-26 y 2026-27, e incluye un jugador que sube del Juvenil al Senior y un entrenador que cambia de plantilla. Es idempotente: se puede ejecutar varias veces sin duplicar nada.

| Usuario | Contraseña | Acceso |
|---|---|---|
| `admin@rexional.test` | `vestuario-dev` | Administradora del CD Rexional |
| `entrenador@rexional.test` | `vestuario-dev` | Entrenador del Juvenil 2025-26 y del Senior 2026-27 |
| `admin@ejemplo.test` | `vestuario-dev` | Administradora de la UD Ejemplo |

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

Necesita `DATABASE_URL` apuntando a un PostgreSQL 18. La API queda en `http://localhost:3000/api/health`.

## Imagen Docker

El `Dockerfile` tiene varias etapas:

- `dev`: dependencias completas; ejecuta `npm run dev` con el código montado desde el host.
- `runtime` (la final): solo el código compilado, las migraciones y las dependencias de producción, con el usuario `node` sin privilegios.

```
docker build -t vestuario-backend .
```
