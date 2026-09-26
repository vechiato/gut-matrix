import { defineConfig, devices } from '@playwright/test';

// Browser smoke test for the editor's DOM glue (the logic itself is unit-tested).
// CI points BASE_URL at the PR's preview deployment; locally it defaults to `npm run dev`.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8788',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
