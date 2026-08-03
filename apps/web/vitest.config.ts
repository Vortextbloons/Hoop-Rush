import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

/**
 * Svelte's client entry. Adding a `browser` resolve condition instead (the
 * @testing-library/svelte default) leaks into node-env unit tests:
 * @sveltejs/kit's `#app/paths` package-import maps "browser" to the client
 * build, which touches `window` at import time. Pinning only the bare
 * `svelte` root to the client entry gives component tests a mountable Svelte
 * 5 runtime while `$app/paths` keeps resolving to the server build. The
 * client entry is import-safe without a DOM, so node-env tests are
 * unaffected either way.
 */
const sveltePackageJson = fileURLToPath(import.meta.resolve('svelte/package.json'));
const svelteClientEntry = path.join(path.dirname(sveltePackageJson), 'src', 'index-client.js');

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
  },
  test: {
    // Pure-TS unit tests (src/lib/*.test.ts) run in the node environment by
    // default. Component tests opt into jsdom per file with a
    // `// @vitest-environment jsdom` docblock comment (see
    // src/test/svelte-testing.ts for the full two-environment story).
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/svelte-testing.ts'],
    css: false,
    // Playwright journeys live in e2e/ and run via `pnpm e2e`.
    exclude: [...defaultExclude, 'e2e/**'],
    // No testable units yet beyond the journeys; keep the gate green.
    passWithNoTests: true,
    // The suite is dominated by Vite/SvelteKit transform+import overhead, not
    // by test execution (~1s of ~50s wall). Sharing one module registry per
    // worker (isolate: false) transforms each module once instead of once per
    // test file, which cuts most of that overhead. State is scoped per file
    // (setups, mocks, jsdom envs), so no leakage is expected; the component
    // tests still clean up the DOM via afterEach.
    isolate: false,
    // Fewer workers means fewer duplicated transform passes over the same
    // module graph; with the shared module registry the 8 small files still
    // parallelize fine on 2 workers, and the wall time is set by how many
    // times the SvelteKit graph is built, not by test execution.
    maxWorkers: 2,
    // The suite is dominated by the SvelteKit module graph (35s+ of
    // transform/import per worker for ~0.6s of actual test execution).
    // Persisting transformed modules to disk makes cold-start reruns reuse
    // the graph instead of rebuilding it per worker.
    experimental: {
      fsModuleCache: true,
    },
  },
});
