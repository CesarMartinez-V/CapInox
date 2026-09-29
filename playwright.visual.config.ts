import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:'./tests/visual',
  timeout:20000,
  use:{baseURL:'http://127.0.0.1:5188',browserName:'chromium',channel:'chrome',headless:true},
  webServer:{command:'npm run dev:frontend -- --host 127.0.0.1 --port 5188 --strictPort',url:'http://127.0.0.1:5188',reuseExistingServer:true,timeout:30000},
  reporter:'list',
  workers:1
});
