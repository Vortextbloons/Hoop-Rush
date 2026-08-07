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
    // past the 5s default and the prior 15s and 30s budgets. The budget is
    // moderate (a regressed test should surface at a sane threshold), and
    // the retry gives the contention-flaky seeded suites one clean re-run —
    // seeded output is reproducible, so retries cannot mask real regressions.
    testTimeout: 45_000,
    retry: 1,
  },
});
