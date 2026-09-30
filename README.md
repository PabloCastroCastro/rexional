# Vestuario

[![CI](https://github.com/PabloCastroCastro/rexional/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/PabloCastroCastro/rexional/actions/workflows/ci.yml)

Aplicación web para gestionar clubes de fútbol amateur desde el móvil, con una plantilla por categoría y temporada: jugadores, asistencia a entrenamientos, convocatorias, caja de multas, personalización por club, estadísticas de partido y planificación de entrenos.

Se instala como PWA desde el navegador, sin tiendas de aplicaciones, y se autoaloja en un servidor propio con software libre y coste cero.

> **Estado:** en fase de diseño. Todavía no hay código; el trabajo está organizado en issues y milestones de GitHub.

## Documentación

Todas las decisiones funcionales, técnicas y de organización, además del backlog completo, están en el [documento de proyecto](docs/vestuario-proyecto.md):

- Requisitos funcionales, roles y permisos
- Arquitectura, infraestructura y modelo de datos
- Contrato de la API y pantallas del frontend
- Flujo de trabajo: ramas, commits, versiones y definición de terminado
- Plan de ciclos y backlog de issues

## Arquitectura

Un repositorio con tres proyectos independientes, cada uno con sus dependencias y su contenedor, orquestados con Docker Compose:

| Proyecto | Carpeta | Tecnología |
|---|---|---|
| Frontend | `frontend/` | React + TypeScript + Vite, PWA |
| Backend | `backend/` | Node.js LTS + TypeScript, Hono, Drizzle ORM, Zod, Better Auth y PostgreSQL |
| Proxy | `proxy/` | nginx: sirve la PWA y redirige `/api` al backend |

El acceso se hace inicialmente por Tailscale. La exposición pública a internet está prevista para el ciclo 10.

## Hoja de ruta

| Ciclo | Objetivo | Versión |
|---|---|---|
| 1 | Base y plantilla | v0.1.0 |
| 2 | Entrenos | v0.2.0 |
| 3 | Convocatorias | v0.3.0 |
| 4 | Multas (paridad con el MVP) | v1.0.0 |
| 5 | Personalización y temporadas | v1.1.0 |
| 6 | Estadísticas | v1.2.0 |
| 7 | Planificación de entrenos | v1.3.0 |
| 8 | Operación | v1.4.0 |
| 9 | Roles en uso | v1.5.0 |
| 10 | Exposición pública | v2.0.0 |

El avance de cada ciclo se sigue en los [milestones](https://github.com/PabloCastroCastro/rexional/milestones).

## Cómo contribuir

- Ramas `feature/GH-<n>`, `fix/GH-<n>` y `hotfix/GH-<n>`; `develop` es la rama de integración y `main` solo contiene versiones publicadas.
- Commits con [Conventional Commits](https://www.conventionalcommits.org/es/) y referencia a la issue, por ejemplo `feat(jugadores): alta de jugadores GH-8`.
- Todo cambio entra por pull request con `Closes #<n>`.

El detalle está en la [guía de contribución](CONTRIBUTING.md).

## Estructura del repositorio

```
frontend/                PWA (React + Vite)
backend/                 API (Node + Hono) y base de datos (PostgreSQL)
proxy/                   nginx: sirve la PWA y redirige /api al backend
docker-compose.dev.yml   desarrollo local
docker-compose.yml       servidor (pruebas y producción)
.env.example             configuración de Compose
docs/                    documento de proyecto
```

Cada proyecto es independiente: tiene sus propias dependencias, su Dockerfile y su README, y no importa código de los demás.

## Desarrollo local

Requisitos: [Docker](https://docs.docker.com/get-docker/) con Docker Compose. Node.js 24 solo hace falta para trabajar en un proyecto fuera de Docker.

Arranca todo con un solo comando:

```
docker compose -f docker-compose.dev.yml up --build
```

| Servicio | Dirección |
|---|---|
| Aplicación (Vite, con recarga en caliente) | http://localhost:5173 |
| API | http://localhost:3000/api/health (también a través de http://localhost:5173/api) |
| Documentación de la API | http://localhost:3000/api/docs |
| PostgreSQL | `localhost:5432`, usuario, contraseña y base de datos `vestuario` |

El código de `backend/` y `frontend/` se monta en los contenedores, así que los cambios se aplican al guardar. **En Windows**, con el repositorio en `C:\`, los cambios no llegan como eventos a los contenedores y la recarga no se produce: pon `RECARGA_POLLING=true` en un `.env` (copia de `.env.example`). Si clonas el repositorio dentro de WSL no hace falta.

Si cambian las dependencias de un proyecto, reconstruye y renueva sus `node_modules`:

```
docker compose -f docker-compose.dev.yml up --build --renew-anon-volumes
```

El backend aplica las migraciones de la base de datos al arrancar. Para cargar datos de ejemplo (dos clubes con dos temporadas, jugadores y usuarios con contraseña `vestuario-dev`; ver el README del backend):

```
docker compose -f docker-compose.dev.yml exec backend npm run db:seed
```

Los datos de ejemplo incluyen usuarios para iniciar sesión. Para crear otro usuario con su club:

```
docker compose -f docker-compose.dev.yml exec backend npm run crear-admin
```

Los tests del backend se ejecutan en su contenedor, contra una base de datos de test aparte:

```
docker compose -f docker-compose.dev.yml exec backend npm test
```

Para trabajar en un solo proyecto sin Docker, sigue el README de su carpeta.

## Probar la versión de servidor en local

```
cp .env.example .env        # y define POSTGRES_PASSWORD
docker compose up --build
```

La aplicación queda en http://localhost:8080, servida por nginx.
