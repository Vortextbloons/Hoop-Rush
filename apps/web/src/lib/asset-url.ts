import { asset, resolve } from '$app/paths';
import type { AssetPath } from '$app/types';

export function siteRoot(): string {
  return resolve('/');
}

export function staticAsset(url: string): string {
  return asset(url.replace(/^\//, '') as AssetPath);
}

export function resolveAssetUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/')) return staticAsset(url);
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
