import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

const sveltePackageJson = fileURLToPath(import.meta.resolve('svelte/package.json'));
const svelteClientEntry = path.join(path.dirname(sveltePackageJson), 'src', 'index-client.js');

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
  },
  test: {
    name: '@hoop-rush/web',
    root: path.dirname(fileURLToPath(import.meta.url)),
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: [...defaultExclude, 'e2e/**', 'src/lib/components/__tests__/**'],
    setupFiles: ['src/test/svelte-testing.ts'],
    css: false,
    passWithNoTests: true,
    isolate: false,
    experimental: {
      fsModuleCache: true,
    },
    projects: [
      {
        plugins: [sveltekit()],
        resolve: {
          alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
        },
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/lib/components/__tests__/**'],
        },
      },
      {
        plugins: [sveltekit()],
        resolve: {
          alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
        },
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/lib/components/__tests__/**/*.test.ts'],
        },
      },
    ],
  },
});
