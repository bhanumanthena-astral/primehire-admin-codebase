import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root,
  plugins: [react()],
  resolve: {alias: {'@':root}},
  test: {
    environment: 'jsdom', globals: true,
    maxWorkers: 4,
    include: ['src/**/*.test.{ts,tsx}','cloudflare/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
