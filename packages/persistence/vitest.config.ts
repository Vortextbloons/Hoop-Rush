import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@hoop-rush/persistence',
    // Pin the project root so includes/excludes resolve from the package
    // directory under the workspace projects runner.
    root: path.dirname(fileURLToPath(import.meta.url)),
    setupFiles: ['./src/test-setup.ts'],
  },
});
