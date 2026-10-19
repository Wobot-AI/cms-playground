import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local dev: forward backend routes to the Hono server, so the browser sees one origin.
// Production: the frontend calls VITE_API_BASE_URL directly (see src/lib/api.ts).
const backend = process.env.BACKEND_URL ?? 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5317,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/camera': backend,
    },
  },
})
