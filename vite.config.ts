import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    }
  },
  server: {
    port: 5175,
    host: true
  },
  preview: {
    port: 5175,
    host: true
  },
  define: {
    'import.meta.env.VITE_FUNCTIONS_BASE_URL': JSON.stringify(process.env.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071'),
    'import.meta.env.VITE_API_BASE': JSON.stringify(process.env.VITE_API_BASE || 'http://localhost:8787')
  }
})
