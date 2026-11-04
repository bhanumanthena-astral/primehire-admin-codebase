import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:['assessment.spec.ts','apple-design.spec.ts'],workers:1,timeout:120000,expect:{timeout:20000},
  outputDir:'test-results/assessment',use:{baseURL:'http://127.0.0.1:4176',headless:true,channel:'msedge',trace:'retain-on-failure'},
  webServer:[{command:'backend\\.venv-v2\\Scripts\\python.exe backend/tests/e2e_assessment_server.py',url:'http://127.0.0.1:8005/api/health',reuseExistingServer:false},
    {command:'npx vite --config e2e/vite.assessment.config.ts --host 127.0.0.1 --port 4176 --strictPort',url:'http://127.0.0.1:4176',env:{VITE_API_URL:''},reuseExistingServer:false}]});
