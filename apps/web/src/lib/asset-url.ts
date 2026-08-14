import { resolve } from '$app/paths';

export function siteRoot(): string {
  return resolve('/');
}

export function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/')) return url;
  return `${siteRoot()}data/${url}`;
}

const memoCache = new Map<string, Promise<unknown>>();

export function memoized<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = memoCache.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const promise = load();
  memoCache.set(key, promise);
  promise.catch(() => memoCache.delete(key));
  return promise;
}

export function clearMemoizedLoaders(): void {
  memoCache.clear();
}
