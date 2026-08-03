import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests spawn the real CLI through tsx; under full parallel
    // package execution the spawned processes contend for CPU, so the
    // default 5s per-test budget is too tight. Workers are capped so the
    // subprocess-heavy suite does not oversubscribe the machine.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
