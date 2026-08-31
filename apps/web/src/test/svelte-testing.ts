import { afterEach, vi } from 'vitest';
afterEach(async () => {
  if (typeof globalThis.document !== 'undefined') {
    const { cleanup } = await import('@testing-library/svelte');
    cleanup();
  }
});
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
export function mockSvelteKitApp(): void {
  vi.doMock('$app/environment', () => svelteKitMocks.environment);
  vi.doMock('$app/paths', () => svelteKitMocks.paths);
  vi.doMock('$app/navigation', () => svelteKitMocks.navigation);
  vi.doMock('$app/state', () => svelteKitMocks.state);
}
