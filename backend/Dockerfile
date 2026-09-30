# syntax=docker/dockerfile:1

FROM node:24-alpine AS base
# tzdata para que TZ (Europe/Madrid) se aplique también fuera de Node
RUN apk add --no-cache tzdata
WORKDIR /app

# Dependencias completas, para desarrollo y compilación
# Se instalan como el usuario node: en desarrollo node_modules vive en un volumen que debe poder escribir
FROM base AS deps
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

# Desarrollo: el código se monta desde el host y se recarga en caliente
FROM deps AS dev
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM deps AS build
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node src ./src
RUN npm run build

# Solo dependencias de producción
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Imagen final: sin herramientas de compilación y sin root
FROM base AS runtime
ENV NODE_ENV=production
COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Migraciones que el backend aplica al arrancar
COPY drizzle ./drizzle
# Directorio del volumen de subidas, propiedad del usuario sin privilegios
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
