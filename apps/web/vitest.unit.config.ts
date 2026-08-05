import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '$lib', replacement: path.join(root, 'src', 'lib') },
      { find: '$app/paths', replacement: path.join(root, 'src', 'test', 'unit-app-paths.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/lib/*.test.ts', 'src/lib/season/**/*.test.ts'],
    exclude: [...defaultExclude, 'e2e/**'],
  },
});
