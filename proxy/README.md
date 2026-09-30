# Vestuario · Proxy

Servidor web de Vestuario con **nginx** (imagen `nginx-unprivileged`, sin root, escucha en el puerto 8080). Es el único servicio que publica un puerto.

- Sirve los estáticos compilados del frontend, con redirección de las rutas de la PWA a `index.html`, compresión y caché.
- Redirige `/api` al backend, con las cabeceras de IP real y subidas en streaming.
- Limita el tamaño de las subidas (`client_max_body_size`).
- `/nginx-health` responde `ok` para el healthcheck.

Más adelante asumirá HTTPS con el certificado de Tailscale (GH-13), la caché de la PWA (GH-9), las cabeceras de seguridad (GH-57) y la limitación de peticiones (GH-58).

## Relación con los otros proyectos

- **Frontend:** la imagen compila `frontend/` con su interfaz de construcción (`npm ci && npm run build` → `dist/`), recibiéndolo como contexto de construcción adicional llamado `frontend`. No hay contenedor de frontend en producción.
- **Backend:** lo alcanza por la red interna de Docker en `BACKEND_URL`.

## Configuración

La configuración está en `templates/default.conf.template`. La imagen oficial la procesa con `envsubst` al arrancar, sustituyendo solo estas variables:

| Variable | Por defecto | Descripción |
|---|---|---|
| `BACKEND_URL` | `http://backend:3000` | URL interna del backend |
| `MAX_SUBIDA` | `200m` | Tamaño máximo de una petición (formato de nginx: `200m`, `1g`) |

Las variables propias de nginx (`$host`, `$uri`…) no se tocan.

## Construir la imagen

Desde esta carpeta:

```
docker build --build-context frontend=../frontend -t vestuario-proxy .
```

Normalmente se construye desde la raíz con `docker compose build proxy`.
