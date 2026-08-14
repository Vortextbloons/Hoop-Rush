import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@hoop-rush/engine',

    root: path.dirname(fileURLToPath(import.meta.url)),

    testTimeout: 45_000,
    retry: 1,
  },
});
