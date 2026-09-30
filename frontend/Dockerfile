# syntax=docker/dockerfile:1

# Se instalan como el usuario node: en desarrollo node_modules vive en un volumen en el que
# Vite necesita escribir su caché (node_modules/.vite)
FROM node:24-alpine AS deps
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

# Desarrollo: servidor de Vite con el código montado desde el host
FROM deps AS dev
EXPOSE 5173
CMD ["npm", "run", "dev"]

# Compilación de los estáticos en /app/dist.
# En producción no hay contenedor de frontend: el proxy (nginx) incluye estos estáticos en su imagen.
FROM deps AS build
COPY --chown=node:node . .
RUN npm run build
