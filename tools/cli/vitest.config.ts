import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@hoop-rush/cli',
    // Pin the project root so includes/excludes resolve from the package
    // directory under the workspace projects runner.
    root: path.dirname(fileURLToPath(import.meta.url)),
    // Integration tests spawn the real CLI through node; under the shared
    // runner the spawned processes contend for CPU, so the default 5s
    // per-test budget is too tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
