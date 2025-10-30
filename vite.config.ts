import { defineConfig } from 'vite'
import { resolve } from 'path'

// Explicitly read from process.env at build time
const functionsUrl = process.env.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';
const apiUrl = process.env.VITE_API_BASE || 'http://localhost:8787';

console.log('[vite.config] VITE_FUNCTIONS_BASE_URL:', functionsUrl);
console.log('[vite.config] VITE_API_BASE:', apiUrl);

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
    'import.meta.env.VITE_FUNCTIONS_BASE_URL': JSON.stringify(functionsUrl),
    'import.meta.env.VITE_API_BASE': JSON.stringify(apiUrl)
  }
})
