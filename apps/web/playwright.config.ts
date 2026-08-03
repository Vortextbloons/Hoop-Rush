/// <reference types="node" />
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4173',
    headless: true,
  },
  // The packaged player index is hash-verified before rendering. Keep the
  // assertion budget above the cold parse/hash cost on slower CI machines.
  expect: {
    timeout: 15_000,
  },
  webServer: {
    command: '.\\node_modules\\.bin\\vite.cmd preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
