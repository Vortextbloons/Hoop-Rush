import { asset, resolve } from '$app/paths';
import type { AssetPath } from '$app/types';

function siteRoot(): string {
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
