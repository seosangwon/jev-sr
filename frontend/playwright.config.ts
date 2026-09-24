import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5273', headless: true, browserName: 'chromium' },
  webServer: [
    { command: '../.venv/bin/python -m uvicorn backend.app.main:app --app-dir .. --host 127.0.0.1 --port 8100', url: 'http://127.0.0.1:8100/api/config', env: { PRIORITY_ANALYZER:'mock', TYPESAFE_API_KEY:'', LOW_CONFIDENCE_THRESHOLD:'0.60' }, reuseExistingServer: false },
    { command: 'npm run dev -- --port 5273 --strictPort', url:'http://127.0.0.1:5273', env: { API_PROXY_TARGET:'http://127.0.0.1:8100' }, reuseExistingServer:false },
  ],
});
