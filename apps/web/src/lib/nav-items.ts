import type { Component } from 'svelte';
export type NavItem = {
  id: string;
  label: string;
  href: string | null;
  icon: Component<{
    class?: string;
  }>;
};
const ACTIVE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  '/season/run': ['/season/run/checkpoint'],
  '/season/run/league': ['/season/run/teams'],
};
function normalizeRouteId(routeId: string): string {
  return routeId.length > 1 && routeId.endsWith('/') ? routeId.slice(0, -1) : routeId;
}
export function isNavItemActive(item: NavItem, routeId: string | null): boolean {
  if (item.href === null || routeId === null) return false;
  const current = normalizeRouteId(routeId);
  const href = normalizeRouteId(item.href);
  if (href === '/') return current === '/';
  if (current === href) return true;
  for (const alias of ACTIVE_ALIASES[href] ?? []) {
    const normalizedAlias = normalizeRouteId(alias);
    if (current === normalizedAlias || current.startsWith(`${normalizedAlias}/`)) return true;
  }
  return false;
}
