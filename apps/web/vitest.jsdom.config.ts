import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExclude, defineProject } from 'vitest/config';

const sveltePackageJson = fileURLToPath(import.meta.resolve('svelte/package.json'));
const svelteClientEntry = path.join(path.dirname(sveltePackageJson), 'src', 'index-client.js');

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

export default defineProject({
  plugins: [sveltekit()],
  resolve: {
    alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
  },
  test: {
    name: 'web-jsdom',
    root: path.dirname(fileURLToPath(import.meta.url)),
    environment: 'jsdom',
    include: ['src/lib/components/__tests__/**/*.test.ts'],
    setupFiles: ['src/test/svelte-testing.ts'],
    css: false,
    exclude: [...defaultExclude, 'e2e/**'],
    passWithNoTests: true,
    isolate: false,
    experimental: {
      fsModuleCache: true,
    },
  },
});
