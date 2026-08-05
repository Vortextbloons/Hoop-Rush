import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@hoop-rush/engine',
    // Pin the project root so includes/excludes resolve from the package
    // directory under the workspace projects runner.
    root: path.dirname(fileURLToPath(import.meta.url)),
    // Seeded sensitivity batches run concurrently (it.concurrent). Under
    // the shared runner, CPU contention pushes the heaviest 300-seed suites
    // past the 5s default and the prior 15s budget.
    testTimeout: 30_000,
  },
});
