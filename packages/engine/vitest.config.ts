import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The engine is CPU-bound seeded simulation. Capping workers keeps the
    // full parallel gate from oversubscribing the machine (which made the
    // 10 ms per-game performance goal and sensitivity timeouts flake), while
    // still leaving enough parallelism for fast standalone runs.
    maxWorkers: 6,
    // Seeded sensitivity batches run concurrently (it.concurrent); under a
    // fully parallel gate a single test can exceed the 5s default budget.
    testTimeout: 15_000,
  },
});
