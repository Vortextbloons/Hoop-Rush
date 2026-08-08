import { resolve } from '$app/paths';

/**
 * Shared packaged-asset URL resolution and memoization for the data loaders
 * (classic/sandbox `data.ts` and Season `season-assets.ts`). URLs are
 * relative to the packaged `data/` directory under the site root (GitHub
 * Pages base path aware); memoized loads share one in-flight promise per key
 * and evict on failure so a later request retries.
 */

/** Absolute site root for packaged JSON assets (respects GitHub Pages base path). */
export function siteRoot(): string {
  return resolve('/');
}

/** Pool URLs are relative to the manifest directory (e.g. pools/lakers-1990s.json). */
export function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${siteRoot()}data/${url}`;
}

const memoCache = new Map<string, Promise<unknown>>();

/** Runs `load` once per key, sharing the in-flight promise and retrying after failure. */
export function memoized<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = memoCache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = load();
  memoCache.set(key, promise);
  promise.catch(() => memoCache.delete(key));
  return promise;
}

/** @internal Clears the shared memoized-loader cache between unit tests. */
export function clearMemoizedLoaders(): void {
  memoCache.clear();
}
