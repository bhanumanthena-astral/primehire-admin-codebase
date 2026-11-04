import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  envDir: false,
  envPrefix: 'ELITEHR_PUBLIC_',
  define: {'import.meta.env.VITE_API_URL': JSON.stringify('')},
  plugins: [react(), tailwindcss()],
  // Root BFF and standalone frontend have separate dependency trees. Always
  // resolve React (including JSX runtimes) from the frontend installation.
  cacheDir: path.join(root, 'node_modules', '.vite-frontend'),
  optimizeDeps: {
    entries: [path.join(root, 'index.html')],
    include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-router-dom', 'motion/react', '@base-ui/react/slider'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': root,
      'react': path.join(root, 'node_modules', 'react'),
      'react-dom': path.join(root, 'node_modules', 'react-dom'),
    },
  },
  build: {outDir: path.join(root,'dist'), emptyOutDir: true},
  server: {
    allowedHosts: true,
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
    proxy: {'/api': {target: process.env.FASTAPI_URL || 'http://127.0.0.1:8002', changeOrigin: true}},
  },
});
