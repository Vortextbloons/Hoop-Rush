/// <reference types="node" />
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  // Cap workers on CI so the shared runner does not oversubscribe small
  // machines; locally Playwright picks its default.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.HOOP_RUSH_E2E_BASE_URL ?? 'http://localhost:4173',
    headless: true,
  },
  // The packaged player index is hash-verified before rendering. Keep the
  // assertion budget above the cold parse/hash cost on slower CI machines.
  expect: {
    timeout: 15_000,
  },
  // Default selection (no --project) runs every test exactly once: the smoke
  // project covers @smoke-tagged tests, the full project covers the rest. The
  // wrapper's `--grep @smoke` flag then matches only the smoke project's
  // tests, so `pnpm e2e:smoke` stays a fast subset of `pnpm e2e`.
  projects: [
    {
      name: 'smoke',
      grep: /@smoke/,
    },
    {
      name: 'full',
      // Everything except @smoke: /@smoke/ would duplicate the smoke tests
      // when running the default project selection.
      grep: /^(?!.*@smoke)/,
    },
  ],
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
