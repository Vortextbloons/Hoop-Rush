import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@hoop-rush/persistence',

    root: path.dirname(fileURLToPath(import.meta.url)),
    setupFiles: ['./src/test-setup.ts'],
  },
});
