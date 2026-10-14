import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3005,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3007',
        changeOrigin: true,
      },
      '/uploads': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3007',
        changeOrigin: true,
      },
      '/local_storage': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3007',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3007',
        ws: true,
      },
    },
  },
})
