import { plugin } from 'bun';
import { readFile, stat } from 'node:fs/promises';
import { compile, compileModule } from 'svelte/compiler';

const SVELTE_APP_NAMESPACE = 'hoop-rush-sveltekit-app-stub';

async function siblingSvelteTs(path: string): Promise<string | null> {
  if (!path.endsWith('.svelte.js')) return null;
  const candidate = `${path.slice(0, -'.svelte.js'.length)}.svelte.ts`;
  try {
    await stat(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function appStubContents(specifier: string): string {
  if (specifier === '$app/navigation') {
    return [
      'export const goto = async () => {};',
      'export const beforeNavigate = () => {};',
      'export const afterNavigate = () => {};',
      'export const onNavigate = () => {};',
      'export const invalidate = async () => {};',
      'export const invalidateAll = async () => {};',
      'export const preloadData = async () => ({});',
      'export const preloadCode = async () => {};',
      'export const pushState = () => {};',
      'export const replaceState = () => {};',
      'export const disableScrollHandling = () => {};',
    ].join('\n');
  }
  if (specifier === '$app/paths') {
    return [
      'export const resolve = (path) => (path.startsWith("/") ? path : `/${path}`);',
      'export const base = "";',
      'export const assets = "";',
      'export const asset = (path) => path;',
    ].join('\n');
  }
  if (specifier === '$app/state') {
    return [
      'export const page = { url: new URL("http://localhost/"), params: {}, route: { id: null }, state: {}, status: 200, error: null, data: {}, form: undefined };',
      'export const navigating = null;',
      'export const updated = { current: false, check: async () => false };',
    ].join('\n');
  }
  if (specifier === '$app/environment' || specifier === '$app/env') {
    return [
      'export const browser = false;',
      'export const building = false;',
      'export const version = "test";',
    ].join('\n');
  }
  return 'export {};';
}

plugin({
  name: 'hoop-rush-svelte-test-loader',
  setup(build) {
    build.onResolve({ filter: /\.svelte\.js$/ }, async (args) => {
      const mapped = await siblingSvelteTs(args.path);
      if (mapped !== null) return { path: mapped };
      return undefined;
    });
    build.onResolve({ filter: /^\$app\// }, (args) => ({
      namespace: SVELTE_APP_NAMESPACE,
      path: args.path,
    }));
    build.onLoad({ filter: /\.svelte\.ts$/, namespace: 'file' }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const { js } = compileModule(source, {
        filename: args.path,
        generate: 'server',
        dev: false,
      });
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
    build.onLoad({ filter: /.*/, namespace: SVELTE_APP_NAMESPACE }, (args) => ({
      contents: appStubContents(args.path),
      loader: 'js',
    }));
  },
});
