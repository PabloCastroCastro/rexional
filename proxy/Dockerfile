# syntax=docker/dockerfile:1

# Necesita el contexto de construcción adicional "frontend" apuntando a la carpeta frontend/:
#   docker build --build-context frontend=../frontend -t vestuario-proxy .
# (En Docker Compose se pasa con build.additional_contexts.)

# Compila los estáticos del frontend con su interfaz de construcción: npm ci && npm run build → dist/
FROM node:24-alpine AS estaticos
WORKDIR /app
COPY --from=frontend . .
# npm ci borra cualquier node_modules copiado del host antes de instalar
RUN --mount=type=cache,target=/root/.npm npm ci && npm run build

FROM nginxinc/nginx-unprivileged:1.30-alpine
# Valores por defecto de las variables de las plantillas; se sobrescriben desde Compose
ENV BACKEND_URL=http://backend:3000 \
    MAX_SUBIDA=200m
COPY templates/ /etc/nginx/templates/
COPY --from=estaticos /app/dist /usr/share/nginx/html
EXPOSE 8080
