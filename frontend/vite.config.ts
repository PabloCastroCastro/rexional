/// <reference types="vitest/config" />

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  define: { __VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      // Una versión nueva no se activa sola: se avisa y el usuario decide cuándo actualizar
      registerType: 'prompt',
      // El service worker solo se genera en la compilación (en desarrollo no interfiere con la recarga)
      disable: Boolean(process.env.VITEST),
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Vestuario',
        short_name: 'Vestuario',
        description: 'Plantilla, entrenos, convocatorias y multas del vestuario',
        lang: 'es',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#14553d',
        background_color: '#14553d',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Se guarda la aplicación para abrirla al instante; la API nunca se cachea
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // En desarrollo la API se sirve desde el mismo origen, igual que tras nginx en producción
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
    watch: {
      // Necesario si los cambios no se detectan con el código montado en Docker (p. ej. Windows)
      usePolling: process.env.VITE_USE_POLLING === 'true',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/preparar.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
    // El módulo virtual del service worker solo existe al compilar con el plugin de la PWA
    alias: {
      'virtual:pwa-register/react': fileURLToPath(new URL('./test/pwa-falso.ts', import.meta.url)),
    },
  },
})
