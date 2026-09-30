# Vestuario · Documento de proyecto

Aplicación para la gestión de clubes y equipos de fútbol amateur, con varias categorías por club: plantilla, asistencia a entrenamientos, convocatorias, multas, personalización visual por club y estadísticas de partido.

Este documento recoge todas las decisiones funcionales, técnicas y de organización del proyecto, y el backlog completo de issues organizado por ciclos.

---

## 0. Instrucciones para Claude Code

> Esta sección está dirigida al agente que procese este documento.

**Objetivo:** crear en el repositorio de GitHub las etiquetas, los milestones y las 59 issues definidas en la sección 11 (Backlog). **No escribas código, no crees ramas ni archivos**: solo la configuración de issues.

**Requisitos previos**

- El repositorio ya existe y está vacío o con un commit inicial. Pregunta al usuario su nombre (`usuario/repositorio`) si no está claro desde el directorio actual.
- Usa GitHub CLI (`gh`) autenticado o la conexión con GitHub disponible. Comprueba el acceso antes de empezar.

**Pasos**

1. **Etiquetas**: crea las de la sección 11.1 con su color y descripción. Si ya existe alguna, actualízala en lugar de fallar.
2. **Milestones**: crea los diez de la sección 11.2, en ese orden, con su título exacto y descripción.
3. **Issues**: crea todas las issues de la sección 11.3 **en el orden exacto en que aparecen**, para que la numeración de GitHub coincida con la prevista (`GH-1`, `GH-2`…). Para cada una:
   - Título: el de la línea **Título**, tal cual.
   - Etiquetas: las indicadas en la línea *Etiquetas*.
   - Milestone: el del ciclo bajo el que aparece.
   - Cuerpo: todo el contenido desde la línea siguiente a *Etiquetas* hasta el siguiente encabezado `#### GH-`, `### Milestone` o separador `---`, en Markdown, respetando las casillas `- [ ]`.
   - El encabezado `#### GH-n` indica el número previsto; **no** forma parte del título.
   - Las referencias del tipo "depende de GH-n" déjalas tal cual; GitHub las enlazará.
4. **Idempotencia**: antes de crear cada issue, comprueba si ya existe otra con el mismo título. Si existe, no la dupliques y continúa.
5. **Verificación**: al terminar, muestra una tabla con número, título y milestone de cada issue creada, y avisa si algún número no coincide con el previsto (por ejemplo, porque el repositorio ya tuviera issues o pull requests).

**No hagas**: cerrar issues, crear proyectos, modificar la configuración del repositorio ni la protección de ramas. Eso lo hará el usuario.

---

## 1. Visión y alcance

**Problema:** el entrenador de dos equipos amateur necesita llevar de forma sencilla la plantilla, la asistencia a entrenamientos, las convocatorias de partido y la caja de multas del vestuario, hoy repartidas entre WhatsApp, notas y hojas de cálculo.

**Usuarios**

- **Fase actual:** solo el entrenador, con acceso a los dos equipos.
- **Clubes con varias categorías:** un club puede tener equipos en varias categorías (alevín, infantil, cadete…), cada uno con su propia plantilla, entrenos, partidos y multas, y todos con la identidad visual del club.
- **Fase futura:** delegados y jugadores con acceso limitado según su rol. El modelo de datos y los permisos se diseñan con roles desde el principio, aunque inicialmente solo se use el de entrenador/admin.

**Principios**

- **Sencillez:** cada pantalla resuelve una tarea concreta en pocos toques desde el móvil.
- **Móvil primero:** se usa en el campo, al borde del terreno de juego. Aplicación web instalable (PWA), sin tiendas de aplicaciones.
- **Coste cero:** software libre, autoalojado en un servidor propio. Sin suscripciones a servicios en la nube.
- **Proyectos independientes:** un único repositorio con tres proyectos independientes (frontend, backend con su base de datos, y proxy), cada uno con sus dependencias y su contenedor.
- **Iterativo:** se construye en ciclos cortos, cada uno termina con algo usable.

**Fuera de alcance por ahora**

- Integración automática con la Real Federación Gallega de Fútbol (no ofrece API pública y su web no permite acceso automatizado). Se deja preparado un punto de entrada para importadores de datos.
- Pagos online de multas o cuotas.
- Aplicaciones nativas en tiendas.

---

## 2. Requisitos funcionales

### 2.1 Clubes y equipos

- **Club:** la entidad que agrupa categorías. Tiene nombre e identidad visual (escudo y colores), compartida por todos sus equipos.
- **Equipo:** cada categoría concreta de un club (p. ej. "Infantil A", "Infantil B", "Cadete"). Es la unidad de trabajo: tiene su propia plantilla, entrenos, partidos, catálogo y caja de multas, estadísticas y biblioteca de ejercicios.
  - Datos: nombre, categoría y temporada.
  - Categoría elegida de una lista sugerida (prebenjamín, benjamín, alevín, infantil, cadete, juvenil, sénior, veteranos) o texto libre.
  - Puede haber varios equipos de la misma categoría en un club.
- El sistema gestiona varios clubes, cada uno con uno o varios equipos (inicialmente, dos equipos).
- Los **administradores del club** crean, editan y borran sus equipos, gestionan la identidad del club y tienen rol admin en todos sus equipos.
- Un usuario puede tener acceso a uno o varios equipos, de uno o varios clubes, con un rol en cada uno.
- Tras iniciar sesión, si el usuario tiene acceso a más de un equipo, elige el **equipo activo** en un selector agrupado por club. Puede cambiarlo desde cualquier pantalla y la aplicación recuerda el último usado.
- Todas las funcionalidades trabajan siempre sobre el equipo activo.
- Un jugador pertenece a un único equipo. Convocar a jugadores de otra categoría del mismo club queda fuera de alcance por ahora.

### 2.2 Plantilla

- Alta de jugador: nombre, dorsal (opcional, 0–99) y posición (portero, defensa, centrocampista, delantero).
- Edición de los datos del jugador.
- Baja **lógica**: el jugador deja de aparecer en la plantilla activa pero se conserva su historial de asistencia, multas y estadísticas. Posibilidad de reactivarlo.
- El dorsal es único entre los jugadores activos de un mismo equipo.
- Lista ordenada por dorsal y, a igualdad, por nombre. En cada jugador se muestra su porcentaje de asistencia y su deuda de multas pendiente (cuando existan esos módulos).

### 2.3 Entrenamientos y asistencia

- Pasar lista para una fecha (por defecto, hoy, en la zona horaria `Europe/Madrid`). Si el entreno no existe (no se planificó), se crea al registrar la primera asistencia.
- Tres estados por jugador: **asiste**, **justificada** (falta con motivo, texto opcional) y **falta**.
- Marcar de nuevo el estado seleccionado lo deja sin registrar.
- Historial de entrenos con el recuento de cada estado; desde el historial se puede abrir y corregir un entreno pasado.
- Porcentaje de asistencia por jugador: asistencias / entrenos en los que tiene estado registrado.

### 2.4 Partidos y convocatorias

- Crear partido: rival, fecha, hora del partido, hora de citación, lugar, local/visitante y competición (opcional).
- Seleccionar los convocados entre los jugadores activos.
- Generar el mensaje de convocatoria en texto, listo para copiar o compartir por WhatsApp (enlace `wa.me`), con equipo, rival, fecha, horas, lugar y lista de convocados por dorsal.
- Listado de partidos próximos y pasados; editar o borrar un partido.

### 2.5 Multas

- **Catálogo de motivos** por equipo con importe (editable). Valores iniciales al crear un equipo: llegar tarde al entreno (2 €), faltar sin avisar (5 €), olvidar la equipación (3 €), tarjeta amarilla por protestar (5 €), tarjeta roja (10 €).
- Cada motivo puede asociarse opcionalmente a un tipo de tarjeta (amarilla o roja), para proponerlo al registrar estadísticas de partido (ciclo 6). En el catálogo inicial, "tarjeta amarilla por protestar" se asocia a amarilla y "tarjeta roja" a roja.
- Registrar multa: jugador, motivo (del catálogo u "otro" con texto libre), importe (se rellena desde el catálogo y es editable) y fecha.
- El motivo y el importe se **copian** en la multa: cambiar el catálogo no altera multas pasadas.
- Marcar una multa como cobrada (guarda la fecha de pago; una multa está cobrada si y solo si tiene fecha de pago) o deshacerlo. Saldar de una vez todas las multas pendientes de un jugador.
- Resumen: total pendiente de cobro, total en caja (cobrado) y deuda por jugador ordenada de mayor a menor.

### 2.6 Personalización visual (ciclo posterior al MVP)

- Pantalla de configuración con dos partes:
  - **Datos del equipo** (entrenador o superior): nombre, categoría y temporada.
  - **Identidad del club** (solo administradores del club): nombre del club, escudo y dos colores (principal y secundario), comunes a todas sus categorías.
- Escudo en PNG o WebP (SVG excluido inicialmente por seguridad), tamaño máximo configurable.
- Vista previa en vivo de la aplicación con los colores elegidos.
- Al cambiar de equipo activo, toda la interfaz adopta el escudo y los colores de su club.
- Contraste automático: el texto sobre el color principal se muestra en blanco o negro según su luminosidad.

### 2.7 Estadísticas de partido (ciclo posterior)

- Cada partido pertenece a una temporada (por defecto, la temporada actual del equipo al crearlo), de modo que cambiar la temporada del equipo no altera los partidos pasados.
- Registrar el resultado (goles a favor y en contra) y marcar el partido como jugado.
- Participación de cada convocado: titular o suplente y minutos jugados (calculables a partir de los cambios).
- Eventos del partido con jugador y minuto: gol, asistencia, tarjeta amarilla, tarjeta roja, entra, sale, gol en propia puerta.
- Estadísticas acumuladas de temporada: goleadores, asistentes, minutos, partidos jugados y tarjetas por jugador.
- Al registrar una tarjeta, la aplicación propone las multas del catálogo asociadas a ese tipo de tarjeta, si las hay (el entrenador confirma).
- **Arquitectura de importadores**: las estadísticas entran por un único servicio con fuentes intercambiables. Fuente inicial: manual. Previstas: importación asistida desde el PDF del acta y, si se obtiene acceso, datos de la federación.

### 2.8 Planificación de entrenamientos (ciclo posterior)

**Biblioteca de ejercicios** del equipo, reutilizable entre sesiones:

- Ejercicio: nombre, descripción, objetivo o categoría (calentamiento, técnica, táctica, físico, finalización, porteros, partido, vuelta a la calma), duración orientativa en minutos, número de jugadores, material necesario y etiquetas libres.
- **Medios adjuntos** a cada ejercicio, varios por ejercicio y ordenables:
  - Fotos (JPEG, PNG, WebP; se admiten las fotos del móvil, incluidas HEIC si es viable convertirlas). Se redimensionan y se genera miniatura.
  - Vídeos (MP4 y WebM; se admiten los grabados con el móvil, incluidos los `.mov`/HEVC del iPhone, que se recodifican a MP4 H.264 en segundo plano porque no se reproducen en Android ni en Chrome). Los MP4 H.264 y WebM se guardan tal cual. Tamaño máximo configurable; se genera miniatura y se reproducen en la app con avance y retroceso.
  - Enlaces a vídeos externos (por ejemplo, YouTube) como alternativa que no ocupa espacio en el servidor.
  - Cada medio puede llevar un pie o comentario.
- Búsqueda y filtro por categoría y etiquetas. Duplicar un ejercicio para crear variantes. Copiar ejercicios a otro equipo al que tenga acceso el entrenador.
- Archivar ejercicios en lugar de borrarlos si ya se han usado en alguna sesión.

**Sesiones planificadas**: cada entreno (la misma entidad en la que se pasa lista) puede tener un plan:

- Datos de la sesión: fecha, hora, duración prevista, objetivo principal y notas.
- Lista **ordenada** de ejercicios de la biblioteca, cada uno con duración, indicaciones específicas para esa sesión y organización de grupos si se quiere.
- Duración total calculada y comparada con la prevista.
- Duplicar una sesión en otra fecha y guardar sesiones como plantilla.
- Calendario o lista de próximas sesiones planificadas.
- **Modo campo**: ver la sesión ejercicio a ejercicio en el móvil durante el entreno, con sus fotos y vídeos, y acceso directo a pasar lista.

### 2.9 Roles en uso (ciclo posterior)

- El admin invita a una persona por email con un rol y, si es jugador, vinculada a su ficha de la plantilla.
- Enlace de invitación de un solo uso con caducidad.
- Delegado: mismas capacidades de gestión que el entrenador, salvo gestionar accesos, la configuración del equipo y la biblioteca de ejercicios y planificación (que solo puede consultar). Ver la tabla de la sección 3.
- Jugador: ve plantilla, convocatorias, partidos y catálogo de multas; ve **solo sus propias** asistencias, multas y estadísticas acumuladas. No modifica nada.
- El admin puede cambiar el rol o revocar el acceso de cualquier miembro.
- Un administrador del club puede invitar por email a otra persona como administrador del club.

---

## 3. Roles y permisos

Roles por equipo: **admin**, **entrenador**, **delegado** y **jugador**. Un mismo usuario puede tener roles distintos en equipos distintos.

Además, a nivel de club existe el **administrador del club**. Quien crea un club pasa a ser su administrador. Un administrador del club:

- Tiene rol **admin en todos los equipos del club**, aunque no tenga membresía en ellos. Su rol efectivo en un equipo es el mayor entre su membresía en ese equipo y admin.
- Crea, edita y borra los equipos (categorías) del club.
- Gestiona la identidad del club (nombre, escudo y colores).
- Nombra o retira a otros administradores del club. Un club nunca puede quedarse sin administradores.

| Acción | Admin | Entrenador | Delegado | Jugador |
|---|---|---|---|---|
| Ver plantilla, partidos, convocatorias, catálogo de multas | Sí | Sí | Sí | Sí |
| Gestionar plantilla, entrenos, partidos y convocatorias | Sí | Sí | Sí | No |
| Ver asistencias, multas y estadísticas | Todas | Todas | Todas | Solo las suyas |
| Registrar y cobrar multas, editar catálogo | Sí | Sí | Sí | No |
| Registrar estadísticas de partido | Sí | Sí | Sí | No |
| Ver ejercicios y sesiones planificadas | Sí | Sí | Sí | Sí |
| Gestionar biblioteca de ejercicios, medios y planificación | Sí | Sí | No | No |
| Editar datos del equipo (nombre, categoría, temporada) | Sí | Sí | No | No |
| Invitar, cambiar roles y revocar accesos | Sí | No | No | No |
| Crear y borrar equipos del club; identidad del club (escudo, colores); administradores del club | Solo administrador del club | No | No | No |

Los permisos se aplican **siempre en el backend**. El frontend solo oculta lo que el usuario no puede hacer, por comodidad.

**Visibilidad para el rol jugador**

- **Plantilla:** ve nombre, dorsal y posición de todos, pero el porcentaje de asistencia y la deuda de multas solo los suyos. El backend no envía esos campos de otros jugadores.
- **Entrenos:** ve fechas y recuentos agregados de cada entreno (no identifican a nadie), pero el detalle por jugador solo en su fila.
- **Partidos:** el resultado y los eventos de cada partido (goles, tarjetas, cambios) son información pública del partido, igual que el acta, y los ve todo miembro. Las estadísticas **acumuladas** de temporada solo las suyas.
- **Multas:** solo las suyas; ni el resumen de caja ni las deudas de otros.

---

## 4. Arquitectura

Un único repositorio con **tres proyectos independientes**, sin workspaces ni herramientas de monorepo. Cada proyecto tiene sus propias dependencias, lockfile, scripts, Dockerfile y README, se desarrolla, prueba y construye por separado, y ninguno importa código de otro. Solo se comunican por interfaces bien definidas: HTTP con contrato OpenAPI y SQL.

| Proyecto | Carpeta | Contenido |
|---|---|---|
| Frontend | `frontend/` | PWA en React + Vite. Solo produce estáticos. |
| Backend | `backend/` | API en Node + Hono, **incluida la base de datos**: esquema, migraciones y seed. |
| Proxy | `proxy/` | nginx: sirve los estáticos del frontend, redirige `/api` al backend, HTTPS, cabeceras de seguridad y límites. |

En la raíz quedan solo lo que une a los tres proyectos: los ficheros de Docker Compose, `.env.example`, `scripts/` y `docs/`.

```
Móvil / PC (Tailscale)
        │ HTTPS
        ▼
┌──────────────────────────────── Docker Compose ─────────────────────────────────┐
│  proxy (nginx)  ──/api──▶  backend (Node)  ──SQL──▶  db (PostgreSQL)              │
│  estáticos de la PWA       API REST JSON            volumen de datos              │
└───────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Base de datos

- **PostgreSQL** (versión estable actual), imagen oficial de Docker.
- Forma parte del proyecto `backend/`: el esquema, las migraciones y el seed viven en él.
- Datos en un volumen de Docker. Sin puertos publicados fuera de la red interna.
- Esquema gestionado exclusivamente mediante **migraciones versionadas** en el repositorio.

### 4.2 Backend

- **Node.js LTS** con **TypeScript**.
- **Hono** como framework HTTP.
- **Drizzle ORM** para el esquema y las consultas tipadas; **drizzle-kit** para las migraciones.
- **Zod** para validar toda entrada. El contrato de la API se publica como **OpenAPI**, generado a partir de las validaciones y exportado a `backend/openapi.json`, de donde lo toma el frontend.
- **Better Auth** para autenticación: email y contraseña, sesiones por cookie segura (`HttpOnly`, `Secure`, `SameSite=Lax`). Configurado para generar identificadores UUID (por defecto genera texto no UUID), de modo que todas las claves `→ user` del modelo sean `uuid`.
- Zona horaria de la aplicación `Europe/Madrid` (variable `TZ`): "hoy" y todas las fechas `date` se calculan en esa zona, no en UTC.
- Subidas de archivos procesadas en streaming (por ejemplo, con `busboy`), sin cargarlas enteras en memoria: el `parseBody()` de Hono las carga completas.
- Permisos en un middleware que resuelve el rol efectivo del usuario en el equipo de la ruta y comprueba el rol requerido. El rol efectivo es el de su membresía en el equipo, o admin si es administrador del club del equipo. Las rutas `/clubes/:cid/...` comprueban que es administrador del club. Para el rol jugador, la capa de servicio filtra por su ficha.
- Al arrancar aplica las migraciones pendientes.
- Tests con **Vitest** contra una base PostgreSQL real en contenedor.

### 4.3 Frontend

- **React** con **TypeScript** y **Vite**.
- **PWA** mediante `vite-plugin-pwa`: manifest, iconos, service worker. Instalable en móvil desde el navegador.
- **TanStack Query** para las llamadas a la API y la caché de datos; **React Router** para la navegación.
- Cliente de la API **generado desde el contrato OpenAPI** (`backend/openapi.json`). El frontend no importa código del backend ni conoce la base de datos.
- Estilos con **variables CSS** para todos los colores y tokens de diseño desde el primer día, para permitir la personalización por club.
- Navegación inferior por pestañas, pensada para una mano.
- En producción se compila a estáticos que sirve el proxy. En desarrollo, el servidor de Vite redirige `/api` al backend. En ambos casos la app y la API comparten origen, sin CORS.

### 4.4 Proxy

- **nginx** en su imagen sin privilegios (`nginx-unprivileged`, escucha en un puerto alto sin root).
- Su imagen se construye con los estáticos compilados del frontend.
- Sirve la PWA con redirección de rutas a `index.html`, compresión y caché: larga para los recursos con hash, sin caché para `index.html` y el service worker.
- Redirige `/api` al backend, conservando las cabeceras `Range` para los vídeos y la IP real del cliente (`X-Forwarded-For`, `X-Forwarded-Proto`).
- `client_max_body_size` acorde al límite de subida de vídeo (por defecto nginx admite solo 1 MB).
- HTTPS con los certificados montados como volumen: de Tailscale en la fase inicial y de Let's Encrypt (certbot) en el ciclo 10.
- Cabeceras de seguridad y limitación de peticiones (`limit_req`) para el login y las invitaciones.
- Configuración parametrizada por variables de entorno mediante las plantillas de la imagen oficial (`/etc/nginx/templates`).

---

## 5. Infraestructura

### 5.1 Contenedores

| Servicio | Imagen | Puertos publicados | Persistencia |
|---|---|---|---|
| `db` | postgres | Ninguno | Volumen `db-data` |
| `backend` | Node (build propio, multi-stage, con ffmpeg para miniaturas y recodificación de vídeo) | Ninguno | Volumen `uploads` (escudos, fotos y vídeos) |
| `proxy` | nginx (build propio con los estáticos del frontend) | Solo este, hacia el host | Certificados montados en solo lectura |

- `docker-compose.dev.yml` (local): PostgreSQL en contenedor; backend y frontend con recarga en caliente (Vite dev server con proxy a `/api`). Sin nginx.
- `docker-compose.yml` (servidor): `db`, `backend` y `proxy` compilados, con `restart: unless-stopped` y healthchecks. El frontend no es un servicio en ejecución: su compilación va dentro de la imagen del proxy.
- nginx y backend configurados con un tamaño máximo de subida acorde al límite de vídeo; los vídeos se sirven con soporte de peticiones parciales (`Range`) para poder avanzar en la reproducción.
- Vigilar el espacio en disco del volumen `uploads`: los vídeos son lo que más crece. Aviso automático si el espacio libre baja de un umbral (ciclo 8).
- Rotación de logs de los contenedores desde el primer día (`logging.options`: `max-size` y `max-file`), porque el driver `json-file` de Docker no rota por defecto.
- Configuración mediante `.env` por entorno, con un `.env.example` documentado. Ningún secreto en el repositorio.

### 5.2 Entornos

Un servidor en casa ("el micro") aloja dos pilas independientes:

| Entorno | Código | Ruta en el servidor | Datos |
|---|---|---|---|
| Pruebas | Último `develop` | `/opt/vestuario/pruebas` | Datos de ejemplo, desechables |
| Producción | Un tag de `main` | `/opt/vestuario/pro` | Datos reales |

Cada entorno es un clon del repositorio con su `.env`, su nombre de proyecto de Compose (`vestuario-pruebas`, `vestuario-pro`), su base de datos y su puerto.

### 5.3 Acceso

- **Fase inicial:** Tailscale instalado en el servidor (fuera de Docker) y en los dispositivos del entrenador. Acceso solo desde la red privada, con HTTPS mediante certificado de Tailscale (necesario para instalar la PWA). El certificado se genera en el servidor con `tailscale cert`, se monta en el contenedor de nginx y un cron lo renueva y recarga nginx, porque caduca a los 90 días.
- Si en el servidor ya hay otro nginx ocupando los puertos 80/443, el proxy de cada entorno escucha en su propio puerto (p. ej. 8443 pruebas y 9443 producción).
- **Fase final (ciclo 10):** servidor separado y bastionado, red aislada, cortafuegos, dominio (DuckDNS), apertura de puertos 80/443 en el router hacia nginx y certificados de Let's Encrypt obtenidos y renovados con certbot.

### 5.4 Despliegue y copias de seguridad

- `scripts/deploy.sh pruebas` actualiza a lo último de `develop` y reconstruye.
- `scripts/deploy.sh pro vX.Y.Z` despliega ese tag, **haciendo antes copia de seguridad** (`pg_dump` comprimido).
- Registro de cada despliegue en `/opt/vestuario/deploys.log`.
- Desde el ciclo 1 (primer despliegue con datos reales): `pg_dump` diario de producción con rotación simple (últimos 14 días).
- Ciclo 8: copias diarias automáticas de base de datos y medios (fotos y vídeos) con rotación y copia fuera del servidor, y procedimiento de restauración probado.

---

## 6. Modelo de datos

Tablas de autenticación gestionadas por Better Auth (`user`, `session`, `account`, `verification`), configurado para que `user.id` sea `uuid`. El resto referencia `user.id`.

### clubes
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| nombre | text | obligatorio |
| escudo | text | ruta del archivo, nullable |
| color_principal | text | hex, por defecto `#14553d` |
| color_secundario | text | hex, por defecto `#f2c230` |
| creado_por | uuid → user | |
| created_at | timestamptz | |

### admins_club
| Campo | Tipo | Notas |
|---|---|---|
| club_id | uuid → clubes | PK compuesta, cascade |
| usuario_id | uuid → user | PK compuesta, cascade |
| created_at | timestamptz | |

### equipos
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| club_id | uuid → clubes | cascade |
| nombre | text | obligatorio, ej. `Infantil A`. Único por club y temporada |
| categoria | text | obligatorio; valor de la lista sugerida o texto libre |
| temporada | text | ej. `2026-27` |
| creado_por | uuid → user | |
| created_at | timestamptz | |

### membresias
| Campo | Tipo | Notas |
|---|---|---|
| equipo_id | uuid → equipos | PK compuesta, cascade |
| usuario_id | uuid → user | PK compuesta, cascade |
| rol | enum `admin, entrenador, delegado, jugador` | |
| created_at | timestamptz | |

### jugadores
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| equipo_id | uuid → equipos | cascade |
| usuario_id | uuid → user | nullable; se vincula al aceptar invitación. Único por equipo |
| nombre | text | obligatorio |
| dorsal | smallint | 0–99, nullable. Único por equipo entre activos (índice parcial) |
| posicion | enum `portero, defensa, centrocampista, delantero` | nullable |
| activo | boolean | por defecto true (baja lógica) |
| created_at | timestamptz | |

### entrenos
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| equipo_id | uuid → equipos | cascade |
| fecha | date | nullable solo si `es_plantilla`. Única por equipo entre los que no son plantilla (índice único parcial `WHERE NOT es_plantilla`) |
| hora | time | opcional (ciclo 7) |
| duracion_prevista | smallint | minutos, opcional (ciclo 7) |
| objetivo | text | opcional (ciclo 7) |
| es_plantilla | boolean | por defecto false. Sesión guardada como plantilla, sin fecha (ciclo 7). Las plantillas no cuentan en el historial ni en el porcentaje de asistencia |
| nombre_plantilla | text | obligatorio si `es_plantilla` (ciclo 7) |
| notas | text | opcional |

### asistencias
| Campo | Tipo | Notas |
|---|---|---|
| entreno_id | uuid → entrenos | PK compuesta, cascade |
| jugador_id | uuid → jugadores | PK compuesta, cascade |
| estado | enum `asiste, justificada, falta` | |
| motivo | text | opcional, para justificadas |

### partidos
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| equipo_id | uuid → equipos | cascade |
| rival | text | obligatorio |
| temporada | text | ej. `2026-27`; por defecto, la temporada del equipo al crear el partido |
| competicion | text | opcional |
| fecha | date | |
| hora | time | opcional |
| hora_citacion | time | opcional |
| lugar | text | opcional |
| local | boolean | opcional |
| estado | enum `programado, jugado, aplazado` | por defecto programado (ciclo 6) |
| goles_favor | smallint | nullable (ciclo 6) |
| goles_contra | smallint | nullable (ciclo 6) |
| created_at | timestamptz | |

### convocados
| Campo | Tipo | Notas |
|---|---|---|
| partido_id | uuid → partidos | PK compuesta, cascade |
| jugador_id | uuid → jugadores | PK compuesta, cascade |

### participaciones (ciclo 6)
| Campo | Tipo | Notas |
|---|---|---|
| partido_id | uuid → partidos | PK compuesta, cascade |
| jugador_id | uuid → jugadores | PK compuesta, cascade. FK compuesta `(partido_id, jugador_id) → convocados` para garantizar que está convocado |
| titular | boolean | |
| minutos | smallint | calculable a partir de eventos |

### eventos_partido (ciclo 6)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| partido_id | uuid → partidos | cascade |
| jugador_id | uuid → jugadores | nullable (p. ej. gol en propia puerta del rival a nuestro favor), cascade |
| tipo | enum `gol, asistencia, amarilla, roja, entra, sale, gol_propia` | `gol_propia` con jugador = gol en propia de uno de los nuestros; sin jugador = gol en propia del rival |
| minuto | smallint | opcional |
| origen | enum `manual, acta, federacion` | fuente del dato |

### motivos_multa
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| equipo_id | uuid → equipos | cascade |
| descripcion | text | |
| importe | numeric(8,2) | ≥ 0 |
| tipo_evento | enum `amarilla, roja` | nullable; tarjeta que propone este motivo (ciclo 6) |
| activo | boolean | por defecto true |

### multas
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| jugador_id | uuid → jugadores | cascade |
| motivo_id | uuid → motivos_multa | nullable, set null |
| motivo | text | copia del texto |
| importe | numeric(8,2) | > 0, copia del importe |
| fecha | date | |
| fecha_pago | date | nullable; la multa está cobrada si y solo si tiene fecha de pago |
| evento_id | uuid → eventos_partido | nullable (multa originada por tarjeta, ciclo 6) |
| creada_por | uuid → user | |
| created_at | timestamptz | |

### ejercicios (ciclo 7)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| equipo_id | uuid → equipos | cascade |
| nombre | text | obligatorio |
| descripcion | text | desarrollo del ejercicio |
| categoria | enum `calentamiento, tecnica, tactica, fisico, finalizacion, porteros, partido, vuelta_calma` | |
| duracion_min | smallint | orientativa |
| jugadores | text | ej. `8-12`, opcional |
| material | text | opcional |
| etiquetas | text[] | libres |
| archivado | boolean | por defecto false |
| creado_por | uuid → user | |
| created_at / updated_at | timestamptz | |

### ejercicio_medios (ciclo 7)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| ejercicio_id | uuid → ejercicios | cascade (borra también los archivos) |
| tipo | enum `foto, video, enlace` | |
| archivo | text | ruta en `uploads`, nullable si es enlace |
| miniatura | text | ruta de la miniatura |
| url | text | solo para `enlace` |
| mime | text | tipo real comprobado |
| tamano_bytes | bigint | |
| duracion_seg | integer | solo vídeo |
| pie | text | comentario opcional |
| orden | smallint | |
| created_at | timestamptz | |

### entreno_ejercicios (ciclo 7)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| entreno_id | uuid → entrenos | cascade |
| ejercicio_id | uuid → ejercicios | restrict (por eso se archivan en lugar de borrar) |
| orden | smallint | |
| duracion_min | smallint | puede diferir de la orientativa |
| indicaciones | text | específicas para esta sesión |

### invitaciones (ciclo 9)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid | PK |
| club_id | uuid → clubes | cascade |
| equipo_id | uuid → equipos | nullable, cascade. Nulo = invitación como administrador del club |
| email | text | |
| rol | enum rol | nullable; obligatorio si hay `equipo_id` |
| jugador_id | uuid → jugadores | nullable, ficha a vincular |
| token_hash | text | nunca se guarda el token en claro |
| expira | timestamptz | |
| usada_en | timestamptz | nullable |
| revocada_en | timestamptz | nullable |
| creada_por | uuid → user | |

**Reglas generales:** al crear un club, su creador pasa a ser administrador del club (`admins_club`) en la misma transacción. Al crear un equipo se crea su catálogo de multas por defecto en la misma transacción. No hace falta crear membresía para el creador, porque como administrador del club ya es admin del equipo. Nunca se edita una migración ya desplegada.

---

## 7. API

Prefijo `/api`. JSON. Todas las rutas de datos cuelgan del equipo (o del club, las de identidad y gestión del club) para facilitar la comprobación de permisos. Errores con formato común `{ error: { codigo, mensaje, detalles? } }`.

| Módulo | Método y ruta | Rol mínimo |
|---|---|---|
| Salud | `GET /health` | Público |
| Auth | `/auth/*` (login, logout, sesión) — Better Auth | Público |
| Clubes | `POST /clubes` (el creador pasa a ser administrador) | Autenticado |
| | `GET /clubes/:cid` (datos e identidad visual) | Miembro de algún equipo del club |
| | `PATCH /clubes/:cid` (nombre, colores) · `PUT /clubes/:cid/escudo` (multipart) | Administrador del club |
| | `POST /clubes/:cid/equipos` | Administrador del club |
| | `GET/POST/DELETE /clubes/:cid/admins` | Administrador del club |
| Equipos | `GET /equipos` (los míos, con su club y mi rol efectivo) | Autenticado |
| | `GET /equipos/:id` · `PATCH /equipos/:id` (nombre, categoría, temporada) | Miembro · Entrenador |
| | `DELETE /equipos/:id` (con confirmación del nombre; borra también sus archivos) | Administrador del club |
| Jugadores | `GET /equipos/:id/jugadores?activos=` | Miembro (jugador: asistencia y deuda solo suyas) |
| | `POST /equipos/:id/jugadores` · `PATCH /equipos/:id/jugadores/:jid` | Delegado |
| Entrenos | `GET /equipos/:id/entrenos` | Miembro |
| | `GET /equipos/:id/entrenos/:fecha` | Miembro (jugador: solo su fila) |
| | `PUT /equipos/:id/entrenos/:fecha/asistencias` (lista completa) | Delegado |
| | `GET /equipos/:id/asistencia/resumen` | Miembro (jugador: solo suyo) |
| Ejercicios | `GET /equipos/:id/ejercicios?categoria=&etiqueta=&q=&archivados=` · `GET /equipos/:id/ejercicios/:eid` | Miembro |
| | `POST/PATCH/DELETE /equipos/:id/ejercicios/:eid` · `POST .../:eid/duplicar` · `POST .../:eid/copiar` (a otro equipo) | Entrenador |
| | `POST /equipos/:id/ejercicios/:eid/medios` (multipart o enlace) · `PATCH/DELETE .../medios/:mid` · `PUT .../medios/orden` | Entrenador |
| | `GET /medios/:mid` y `GET /medios/:mid/miniatura` (con `Range` para vídeo) | Miembro del equipo del medio |
| Planificación | `GET /equipos/:id/sesiones?desde=&hasta=` · `GET /equipos/:id/sesiones/plantillas` | Miembro |
| | `PUT /equipos/:id/entrenos/:fecha/plan` (datos de sesión y lista ordenada de ejercicios) | Entrenador |
| | `POST /equipos/:id/entrenos/:fecha/duplicar` · `POST .../guardar-plantilla` · `POST /equipos/:id/sesiones/plantillas/:tid/aplicar` | Entrenador |
| Partidos | `GET/POST /equipos/:id/partidos` · `GET/PATCH/DELETE /equipos/:id/partidos/:pid` | Miembro / Delegado |
| | `PUT /equipos/:id/partidos/:pid/convocados` (lista completa) | Delegado |
| | `GET /equipos/:id/partidos/:pid/mensaje` | Miembro |
| Estadísticas | `PUT /equipos/:id/partidos/:pid/resultado` | Delegado |
| | `PUT /equipos/:id/partidos/:pid/participaciones` | Delegado |
| | `GET/POST/DELETE /equipos/:id/partidos/:pid/eventos` | Miembro (eventos públicos del partido) / Delegado |
| | `GET /equipos/:id/estadisticas?temporada=` | Miembro (jugador: solo suyas) |
| Multas | `GET/POST/PATCH /equipos/:id/motivos-multa` | Miembro / Delegado |
| | `GET/POST /equipos/:id/multas` · `PATCH/DELETE /equipos/:id/multas/:mid` | Miembro (jugador: suyas) / Delegado |
| | `POST /equipos/:id/jugadores/:jid/saldar` | Delegado |
| | `GET /equipos/:id/multas/resumen` | Delegado |
| Miembros | `GET /equipos/:id/miembros` · `PATCH/DELETE /equipos/:id/miembros/:uid` | Miembro / Admin |
| Invitaciones | `GET/POST /equipos/:id/invitaciones` · `DELETE /equipos/:id/invitaciones/:iid` (revocar) | Admin |
| | `POST /clubes/:cid/invitaciones` (como administrador del club) | Administrador del club |
| | `POST /invitaciones/aceptar` | Público con token |

Pasar lista y convocar se guardan como lista completa en una sola petición.

---

## 8. Frontend

**Navegación inferior:** Plantilla · Entrenos · Partidos · Multas · Más (configuración, estadísticas, cambio de equipo, cerrar sesión).

**Pantallas**

- Login.
- Selector de equipo (si hay más de uno), agrupado por club con el escudo de cada club. Los administradores del club pueden crear un equipo nuevo desde aquí.
- Plantilla: lista, alta/edición en hoja inferior, baja con confirmación, ver bajas y reactivar.
- Entrenos: selector de fecha, lista con control de tres estados por jugador, historial.
- Planificación (ciclo 7): biblioteca de ejercicios con galería de fotos y vídeos, editor de sesión con ejercicios ordenables, plantillas y modo campo. Accesible desde la pestaña Entrenos.
- Partidos: lista próximos/pasados, formulario de partido, selección de convocados, mensaje para copiar/compartir.
- Multas: totales, formulario rápido, deuda por jugador, listado, catálogo editable.
- Configuración (ciclo 5): datos del equipo; identidad del club (escudo y colores con vista previa); equipos y administradores del club.
- Partido jugado (ciclo 6): resultado, titulares, registro de eventos por minuto.
- Estadísticas (ciclo 6): tablas de temporada.
- Miembros e invitaciones (ciclo 9).

**Criterios transversales:** diseño adaptable (móvil primero), foco visible y navegación por teclado, respeto a `prefers-reduced-motion`, modo claro/oscuro, estados vacíos que invitan a actuar, mensajes de error que indican qué pasó y cómo resolverlo.

---

## 9. Flujo de trabajo

### 9.1 Ramas

| Tipo | Rama | Sale de | Se mergea a |
|---|---|---|---|
| Funcionalidad | `feature/GH-<n>[-descripcion]` | `develop` | `develop` |
| Fallo detectado en pruebas | `fix/GH-<n>[-descripcion]` | `develop` | `develop` |
| Fallo en producción | `hotfix/GH-<n>[-descripcion]` | `main` | `main` (nuevo tag) y `develop` |

- `main`: solo versiones publicadas; cada merge lleva tag y va a producción.
- `develop`: integración; es lo que corre en el entorno de pruebas. Rama por defecto del repositorio.
- Todo cambio entra mediante **pull request** con `Closes #<n>` en la descripción.

### 9.2 Commits

**Conventional Commits** con referencia a la issue: `feat(jugadores): alta de jugadores GH-8`, `fix(multas): redondeo de importes GH-24`. Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`.

### 9.3 Versiones

Versionado semántico con tags `vMAYOR.MENOR.PARCHE` y release en GitHub con notas generadas.

- `0.x` durante el MVP; **`v1.0.0` al cerrar el ciclo 4** (multas).
- MENOR: cierre de ciclo o conjunto de funcionalidades.
- PARCHE: hotfixes.

### 9.4 Migraciones

Cada cambio de esquema es una migración dentro de la issue que lo necesita, se prueba primero en pruebas, nunca se edita una ya desplegada, y el despliegue a producción hace copia de seguridad antes de migrar.

### 9.5 Definición de terminado

Una issue está terminada cuando: cumple sus criterios de aceptación en el entorno de pruebas, pasa la CI (lint, tipos, tests), incluye migraciones si cambia el esquema, y está mergeada en `develop` mediante pull request.

---

## 10. Plan de ciclos

| Ciclo | Objetivo | Versión |
|---|---|---|
| 1 · Base y plantilla | Tres proyectos funcionando, login, clubes y equipos por categoría, selector de equipo, plantilla, despliegue y CI | v0.1.0 |
| 2 · Entrenos | Pasar lista, historial y porcentaje de asistencia | v0.2.0 |
| 3 · Convocatorias | Partidos, convocados y mensaje de WhatsApp | v0.3.0 |
| 4 · Multas | Catálogo, registro, cobro, deudas y caja. Paridad con el MVP | v1.0.0 |
| 5 · Personalización | Escudo y colores por club | v1.1.0 |
| 6 · Estadísticas | Resultado, participaciones, eventos, estadísticas de temporada | v1.2.0 |
| 7 · Planificación de entrenos | Biblioteca de ejercicios con fotos y vídeos, y sesiones planificadas | v1.3.0 |
| 8 · Operación | Backups automáticos, restauración, logs, actualizaciones | v1.4.0 |
| 9 · Roles en uso | Invitaciones, delegados y jugadores | v1.5.0 |
| 10 · Exposición pública | Servidor aislado, red, cortafuegos, dominio y HTTPS público | v2.0.0 |

---

## 11. Backlog

### 11.1 Etiquetas

| Nombre | Color | Descripción |
|---|---|---|
| feature | `1f8a5b` | Nueva funcionalidad |
| bug | `c93b3b` | Algo no funciona |
| hotfix | `b60205` | Fallo en producción |
| db | `5319e7` | Requiere migración de base de datos |
| backend | `0e8a16` | API Node |
| frontend | `1d76db` | React / PWA |
| infra | `fbca04` | Docker, despliegue, CI |
| seguridad | `d93f0b` | Seguridad y bastionado |
| investigacion | `c5def5` | Prueba de concepto o investigación previa |

### 11.2 Milestones

| Título | Descripción |
|---|---|
| Ciclo 1 · Base y plantilla | Tres proyectos funcionando, login, clubes y equipos por categoría, selector de equipo, plantilla, despliegue y CI (v0.1.0) |
| Ciclo 2 · Entrenos | Pasar lista, historial y porcentaje de asistencia (v0.2.0) |
| Ciclo 3 · Convocatorias | Partidos, convocados y mensaje de WhatsApp (v0.3.0) |
| Ciclo 4 · Multas | Catálogo, registro, cobro, deudas y caja. Paridad con el MVP (v1.0.0) |
| Ciclo 5 · Personalización | Escudo y colores por club (v1.1.0) |
| Ciclo 6 · Estadísticas | Resultado, participaciones, eventos y estadísticas de temporada (v1.2.0) |
| Ciclo 7 · Planificación de entrenos | Biblioteca de ejercicios con fotos y vídeos, y sesiones planificadas (v1.3.0) |
| Ciclo 8 · Operación | Backups automáticos, restauración, logs y actualizaciones (v1.4.0) |
| Ciclo 9 · Roles en uso | Invitaciones, delegados y jugadores (v1.5.0) |
| Ciclo 10 · Exposición pública | Servidor aislado, red, cortafuegos, dominio y HTTPS público (v2.0.0) |

### 11.3 Issues

Formato de cada issue: encabezado con el número previsto, línea **Título**, línea **Etiquetas** y, a continuación, el cuerpo.

---

### Milestone: Ciclo 1 · Base y plantilla

#### GH-1
**Título:** Configuración del repositorio
**Etiquetas:** feature, infra

Dejar el repositorio preparado para el flujo de trabajo definido en la sección 9 del documento de proyecto.

**Criterios de aceptación**
- [ ] Plantillas de issue en `.github/ISSUE_TEMPLATE/`: funcionalidad (descripción, criterios de aceptación, capas afectadas) y fallo (entorno pruebas/producción que determina `fix/` o `hotfix/`, pasos, esperado/obtenido). Issues en blanco desactivadas
- [ ] Plantilla de pull request con `Closes #`, tipo de rama y comprobaciones
- [ ] `CONTRIBUTING.md` con ramas, commits, versiones, hotfix, migraciones y definición de terminado
- [ ] `.gitignore`, `.editorconfig` y `README.md` inicial
- [ ] Documento de proyecto guardado en `docs/`

#### GH-2
**Título:** Estructura del repositorio y Docker Compose
**Etiquetas:** feature, infra

Tres proyectos independientes en el mismo repositorio, sin workspaces ni herramientas de monorepo (sección 4). Cada uno tiene sus dependencias, lockfile, scripts, Dockerfile y README, y se puede desarrollar y construir por separado. Todo con software libre y gratuito.

**Criterios de aceptación**
- [ ] Proyectos `frontend/` (React + Vite), `backend/` (Node + Hono, con la base de datos) y `proxy/` (nginx), cada uno con su Dockerfile, `.dockerignore` y README; ninguno importa código de otro
- [ ] Esqueleto mínimo para que la cadena funcione de extremo a extremo: el backend responde `GET /api/health` y el frontend muestra una página que lo consulta (el desarrollo real queda para GH-4 y GH-9)
- [ ] `docker-compose.dev.yml`: PostgreSQL, y backend y frontend con recarga en caliente (código montado); el servidor de Vite redirige `/api` al backend
- [ ] `docker-compose.yml`: `db` (PostgreSQL), `backend` y `proxy` (nginx con los estáticos del frontend compilados dentro de su imagen), con `restart: unless-stopped` y healthchecks
- [ ] nginx: redirección de rutas de la PWA a `index.html`, `/api` hacia el backend, compresión, caché de estáticos y `client_max_body_size` configurable
- [ ] En `docker-compose.yml` solo `proxy` publica puerto; `db` y `backend` solo en la red interna
- [ ] Volúmenes `db-data` y `uploads`
- [ ] Rotación de logs en todos los servicios (`max-size`, `max-file`)
- [ ] `.env.example` documentado; ningún secreto en el repositorio
- [ ] Dockerfiles multi-stage con imágenes finales ligeras y usuario no root
- [ ] README: cómo arrancar en local con un solo comando

#### GH-3
**Título:** Esquema inicial de base de datos y migraciones
**Etiquetas:** feature, db, backend

Primeras tablas con Drizzle y sistema de migraciones. Depende de GH-2.

**Criterios de aceptación**
- [ ] Tablas de Better Auth, configurado para generar `user.id` como UUID
- [ ] Tablas `clubes` (incluidos `escudo`, `color_principal` y `color_secundario` con valores por defecto, para el ciclo 5), `admins_club`, `equipos` (con `club_id` y `categoria`), `membresias` con enum de rol y `jugadores` según la sección 6
- [ ] Índice único parcial de dorsal por equipo entre jugadores activos
- [ ] Nombre de equipo único por club y temporada
- [ ] Migraciones versionadas generadas con drizzle-kit y aplicadas automáticamente al arrancar el backend
- [ ] Seed de datos de ejemplo para desarrollo y pruebas: un club con dos equipos de categorías distintas, un segundo club con un equipo, un usuario administrador del primer club, un entrenador con membresía en un solo equipo y jugadores

#### GH-4
**Título:** API base con Hono
**Etiquetas:** feature, backend

Esqueleto del backend. Depende de GH-2.

**Criterios de aceptación**
- [ ] Configuración por variables de entorno validadas al arrancar, incluida la zona horaria (`TZ=Europe/Madrid`)
- [ ] Conexión a PostgreSQL con pool
- [ ] `GET /api/health` devuelve el estado de la API y de la base de datos
- [ ] Validación con Zod y formato de error común `{ error: { codigo, mensaje, detalles? } }`
- [ ] Contrato OpenAPI generado y visible en desarrollo, y exportado a `backend/openapi.json` con un script
- [ ] Sustituye el esqueleto de `GET /api/health` de GH-2 por la versión con comprobación de la base de datos
- [ ] Logs de peticiones
- [ ] Vitest configurado con base de datos de test en contenedor

#### GH-5
**Título:** Autenticación del entrenador
**Etiquetas:** feature, backend, seguridad

Inicio de sesión con email y contraseña mediante Better Auth. Depende de GH-3 y GH-4.

**Criterios de aceptación**
- [ ] Login, logout y consulta de la sesión actual bajo `/api/auth`
- [ ] Sesión en cookie `HttpOnly`, `Secure`, `SameSite=Lax`
- [ ] Registro público desactivado
- [ ] Comando CLI en el backend para crear desde el servidor el primer usuario y su club, del que queda como administrador
- [ ] Límite de intentos fallidos de login
- [ ] Tests de login correcto, incorrecto y sesión caducada

#### GH-6
**Título:** Permisos por club, equipo y rol
**Etiquetas:** feature, backend, seguridad

Middleware de autorización para todas las rutas `/api/equipos/:id/...` y `/api/clubes/:cid/...`. Depende de GH-5.

**Criterios de aceptación**
- [ ] Resuelve el rol efectivo del usuario en el equipo y lo deja en el contexto de la petición: su membresía en el equipo, o admin si es administrador del club del equipo (se toma el mayor)
- [ ] 401 sin sesión; 403 si no es miembro ni administrador del club, o si su rol no alcanza el mínimo
- [ ] Helper declarativo por ruta, p. ej. `requireRol('delegado')`, con jerarquía admin > entrenador > delegado > jugador
- [ ] Helper `requireAdminClub()` para las rutas de club
- [ ] Tests de cada caso

#### GH-7
**Título:** API de clubes y equipos
**Etiquetas:** feature, backend

Depende de GH-6.

**Criterios de aceptación**
- [ ] `POST /api/clubes` crea el club y, en la misma transacción, hace a su creador administrador del club
- [ ] `GET /api/clubes/:cid` para cualquier miembro de un equipo del club
- [ ] `POST /api/clubes/:cid/equipos` (administrador del club) crea un equipo con nombre, categoría y temporada
- [ ] `GET/POST/DELETE /api/clubes/:cid/admins`: añadir un usuario existente como administrador del club y retirarlo; un club nunca queda sin administradores
- [ ] `GET /api/equipos` devuelve los equipos del usuario agrupables por club, con los datos del club y su rol efectivo en cada uno
- [ ] `GET /api/equipos/:id` y `PATCH /api/equipos/:id` (nombre, categoría, temporada)
- [ ] `DELETE /api/equipos/:id` solo para administradores del club, exigiendo el nombre del equipo como confirmación; borra en cascada sus datos y sus archivos en `uploads`
- [ ] Tests

#### GH-8
**Título:** API de jugadores
**Etiquetas:** feature, backend

CRUD de la plantilla. Depende de GH-6.

**Criterios de aceptación**
- [ ] `GET /api/equipos/:id/jugadores` con filtro de activos/bajas, ordenado por dorsal y nombre
- [ ] `POST` y `PATCH` (incluida baja y reactivación mediante `activo`)
- [ ] Error claro si el dorsal ya está en uso por un jugador activo
- [ ] Modificar requiere rol delegado o superior
- [ ] Tests

#### GH-9
**Título:** Frontend base: React + Vite como PWA
**Etiquetas:** feature, frontend

Depende de GH-2 y GH-4.

**Criterios de aceptación**
- [ ] React + TypeScript + Vite, React Router y TanStack Query
- [ ] `vite-plugin-pwa`: manifest, iconos y service worker; instalable en Android e iOS
- [ ] Todos los colores y tokens como variables CSS (preparado para el ciclo 5); modo claro y oscuro
- [ ] Cliente de API generado desde `backend/openapi.json`, con script para regenerarlo (sin importar código del backend)
- [ ] Layout móvil con navegación inferior y área segura (`safe-area-inset`)
- [ ] Componentes base: botón, campo, hoja inferior, confirmación, aviso (toast), estado vacío

#### GH-10
**Título:** Login y selector de equipo
**Etiquetas:** feature, frontend

Depende de GH-5, GH-7 y GH-9.

**Criterios de aceptación**
- [ ] Pantalla de login con errores claros
- [ ] Rutas protegidas: sin sesión redirige al login
- [ ] Con un solo equipo entra directamente; con varios muestra el selector, agrupado por club y con la categoría de cada equipo
- [ ] Cambio de equipo desde cualquier pantalla; se recuerda el último equipo usado
- [ ] Los administradores del club pueden crear un equipo nuevo (nombre, categoría de la lista sugerida o libre, y temporada) desde el selector
- [ ] Cerrar sesión

#### GH-11
**Título:** Pantalla de plantilla
**Etiquetas:** feature, frontend

Depende de GH-8 y GH-10.

**Criterios de aceptación**
- [ ] Lista ordenada por dorsal con nombre y posición
- [ ] Alta y edición en hoja inferior (nombre, dorsal, posición)
- [ ] Baja con confirmación; vista de bajas con opción de reactivar
- [ ] Error de dorsal repetido mostrado en el campo
- [ ] Estado vacío que invita a añadir el primer jugador
- [ ] Controles de edición ocultos para roles sin permiso

#### GH-12
**Título:** CI en pull requests
**Etiquetas:** feature, infra

GitHub Actions para validar cada pull request a `develop` y `main`. Depende de GH-2.

**Criterios de aceptación**
- [ ] Un trabajo por proyecto (`frontend`, `backend`, `proxy`) que solo se ejecuta si cambian sus archivos (filtro por rutas)
- [ ] Lint y comprobación de tipos en frontend y backend
- [ ] Tests del backend contra PostgreSQL como servicio del workflow
- [ ] Comprobación de que no hay migraciones pendientes de generar y de que `backend/openapi.json` está actualizado
- [ ] Build de las imágenes Docker de `backend` y `proxy` (esta incluye la compilación del frontend) y validación de la configuración de nginx (`nginx -t`)
- [ ] Prueba de humo: `docker compose up` completo y `GET /api/health` a través del proxy
- [ ] Estado visible en el pull request

#### GH-13
**Título:** Despliegue en el servidor con Tailscale
**Etiquetas:** feature, infra

Entornos de pruebas y producción en el servidor. Depende de GH-1 y GH-2.

**Criterios de aceptación**
- [ ] Docker y Tailscale instalados en el servidor; documentado en `docs/servidor.md`
- [ ] Clones en `/opt/vestuario/pruebas` y `/opt/vestuario/pro`, cada uno con su `.env`, puerto y proyecto de Compose
- [ ] HTTPS con certificado de Tailscale; la PWA se instala desde el móvil. Certificado generado con `tailscale cert`, montado en solo lectura en el contenedor de nginx y renovado por un cron que recarga nginx (caduca a los 90 días)
- [ ] Puerto propio de cada entorno, compatible con otro nginx que ya ocupe 80/443 en el servidor
- [ ] `scripts/deploy.sh` para `pruebas` (último develop) y `pro <tag>` (con copia de seguridad previa y registro de despliegues), funcionando en el servidor
- [ ] Copia de seguridad antes de cada despliegue a producción verificada
- [ ] `pg_dump` diario de producción con rotación de 14 días (provisional hasta el ciclo 8)
- [ ] Primer despliegue de `v0.1.0` en producción

---

### Milestone: Ciclo 2 · Entrenos

#### GH-14
**Título:** Modelo de entrenos y asistencias
**Etiquetas:** feature, db, backend

Depende de GH-3.

**Criterios de aceptación**
- [ ] Tablas `entrenos` (fecha única por equipo) y `asistencias` con enum `asiste, justificada, falta` y motivo opcional
- [ ] Migración y actualización del seed con entrenos de ejemplo

#### GH-15
**Título:** API de entrenos y asistencia
**Etiquetas:** feature, backend

Depende de GH-14.

**Criterios de aceptación**
- [ ] `GET /api/equipos/:id/entrenos` con recuentos por estado
- [ ] `GET /api/equipos/:id/entrenos/:fecha` con la asistencia de cada jugador activo
- [ ] `PUT /api/equipos/:id/entrenos/:fecha/asistencias` guarda la lista completa en una transacción; crea el entreno si no existe y lo elimina si queda sin asistencias (en el ciclo 7 solo si además no tiene planificación)
- [ ] `GET /api/equipos/:id/asistencia/resumen`: asistencias, justificadas, faltas y porcentaje por jugador
- [ ] El rol jugador solo obtiene sus propios datos (en el listado, solo recuentos agregados)
- [ ] Tests

#### GH-16
**Título:** Pantalla de pasar lista
**Etiquetas:** feature, frontend

Depende de GH-15.

**Criterios de aceptación**
- [ ] Selector de fecha, hoy por defecto
- [ ] Control de tres estados por jugador; tocar el estado activo lo desmarca
- [ ] Campo de motivo opcional al marcar justificada
- [ ] Guardado automático con indicador de estado y reintento si falla
- [ ] Usable con una mano en el móvil

#### GH-17
**Título:** Historial de entrenos y asistencia en plantilla
**Etiquetas:** feature, frontend

Depende de GH-11 y GH-15.

**Criterios de aceptación**
- [ ] Historial ordenado por fecha con recuentos; abrir un entreno pasado para corregirlo
- [ ] Porcentaje de asistencia visible en cada jugador de la plantilla
- [ ] Estado vacío cuando no hay entrenos

---

### Milestone: Ciclo 3 · Convocatorias

#### GH-18
**Título:** Modelo de partidos y convocados
**Etiquetas:** feature, db, backend

Depende de GH-3.

**Criterios de aceptación**
- [ ] Tabla `partidos` según la sección 6, con `temporada` tomada por defecto del equipo (los campos de estado y resultado pueden añadirse ya, sin uso hasta el ciclo 6)
- [ ] Tabla `convocados`
- [ ] Migración y seed

#### GH-19
**Título:** API de partidos y convocatorias
**Etiquetas:** feature, backend

Depende de GH-18.

**Criterios de aceptación**
- [ ] CRUD de partidos con listado de próximos y pasados
- [ ] `PUT /api/equipos/:id/partidos/:pid/convocados` con la lista completa; solo jugadores activos del equipo
- [ ] `GET /api/equipos/:id/partidos/:pid/mensaje` devuelve el texto de convocatoria (equipo, rival, fecha, horas, lugar, convocados por dorsal)
- [ ] Tests

#### GH-20
**Título:** Pantalla de partidos
**Etiquetas:** feature, frontend

Depende de GH-19.

**Criterios de aceptación**
- [ ] Pestañas de próximos y pasados
- [ ] Formulario de partido: rival, competición, fecha, hora, citación, lugar, local/visitante
- [ ] Editar y borrar con confirmación

#### GH-21
**Título:** Convocatoria y mensaje para WhatsApp
**Etiquetas:** feature, frontend

Depende de GH-20.

**Criterios de aceptación**
- [ ] Selección de convocados con contador
- [ ] Vista previa del mensaje
- [ ] Botón de copiar al portapapeles y botón de compartir por WhatsApp (`wa.me`); usar la API de compartir del sistema si está disponible
- [ ] Marcar en la lista qué jugadores no han sido convocados

---

### Milestone: Ciclo 4 · Multas

#### GH-22
**Título:** Modelo de multas y catálogo
**Etiquetas:** feature, db, backend

Depende de GH-7.

**Criterios de aceptación**
- [ ] Tablas `motivos_multa` (con `tipo_evento` nullable) y `multas` (con `evento_id` nullable para el ciclo 6) según la sección 6
- [ ] Una multa está cobrada si y solo si tiene `fecha_pago`; sin campo `pagada` redundante
- [ ] Al crear un equipo se crea el catálogo por defecto en la misma transacción; migración de datos para los equipos existentes
- [ ] Seed con multas de ejemplo

#### GH-23
**Título:** API de catálogo de multas
**Etiquetas:** feature, backend

Depende de GH-22.

**Criterios de aceptación**
- [ ] Listar, crear, editar (incluido el tipo de tarjeta asociado) y desactivar motivos
- [ ] Desactivar no afecta a multas existentes
- [ ] Tests

#### GH-24
**Título:** API de multas
**Etiquetas:** feature, backend

Depende de GH-22.

**Criterios de aceptación**
- [ ] Registrar multa desde motivo del catálogo (copia texto e importe, importe editable) o con motivo libre
- [ ] Listar con filtros por jugador y estado
- [ ] Cobrar (fija `fecha_pago`) y deshacer cobro (la vacía); borrar
- [ ] `POST /api/equipos/:id/jugadores/:jid/saldar` marca como pagadas todas sus pendientes
- [ ] `GET /api/equipos/:id/multas/resumen`: total pendiente, total en caja y deuda por jugador
- [ ] El rol jugador solo ve sus multas
- [ ] Importes con precisión decimal, sin coma flotante
- [ ] Tests

#### GH-25
**Título:** Pantalla de multas
**Etiquetas:** feature, frontend

Depende de GH-11, GH-23 y GH-24.

**Criterios de aceptación**
- [ ] Totales de pendiente y caja arriba
- [ ] Formulario rápido: jugador, motivo (con "otro"), importe autocompletado, fecha
- [ ] Deuda por jugador con acción de saldar
- [ ] Listado de multas con cobrar/deshacer y borrar
- [ ] Catálogo editable
- [ ] Deuda pendiente visible en la plantilla

#### GH-26
**Título:** Revisión de paridad con el MVP y release v1.0.0
**Etiquetas:** feature

Comprobar que la aplicación cubre todo lo que hacía el MVP inicial antes de publicar la v1.0.0.

**Criterios de aceptación**
- [ ] Recorrido completo en el móvil: plantilla, pasar lista, convocatoria, multas
- [ ] Funciona con los dos equipos y el cambio entre ellos
- [ ] Sin issues `bug` abiertas que impidan completar el recorrido anterior
- [ ] Release `v1.0.0` en GitHub y desplegada en producción

---

### Milestone: Ciclo 5 · Personalización

#### GH-27
**Título:** API de configuración visual del club
**Etiquetas:** feature, backend

Depende de GH-7.

**Criterios de aceptación**
- [ ] `PATCH /api/clubes/:cid` acepta `nombre`, `color_principal` y `color_secundario`, con los colores validados como hex
- [ ] Solo para administradores del club
- [ ] Los datos visuales del club se incluyen en `GET /api/equipos` para aplicar el tema sin peticiones adicionales
- [ ] Tests

#### GH-28
**Título:** Subida del escudo del club
**Etiquetas:** feature, backend, seguridad

Depende de GH-7.

**Criterios de aceptación**
- [ ] `PUT /api/clubes/:cid/escudo` (solo administradores del club) con multipart; solo PNG y WebP, comprobando el contenido real y no solo la extensión
- [ ] Tamaño máximo configurable; imagen redimensionada y normalizada en el servidor
- [ ] Guardado en el volumen `uploads` con nombre generado; el anterior se elimina
- [ ] Servido con caché y cabeceras adecuadas
- [ ] Tests

#### GH-29
**Título:** Tema dinámico por club
**Etiquetas:** feature, frontend

Depende de GH-27.

**Criterios de aceptación**
- [ ] Al cargar el equipo activo se aplican los colores de su club a las variables CSS de toda la aplicación
- [ ] Contraste automático: texto blanco o negro sobre el color principal según luminosidad (WCAG AA)
- [ ] Escudo del club en la cabecera (junto al nombre y la categoría del equipo) y en el selector de equipo
- [ ] Color de la barra del navegador (`theme-color`) acorde al club
- [ ] Sin parpadeo de colores por defecto al abrir la app

#### GH-30
**Título:** Pantalla de configuración del equipo y del club
**Etiquetas:** feature, frontend

Depende de GH-28 y GH-29.

**Criterios de aceptación**
- [ ] Datos del equipo (entrenador y admin): editar nombre, categoría y temporada
- [ ] Identidad del club (solo administradores del club): nombre del club, subir y cambiar escudo con vista previa, selectores de color con vista previa en vivo antes de guardar y restablecer colores por defecto
- [ ] Aviso de que el escudo y los colores se aplican a todos los equipos del club
- [ ] Equipos del club (solo administradores del club): listado con categoría, crear equipo y borrar equipo con confirmación escribiendo su nombre

---

### Milestone: Ciclo 6 · Estadísticas

#### GH-31
**Título:** Modelo de estadísticas de partido
**Etiquetas:** feature, db, backend

**Criterios de aceptación**
- [ ] Campos `estado`, `goles_favor`, `goles_contra` en `partidos` si no se añadieron en GH-18
- [ ] Asociación de tipo de tarjeta en el catálogo por defecto (amarilla por protestar → amarilla, roja → roja), con migración de datos para los equipos existentes
- [ ] Tablas `participaciones` y `eventos_partido` (con `origen`) según la sección 6
- [ ] Migración y seed con partidos jugados de ejemplo

#### GH-32
**Título:** Servicio de importación de estadísticas
**Etiquetas:** feature, backend

Punto de entrada único para registrar estadísticas con fuentes intercambiables. Depende de GH-31.

**Criterios de aceptación**
- [ ] Interfaz común de fuente (`manual`, `acta`, `federacion`) que produce resultado, participaciones y eventos normalizados
- [ ] Implementación de la fuente `manual`
- [ ] Validaciones comunes: solo jugadores convocados, minutos coherentes, un jugador no entra dos veces
- [ ] Cálculo de minutos jugados a partir de titularidad y cambios
- [ ] Tests

#### GH-33
**Título:** API de estadísticas de partido
**Etiquetas:** feature, backend

Depende de GH-32.

**Criterios de aceptación**
- [ ] `PUT .../partidos/:pid/resultado` marca el partido como jugado
- [ ] `PUT .../partidos/:pid/participaciones` (titulares y suplentes)
- [ ] Crear, listar y borrar eventos; los eventos de un partido los ve cualquier miembro
- [ ] `GET /api/equipos/:id/estadisticas?temporada=` (filtra por `partidos.temporada`): goles, asistencias, minutos, partidos, titularidades y tarjetas por jugador; el rol jugador solo ve las suyas
- [ ] Tests

#### GH-34
**Título:** Pantalla de partido jugado
**Etiquetas:** feature, frontend

Depende de GH-33.

**Criterios de aceptación**
- [ ] Marcador de resultado
- [ ] Selección de titulares entre los convocados
- [ ] Registro rápido de eventos: tipo, jugador y minuto, pensado para usarse durante o justo después del partido
- [ ] Línea de tiempo del partido con opción de borrar eventos

#### GH-35
**Título:** Pantalla de estadísticas de temporada
**Etiquetas:** feature, frontend

Depende de GH-33.

**Criterios de aceptación**
- [ ] Tablas de goleadores, asistentes, minutos y tarjetas
- [ ] Ficha de estadísticas por jugador
- [ ] Resultados de la temporada del equipo (ganados, empatados, perdidos, goles)

#### GH-36
**Título:** Propuesta de multa al registrar una tarjeta
**Etiquetas:** feature, backend, frontend

Depende de GH-24 y GH-33.

**Criterios de aceptación**
- [ ] Al registrar una amarilla o roja, la app propone los motivos activos del catálogo con ese `tipo_evento`; si no hay ninguno, no propone nada
- [ ] El entrenador confirma, edita o descarta; nunca se crea sola
- [ ] La multa queda vinculada al evento (`evento_id`); al borrar el evento se avisa de la multa asociada

#### GH-37
**Título:** Importación asistida desde el acta del partido
**Etiquetas:** investigacion, backend

Evaluar la extracción de datos del PDF del acta oficial que descarga el entrenador. Depende de GH-32.

**Criterios de aceptación**
- [ ] Análisis del formato de actas reales de la federación gallega
- [ ] Prueba de concepto de extracción de resultado, goleadores y tarjetas
- [ ] Emparejamiento de nombres del acta con la plantilla
- [ ] Documento con conclusiones y propuesta de implementación como fuente `acta` (siempre con revisión del entrenador antes de guardar)

---

### Milestone: Ciclo 7 · Planificación de entrenos

#### GH-38
**Título:** Modelo de ejercicios, medios y planificación
**Etiquetas:** feature, db, backend

**Criterios de aceptación**
- [ ] Tablas `ejercicios`, `ejercicio_medios` y `entreno_ejercicios` según la sección 6
- [ ] Nuevos campos en `entrenos`: `hora`, `duracion_prevista`, `objetivo`, `es_plantilla` y `nombre_plantilla`; `fecha` nullable solo en plantillas y unicidad de fecha mediante índice parcial que excluye plantillas
- [ ] Las plantillas no aparecen en el historial ni cuentan para el porcentaje de asistencia
- [ ] Un ejercicio usado en alguna sesión no se puede borrar, solo archivar
- [ ] Ajuste de GH-15: un entreno con planificación no se elimina al quedar sin asistencias
- [ ] Migración y seed con ejercicios y una sesión de ejemplo

#### GH-39
**Título:** Almacenamiento y servicio de fotos y vídeos
**Etiquetas:** feature, backend, infra, seguridad

Servicio común de medios para los ejercicios. Depende de GH-28 y GH-38.

**Criterios de aceptación**
- [ ] Subida multipart en streaming (p. ej. `busboy`), sin cargar el archivo entero en memoria
- [ ] Tipos permitidos comprobando el contenido real: fotos JPEG, PNG, WebP (y HEIC convertido si es viable: los binarios precompilados de `sharp` no incluyen HEIC); vídeos MP4, WebM y MOV
- [ ] Límites configurables por `.env` para foto y vídeo; `client_max_body_size` de nginx configurado con el mismo límite y tiempos de espera suficientes para subidas lentas desde el móvil
- [ ] Fotos: eliminación de metadatos EXIF (incluida la ubicación), redimensionado y miniatura
- [ ] Vídeos: miniatura y duración extraídas con ffmpeg. Los MP4 H.264 y WebM se guardan tal cual; los MOV o HEVC (iPhone) se recodifican a MP4 H.264 en segundo plano, con estado "procesando" visible
- [ ] La subida del escudo de GH-28 pasa a usar este servicio común
- [ ] Nombres de archivo generados; nunca se usa el nombre original en disco
- [ ] Servido solo a miembros del equipo, con caché y soporte de `Range` para avanzar en los vídeos
- [ ] Al borrar un medio o un ejercicio se eliminan sus archivos
- [ ] Tests

#### GH-40
**Título:** API de biblioteca de ejercicios
**Etiquetas:** feature, backend

Depende de GH-38 y GH-39.

**Criterios de aceptación**
- [ ] Listar con búsqueda por texto y filtros por categoría, etiqueta y archivados
- [ ] Crear, editar, archivar y borrar (si no se ha usado)
- [ ] Duplicar ejercicio con sus medios y copiarlo a otro equipo en el que el usuario sea entrenador o admin
- [ ] Añadir medios (archivo o enlace externo), editar pie, reordenar y borrar
- [ ] Gestión solo para entrenador y admin; lectura para cualquier miembro
- [ ] Tests

#### GH-41
**Título:** API de planificación de sesiones
**Etiquetas:** feature, backend

Depende de GH-38.

**Criterios de aceptación**
- [ ] `PUT /api/equipos/:id/entrenos/:fecha/plan` guarda en una transacción los datos de la sesión y la lista ordenada de ejercicios
- [ ] Listado de sesiones por rango de fechas con duración total y número de ejercicios
- [ ] Duplicar una sesión en otra fecha
- [ ] Guardar una sesión como plantilla y aplicar una plantilla a una fecha
- [ ] La planificación y la asistencia de un mismo entreno conviven sin interferir
- [ ] Tests

#### GH-42
**Título:** Pantalla de biblioteca de ejercicios
**Etiquetas:** feature, frontend

Depende de GH-40.

**Criterios de aceptación**
- [ ] Listado con miniatura, categoría y duración; búsqueda y filtros
- [ ] Ficha del ejercicio con galería de fotos, reproductor de vídeo y enlaces externos
- [ ] Formulario de ejercicio con subida de fotos y vídeos desde la galería o la cámara del móvil
- [ ] Barra de progreso de subida, posibilidad de cancelar y mensaje claro si el archivo supera el límite
- [ ] Reordenar medios y editar su pie
- [ ] Duplicar, copiar a otro equipo y archivar

#### GH-43
**Título:** Pantalla de planificación de sesión
**Etiquetas:** feature, frontend

Depende de GH-41 y GH-42.

**Criterios de aceptación**
- [ ] Vista de próximas sesiones (lista o calendario semanal) accesible desde Entrenos
- [ ] Editor de sesión: fecha, hora, duración prevista, objetivo y notas
- [ ] Añadir ejercicios desde la biblioteca con buscador; reordenar arrastrando; duración e indicaciones por ejercicio
- [ ] Duración total frente a la prevista, con aviso si se supera
- [ ] Duplicar sesión, guardar como plantilla y crear desde plantilla
- [ ] El entreno planificado aparece en la pantalla de pasar lista de esa fecha

#### GH-44
**Título:** Modo campo de la sesión
**Etiquetas:** feature, frontend

Ver la sesión durante el entreno en el móvil. Depende de GH-43.

**Criterios de aceptación**
- [ ] Vista a pantalla completa ejercicio a ejercicio, con avance y retroceso
- [ ] Muestra indicaciones, duración y los medios del ejercicio (vídeo reproducible en el propio campo)
- [ ] Cuenta atrás opcional por ejercicio
- [ ] Acceso directo a pasar lista de esa sesión
- [ ] La pantalla no se apaga mientras está abierta (Wake Lock, si el navegador lo permite)
- [ ] Legible a pleno sol: tamaño de letra grande y alto contraste

---

### Milestone: Ciclo 8 · Operación

#### GH-45
**Título:** Copias de seguridad automáticas
**Etiquetas:** feature, infra

Depende de GH-13; sustituye a su copia provisional.

**Criterios de aceptación**
- [ ] `pg_dump` diario de producción y copia incremental del volumen `uploads` (escudos, fotos y vídeos de ejercicios)
- [ ] Rotación: 7 diarias, 4 semanales y 6 mensuales
- [ ] Copia fuera del servidor (disco externo u otra máquina de la red)
- [ ] Aviso si una copia falla
- [ ] Aviso si el espacio libre en disco del servidor baja de un umbral configurable

#### GH-46
**Título:** Procedimiento de restauración probado
**Etiquetas:** feature, infra

Depende de GH-45.

**Criterios de aceptación**
- [ ] Script para restaurar una copia en un entorno indicado
- [ ] Restauración real de producción en pruebas verificada
- [ ] Procedimiento documentado en `docs/operacion.md`

#### GH-47
**Título:** Logs estructurados y rotación
**Etiquetas:** feature, infra, backend

**Criterios de aceptación**
- [ ] Logs del backend en JSON con nivel, ruta, estado y duración, sin datos sensibles
- [ ] Rotación de logs de los contenedores configurada
- [ ] Comando documentado para consultar errores recientes

#### GH-48
**Título:** Mantenimiento y actualizaciones
**Etiquetas:** feature, infra, seguridad

**Criterios de aceptación**
- [ ] Dependabot para dependencias npm, imágenes Docker y GitHub Actions, con pull requests contra `develop`
- [ ] Imágenes base con versión fijada
- [ ] Procedimiento documentado para actualizar PostgreSQL de versión mayor

---

### Milestone: Ciclo 9 · Roles en uso

#### GH-49
**Título:** Modelo y API de invitaciones
**Etiquetas:** feature, db, backend, seguridad

**Criterios de aceptación**
- [ ] Tabla `invitaciones` según la sección 6; solo se guarda el hash del token
- [ ] `POST /api/equipos/:id/invitaciones` (solo admin): email, rol y ficha de jugador opcional; devuelve enlace de un solo uso con caducidad
- [ ] `POST /api/clubes/:cid/invitaciones` (solo administradores del club): invitación como administrador del club
- [ ] Listar y revocar invitaciones pendientes (`revocada_en`)
- [ ] Tests

#### GH-50
**Título:** Aceptar invitación y crear cuenta
**Etiquetas:** feature, backend, frontend

Depende de GH-49.

**Criterios de aceptación**
- [ ] Pantalla a la que lleva el enlace: crear contraseña o iniciar sesión si la cuenta ya existe
- [ ] Al aceptar se crea la membresía con el rol indicado y, si procede, se vincula la ficha de jugador
- [ ] Enlaces caducados, usados o revocados muestran un mensaje claro

#### GH-51
**Título:** Gestión de miembros del equipo y administradores del club
**Etiquetas:** feature, backend, frontend

Depende de GH-49.

**Criterios de aceptación**
- [ ] Pantalla (solo admin) con miembros, rol e invitaciones pendientes; los administradores del club aparecen como admin heredado, sin poder quitarlos desde el equipo
- [ ] Cambiar rol y revocar acceso
- [ ] Pantalla (solo administradores del club) para invitar, listar y retirar administradores del club; un club nunca queda sin administradores

#### GH-52
**Título:** Experiencia del rol jugador
**Etiquetas:** feature, backend, frontend

Depende de GH-50.

**Criterios de aceptación**
- [ ] Navegación adaptada: plantilla, próximas convocatorias, mis asistencias, mis multas y mis estadísticas
- [ ] Sin controles de edición en ninguna pantalla
- [ ] Revisión de que todas las rutas filtran por la ficha del jugador según la visibilidad de la sección 3 (en la plantilla, asistencia y deuda solo las suyas)

#### GH-53
**Título:** Tests de la matriz de permisos
**Etiquetas:** feature, backend, seguridad

**Criterios de aceptación**
- [ ] Test por cada fila de la tabla de la sección 3 y cada rol
- [ ] Casos de acceso a un equipo ajeno y a datos de otro jugador
- [ ] Casos de club: el administrador del club es admin en todos sus equipos pero no en los de otro club; un miembro de un equipo no accede a otros equipos de su mismo club; solo los administradores del club gestionan la identidad y los equipos del club
- [ ] Integrados en la CI

---

### Milestone: Ciclo 10 · Exposición pública

#### GH-54
**Título:** Servidor dedicado bastionado
**Etiquetas:** feature, infra, seguridad

**Criterios de aceptación**
- [ ] Máquina dedicada solo a la aplicación
- [ ] SSH solo con clave, sin acceso root, y solo desde la red de administración o Tailscale
- [ ] Actualizaciones de seguridad automáticas del sistema
- [ ] Docker en modo rootless o con usuario dedicado
- [ ] Documentado en `docs/servidor.md`

#### GH-55
**Título:** Red aislada y cortafuegos
**Etiquetas:** feature, infra, seguridad

Depende de GH-54.

**Criterios de aceptación**
- [ ] Servidor en una red o VLAN aislada (DMZ) sin acceso al resto de la red de casa
- [ ] Cortafuegos del router: solo 80 y 443 hacia el servidor
- [ ] Cortafuegos del servidor (ufw o nftables): entrada solo 80/443 y administración por Tailscale

#### GH-56
**Título:** Dominio y publicación por el router
**Etiquetas:** feature, infra

Depende de GH-55.

**Criterios de aceptación**
- [ ] Comprobado que la conexión no usa CG-NAT (o IP pública solicitada a la operadora)
- [ ] Subdominio DuckDNS con actualización automática de IP en un contenedor
- [ ] IP local fija del servidor y reenvío de puertos 80/443 en el router
- [ ] Acceso verificado desde fuera de casa con datos móviles

#### GH-57
**Título:** HTTPS público y cabeceras de seguridad
**Etiquetas:** feature, infra, seguridad

Depende de GH-56.

**Criterios de aceptación**
- [ ] nginx con certificado de Let's Encrypt obtenido con certbot (desafío HTTP-01 por el puerto 80) y renovación automática que recarga nginx
- [ ] Redirección HTTP → HTTPS y HSTS
- [ ] Cabeceras: Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [ ] Calificación A o superior en una prueba externa de TLS

#### GH-58
**Título:** Endurecimiento de la aplicación para internet
**Etiquetas:** feature, backend, infra, seguridad

**Criterios de aceptación**
- [ ] Limitación de peticiones en nginx (`limit_req`), global y específica para login e invitaciones
- [ ] Bloqueo de IPs abusivas (CrowdSec o fail2ban) a partir de los logs de nginx
- [ ] Revisión de dependencias con vulnerabilidades conocidas
- [ ] Revisión de la configuración de cookies y CSRF para acceso público

#### GH-59
**Título:** Migración de producción al servidor público
**Etiquetas:** feature, infra

Depende de GH-54 a GH-58.

**Criterios de aceptación**
- [ ] Copia de seguridad y restauración de producción en el nuevo servidor
- [ ] Verificación completa de funcionalidades
- [ ] Usuarios avisados del nuevo enlace y reinstalación de la PWA si cambia el dominio
- [ ] Release `v2.0.0`
