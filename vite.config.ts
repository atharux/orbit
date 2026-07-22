import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        rewrite: path => path.replace(/^\/api/, ''),
      },
      '/scraper-api': {
        target: 'https://venue-scraper.athar-hafiz.workers.dev',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/scraper-api/, ''),
      },
    },
  },
})
