import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is CPU-bound seeded simulation. Capping workers keeps the
    // full parallel gate from oversubscribing the machine (which made the
    // 10 ms per-game performance goal and sensitivity timeouts flake), while
    // still leaving enough parallelism for fast standalone runs.
    maxWorkers: 6,
    // Seeded sensitivity batches run concurrently (it.concurrent). Under
    // `pnpm --parallel -r test:run` on CI, CPU contention pushes the
    // heaviest 300-seed suites past the 5s default and the prior 15s budget.
    testTimeout: 30_000,
  },
});
