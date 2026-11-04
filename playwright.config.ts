import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testIgnore: ['**/intake.spec.ts','**/recruitment.spec.ts'], fullyParallel: false, workers: 1, timeout: 120000,
  expect: {timeout: 35000},
  use: { baseURL: 'http://127.0.0.1:4173', headless: true, trace: 'retain-on-failure', channel: 'msedge' },
  webServer: [
    { command: 'backend\\.venv\\Scripts\\python.exe backend/tests/e2e_server.py', url: 'http://127.0.0.1:8001/api/health', reuseExistingServer: false },
    { command: 'npx vite --config e2e/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort', url: 'http://127.0.0.1:4173', env: { VITE_API_URL: '' }, reuseExistingServer: false },
  ],
});
