import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  testMatch: "recruitment.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 20000 },
  outputDir: "test-results/recruitment",
  use: {
    baseURL: "http://127.0.0.1:4175",
    headless: true,
    channel: "msedge",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "backend\\.venv-v2\\Scripts\\python.exe backend/tests/e2e_recruitment_server.py",
      url: "http://127.0.0.1:8004/api/health",
      reuseExistingServer: false,
    },
    {
      command:
        "npx vite --config e2e/vite.recruitment.config.ts --host 127.0.0.1 --port 4175 --strictPort",
      url: "http://127.0.0.1:4175",
      env: { VITE_API_URL: "" },
      reuseExistingServer: false,
    },
  ],
});
