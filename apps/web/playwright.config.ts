import { defineConfig } from '@playwright/test';
import type {} from '@types/node';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,

  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.HOOP_RUSH_E2E_BASE_URL ?? 'http://localhost:4173',
    headless: true,
  },

  expect: {
    timeout: 15_000,
  },

  webServer: process.env.HOOP_RUSH_E2E_EXTERNAL_SERVER
    ? undefined
    : {
        command:
          process.platform === 'win32'
            ? '.\\node_modules\\.bin\\vite.cmd preview --port 4173 --strictPort'
            : './node_modules/.bin/vite preview --port 4173 --strictPort',
        url: 'http://localhost:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
