import { defineConfig, loadEnv } from 'vite'

// Use Vite's env loader so .env/.env.local work in dev and CI-provided envs work in build
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const functionsUrl = env.VITE_FUNCTIONS_BASE_URL || 'http://localhost:7071';
  const apiUrl = env.VITE_API_BASE || 'http://localhost:8787';

  console.log('[vite.config] VITE_FUNCTIONS_BASE_URL:', functionsUrl);
  console.log('[vite.config] VITE_API_BASE:', apiUrl);

  return {
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
    server: { port: 5175, host: true },
    preview: { port: 5175, host: true },
    define: {
      'import.meta.env.VITE_FUNCTIONS_BASE_URL': JSON.stringify(functionsUrl),
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiUrl),
    },
  };
});
