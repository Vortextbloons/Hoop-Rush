import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

/**
 * One vitest process for every package (vitest 4 projects). A single runner
 * boots the transform pipeline once and shares the worker pool across
 * projects, instead of seven parallel processes contending for the CPU.
 * Per-package behavior (sveltekit plugin, setups, timeouts, worker caps)
 * lives in each package's own vitest.config.ts.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'tools/*', 'apps/*'],
    // One shared pool across all projects: a single cap prevents the CPU
    // oversubscription that used to flake the seeded engine suites. The
    // pool shares the machine with CLI subprocess spawns, so two cores of
    // headroom keep those responsive. Capped to the machine's cores so
    // local tuning (10 on a 12-core box) does not oversubscribe small CI
    // runners; VITEST_MAX_WORKERS overrides when explicit control is needed.
    maxWorkers: process.env.VITEST_MAX_WORKERS
      ? Number(process.env.VITEST_MAX_WORKERS)
      : Math.min(10, availableParallelism()),
  },
});
