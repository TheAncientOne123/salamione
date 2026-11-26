import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Frontend de SalamiOne: tres páginas (landing, acceso y app) en React.
export default defineConfig({
  root: 'web',
  publicDir: 'public',
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('shared') } },
  build: {
    outDir: resolve('dist'),
    emptyOutDir: true,
    rollupOptions: { input: { index: resolve('web/index.html'), login: resolve('web/login.html'), app: resolve('web/app.html') } },
  },
});
