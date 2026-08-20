import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'tools/*',
      'apps/*',
      'apps/web/vitest.jsdom.config.ts',
    ],

    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : Math.min(10, availableParallelism()),
  },
});
