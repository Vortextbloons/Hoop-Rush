import { plugin } from 'bun';
import { mock } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { compile, compileModule } from 'svelte/compiler';

function siblingSvelteTs(path: string): string | null {
  if (!path.endsWith('.svelte.js')) return null;
  const candidate = `${path.slice(0, -'.svelte.js'.length)}.svelte.ts`;
  return existsSync(candidate) ? candidate : null;
}

await mock.module('$app/navigation', () => ({
  goto: async () => {},
  beforeNavigate: () => {},
  afterNavigate: () => {},
  onNavigate: () => {},
  invalidate: async () => {},
  invalidateAll: async () => {},
  preloadData: () => Promise.resolve({}),
  preloadCode: async () => {},
  pushState: () => {},
  replaceState: () => {},
  disableScrollHandling: () => {},
}));
await mock.module('$app/paths', () => ({
  resolve: (path: string) => (path.startsWith('/') ? path : `/${path}`),
  base: '',
  assets: '',
  asset: (path: string) => path,
}));
await mock.module('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: null },
    state: {},
    status: 200,
    error: null,
    data: {},
    form: undefined,
  },
  navigating: null,
  updated: { current: false, check: () => Promise.resolve(false) },
}));
await mock.module('$app/environment', () => ({ browser: false, building: false, version: 'test' }));
await mock.module('$app/env', () => ({ browser: false, building: false, version: 'test' }));
await mock.module('./src/workers/draft-duel-game-worker.ts?worker&url', () => ({
  default: '/draft-duel-game-worker.js',
}));
await mock.module('./src/workers/havoc-multiplayer-worker.ts?worker&url', () => ({
  default: '/havoc-multiplayer-worker.js',
}));

plugin({
  name: 'hoop-rush-svelte-test-loader',
  setup(build) {
    build.onResolve({ filter: /\.svelte\.js$/ }, (args) => {
      const mapped = siblingSvelteTs(args.path);
      if (mapped !== null) return { path: mapped };
      return undefined;
    });
    build.onLoad({ filter: /\.svelte\.ts$/, namespace: 'file' }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const javascript = new Bun.Transpiler({ loader: 'ts' }).transformSync(source);
      const { js } = compileModule(javascript, {
        filename: args.path,
        generate: 'server',
        dev: false,
      });
      return { contents: js.code, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte\.js$/, namespace: 'file' }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { js } = compileModule(source, { filename: args.path, generate: 'server', dev: false });
      return { contents: js.code, loader: 'js' };
    });
    build.onLoad({ filter: /\.svelte$/, namespace: 'file' }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { js } = compile(source, {
        filename: args.path,
        generate: 'server',
        dev: false,
      });
      return { contents: js.code, loader: 'js' };
    });
  },
});
