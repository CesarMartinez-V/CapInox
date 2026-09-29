import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [vue()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true, proxy: {
    '/api': 'http://127.0.0.1:3100',
    '/media': 'http://127.0.0.1:3100',
    '/socket.io': { target: 'http://127.0.0.1:3100', ws: true },
  } },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true },
});
