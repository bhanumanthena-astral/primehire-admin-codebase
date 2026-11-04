import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'candidate.spec.ts',workers:1,timeout:120000,expect:{timeout:20000},
  outputDir:'test-results/candidate',use:{baseURL:'http://127.0.0.1:4177',headless:true,channel:'msedge',trace:'retain-on-failure'},
  webServer:[{command:'backend\\.venv-v2\\Scripts\\python.exe backend/tests/e2e_candidate_server.py',url:'http://127.0.0.1:8006/api/health',reuseExistingServer:false},
    {command:'npx vite --config e2e/vite.candidate.config.ts --host 127.0.0.1 --port 4177 --strictPort',url:'http://127.0.0.1:4177',env:{VITE_API_URL:''},reuseExistingServer:false}]});
