import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'tools/*',
      'apps/*',
      {
        extends: 'apps/web/vitest.config.ts',
        test: {
          name: 'web-jsdom',
          environment: 'jsdom',
          include: ['src/lib/components/__tests__/**/*.test.ts'],
        },
      },
    ],

    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : Math.min(10, availableParallelism()),
  },
});
