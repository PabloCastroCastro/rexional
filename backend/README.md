# Vestuario · Backend

API REST de Vestuario en **Node.js 24 + TypeScript** con **Hono**. Incluye la base de datos PostgreSQL: esquema, migraciones y datos de ejemplo.

Es un proyecto independiente: tiene sus propias dependencias y no importa código de `frontend/` ni de `proxy/`. Su contrato con el frontend es la API HTTP bajo `/api`, descrita en OpenAPI (a partir de GH-4).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga en caliente (`tsx watch`) |
| `npm run build` | Compila TypeScript a `dist/` |
| `npm start` | Arranca la versión compilada |
| `npm run lint` | Lint y formato con Biome; falla también con avisos |
| `npm run format` | Aplica el formato y las correcciones seguras de Biome |
| `npm run typecheck` | Comprueba los tipos sin compilar |
| `npm run db:generate -- --name <descripcion>` | Genera una migración a partir de los cambios del esquema |
| `npm run db:migrate` | Aplica las migraciones pendientes (el backend también lo hace al arrancar) |
| `npm run db:check` | Falla si el esquema tiene cambios sin migración o si las migraciones son incoherentes (lo ejecuta la CI) |
| `npm run db:seed` | Carga los datos de ejemplo; solo con `ENTORNO=desarrollo` o `pruebas` |

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | `3000` | Puerto HTTP |
| `DATABASE_URL` | | Cadena de conexión a PostgreSQL. Obligatoria |
| `ENTORNO` | | `desarrollo`, `pruebas` o `produccion`. El seed solo se ejecuta en los dos primeros |
| `TZ` | | Zona horaria; debe ser `Europe/Madrid` |
| `CHOKIDAR_USEPOLLING` | `false` | `true` para que `npm run dev` detecte cambios por sondeo (código montado desde Windows). En Compose se activa con `RECARGA_POLLING` |

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
