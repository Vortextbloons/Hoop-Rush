import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: '@hoop-rush/cli',
    root: path.dirname(fileURLToPath(import.meta.url)),
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
