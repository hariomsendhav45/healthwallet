import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3000',
    url: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
