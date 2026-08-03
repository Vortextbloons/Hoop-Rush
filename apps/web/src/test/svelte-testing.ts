import { afterEach, vi } from 'vitest';

/**
 * Vitest setup for the SvelteKit app (loaded via `setupFiles` in
 * vitest.config.ts and imported directly by component tests).
 *
 * Two environments:
 *
 * - Pure-TS unit tests (src/lib/*.test.ts) run in the `node` environment.
 *   They never render components, so no DOM is required; the setup only
 *   registers an `afterEach` cleanup that is a no-op while no component has
 *   been rendered.
 * - Component tests opt into jsdom with a `// @vitest-environment jsdom`
 *   docblock comment at the top of the file. They render Svelte 5 components
 *   with `render` from '@testing-library/svelte' (a `mount`-based renderer).
 *   The `afterEach` cleanup unmounts every rendered component and empties
 *   `<body>`, so tests are isolated and no timers/effects leak between tests.
 *
 * `mockSvelteKitApp()` is NOT applied globally: call it at the top of a
 * component test module when the component (or its imports) touches `$app`
 * modules. Mocks are registered with `vi.doMock` so registration happens
 * only when the helper is called — a plain `vi.mock` inside this module
 * would be hoisted by Vitest to the top of this setup file and applied to
 * every test run. `vi.doMock` registrations apply to modules imported after
 * the call, so call the helper before anything pulls in `$app/*`.
 */
afterEach(async () => {
  // The static `@testing-library/svelte` import would load a testing-library
  // module graph into every worker, including the pure-node ones that never
  // render. It is only needed when a DOM exists, so pull it in lazily.
  if (typeof globalThis.document !== 'undefined') {
    const { cleanup } = await import('@testing-library/svelte');
    cleanup();
  }
});

/**
 * Stable `$app/*` mock objects. Defined once per test-file module graph so
 * every test in the file observes the same identities.
 */
const svelteKitMocks = vi.hoisted(() => {
  const environment = { browser: true, dev: false, building: false, version: '0.0.1' };
  const paths = {
    base: '',
    assets: '',
    appDir: '',
    resolve: (path: string) => path,
  };
  const navigation = {
    goto: vi.fn(() => Promise.resolve()),
    replaceState: vi.fn(),
    pushState: vi.fn(),
    invalidate: vi.fn(() => Promise.resolve()),
    invalidateAll: vi.fn(() => Promise.resolve()),
    preloadData: vi.fn(() => Promise.resolve()),
    preloadCode: vi.fn(() => Promise.resolve()),
  };
  const state = {
    page: {
      route: { id: null },
      url: new URL('http://localhost/'),
      params: {},
      form: null,
      state: null,
    },
    navigating: null,
  };
  return { environment, paths, navigation, state };
});

/**
 * Mock the SvelteKit runtime modules so components under test never hit the
 * real client environment. Components rarely need these, but the app imports
 * them widely, so registering the mocks keeps render() side-effect free.
 *
 * Call this at the top of a component test module (before the first test)
 * when the component under test imports `$app/*`.
 */
export function mockSvelteKitApp(): void {
  vi.doMock('$app/environment', () => svelteKitMocks.environment);
  vi.doMock('$app/paths', () => svelteKitMocks.paths);
  vi.doMock('$app/navigation', () => svelteKitMocks.navigation);
  vi.doMock('$app/state', () => svelteKitMocks.state);
}
