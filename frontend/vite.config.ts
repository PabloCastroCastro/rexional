import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
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
})
