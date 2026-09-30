# Vestuario

Aplicación web para gestionar clubes de fútbol amateur desde el móvil, con varios equipos por club (uno por categoría): plantilla, asistencia a entrenamientos, convocatorias, caja de multas, personalización por club, estadísticas de partido y planificación de entrenos.

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

Tres capas independientes, cada una en su contenedor y orquestadas con Docker Compose:

| Capa | Tecnología |
|---|---|
| Frontend | React + TypeScript + Vite, PWA, servida por Caddy |
| Backend | Node.js LTS + TypeScript, Hono, Drizzle ORM, Zod, Better Auth |
| Base de datos | PostgreSQL |

El acceso se hace inicialmente por Tailscale. La exposición pública a internet está prevista para el ciclo 10.

## Hoja de ruta

| Ciclo | Objetivo | Versión |
|---|---|---|
| 1 | Base y plantilla | v0.1.0 |
| 2 | Entrenos | v0.2.0 |
| 3 | Convocatorias | v0.3.0 |
| 4 | Multas (paridad con el MVP) | v1.0.0 |
| 5 | Personalización | v1.1.0 |
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

## Desarrollo local

Pendiente de la issue GH-2 (estructura del monorepo y Docker Compose). Cuando esté lista, el entorno completo se arrancará con un solo comando.
