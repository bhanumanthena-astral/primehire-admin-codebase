import {defineConfig} from '@playwright/test';
import {existsSync} from 'node:fs';
const python=process.env.PRIMEHIRE_TEST_PYTHON||(existsSync('backend/.venv-v2/Scripts/python.exe')?'backend\\.venv-v2\\Scripts\\python.exe':'backend\\.venv\\Scripts\\python.exe');
export default defineConfig({
  testDir:'./e2e', testMatch:'intake.spec.ts', workers:1, timeout:120000,
  expect:{timeout:20000}, outputDir:'test-results/intake',
  use:{baseURL:'http://127.0.0.1:4174',headless:true,channel:'msedge',trace:'retain-on-failure'},
  webServer:[
    {command:`${python} backend/tests/e2e_intake_server.py`,url:'http://127.0.0.1:8003/api/health',reuseExistingServer:false},
    {command:'npx vite --config e2e/vite.intake.config.ts --host 127.0.0.1 --port 4174 --strictPort',url:'http://127.0.0.1:4174',env:{VITE_API_URL:''},reuseExistingServer:false},
  ],
});
