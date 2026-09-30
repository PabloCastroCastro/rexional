# Cómo contribuir

Guía del flujo de trabajo de Vestuario. El detalle y el porqué de cada decisión están en la sección 9 del [documento de proyecto](docs/vestuario-proyecto.md).

## Issues

Todo trabajo empieza con una issue creada con la plantilla que corresponda:

- **Funcionalidad:** descripción, criterios de aceptación y capas afectadas.
- **Fallo:** entorno (pruebas o producción), pasos, resultado esperado y obtenido.

Cada issue va en el milestone del ciclo al que pertenece y lleva sus etiquetas de capa (`db`, `backend`, `frontend`, `infra`, `seguridad`).

## Ramas

| Tipo | Rama | Sale de | Se mergea a |
|---|---|---|---|
| Funcionalidad | `feature/GH-<n>[-descripcion]` | `develop` | `develop` |
| Fallo detectado en pruebas | `fix/GH-<n>[-descripcion]` | `develop` | `develop` |
| Fallo en producción | `hotfix/GH-<n>[-descripcion]` | `main` | `main` (nuevo tag) y `develop` |

- `main` solo contiene versiones publicadas. Cada merge lleva tag y se despliega en producción.
- `develop` es la rama de integración y lo que corre en el entorno de pruebas.
- `<n>` es el número de la issue. La descripción es opcional, en minúsculas y con guiones: `feature/GH-8-api-jugadores`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/es/) con la referencia a la issue al final:

```
feat(jugadores): alta de jugadores GH-8
fix(multas): redondeo de importes GH-24
```

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`. El ámbito entre paréntesis es el módulo afectado (`jugadores`, `entrenos`, `multas`, `auth`, `infra`…).

## Pull requests

- Todo cambio entra mediante pull request, nunca con push directo a `develop` o `main`.
- La descripción incluye `Closes #<n>` para cerrar la issue al mergear.
- Rellena la plantilla y sus comprobaciones.

## Integración continua

Cada pull request a `develop` o `main`, y cada push a esas ramas, ejecuta el workflow `CI` (`.github/workflows/ci.yml`). Solo se ejecutan los trabajos de los proyectos con cambios:

| Trabajo | Se ejecuta si cambia | Qué comprueba |
|---|---|---|
| Backend | `backend/` | Lint y formato, tipos, compilación, tests contra PostgreSQL, migraciones, contrato OpenAPI e imagen Docker |
| Frontend | `frontend/` | Lint y formato, tipos, compilación y tests |
| Proxy | `proxy/` o `frontend/` | Imagen Docker (compila el frontend) y `nginx -t` |
| Prueba de humo | cualquiera de los anteriores o `docker-compose.yml` | `docker compose up` completo y la API a través de nginx |
| Resultado de la CI | siempre | Falla si algún trabajo ha fallado. Es la comprobación que se exige para mergear |

Los trabajos llaman a estos scripts de npm. Los marcados como opcionales solo se ejecutan si el proyecto los define, así que una comprobación nueva se activa en cuanto se añade su script:

| Script | Proyecto | Obligatorio |
|---|---|---|
| `lint` (Biome; la CI usa `biome ci`) | backend, frontend | Sí |
| `typecheck`, `build` | backend, frontend | Sí |
| `test` | backend, frontend | No (backend a partir de GH-4) |
| `db:check`: falla si hay cambios de esquema sin migración | backend | No (a partir de GH-3) |
| `openapi:check`: falla si `openapi.json` está desactualizado | backend | No (a partir de GH-4) |

Antes de subir cambios, ejecuta `npm run format` y `npm run lint` en el proyecto que hayas tocado.

## Versiones

Versionado semántico con tags `vMAYOR.MENOR.PARCHE` y release en GitHub con notas generadas.

- `0.x` durante el MVP; `v1.0.0` al cerrar el ciclo 4.
- **MENOR:** cierre de ciclo o conjunto de funcionalidades.
- **PARCHE:** hotfixes.

Para publicar una versión se mergea `develop` en `main` mediante pull request, se crea el tag sobre `main` y la release en GitHub, y se despliega con `scripts/deploy.sh pro vX.Y.Z`.

## Hotfix

1. Crea la issue con la plantilla de fallo, entorno producción, y la etiqueta `hotfix`.
2. Crea la rama `hotfix/GH-<n>` desde `main`.
3. Abre el pull request contra `main`. Tras el merge, crea el tag con el PARCHE incrementado y despliega.
4. Lleva la corrección a `develop` con otro pull request desde `main` (o `cherry-pick` del commit).

## Migraciones de base de datos

- Cada cambio de esquema es una migración generada con drizzle-kit (`npm run db:generate -- --name <descripcion>` en `backend/`) dentro de la issue que lo necesita (etiqueta `db`). Se revisa el SQL generado y se sube junto con el cambio del esquema; la CI falla si falta (`db:check`).
- Nunca se edita una migración ya desplegada: los cambios se hacen con una migración nueva.
- Se prueba primero en el entorno de pruebas.
- El despliegue a producción hace copia de seguridad antes de migrar. El backend aplica las migraciones pendientes al arrancar.

## Definición de terminado

Una issue está terminada cuando:

- [ ] Cumple sus criterios de aceptación en el entorno de pruebas.
- [ ] Pasa la CI (lint, tipos y tests).
- [ ] Incluye migraciones si cambia el esquema.
- [ ] Está mergeada en `develop` mediante pull request.
