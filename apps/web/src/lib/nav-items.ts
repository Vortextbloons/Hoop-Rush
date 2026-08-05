import type { Component } from 'svelte';

/**
 * Shared bottom-navigation item model (M2.3.5). Routes are referenced by
 * route id (not resolved paths) so relative-base static builds stay correct;
 * consumers call `resolve()` at render time.
 */
export type NavItem = {
  id: string;
  label: string;
  href: string | null;
  icon: Component<{ class?: string }>;
};

export function isNavItemActive(item: NavItem, routeId: string | null): boolean {
  if (item.href === null || routeId === null) return false;
  if (item.href === '/') return routeId === '/';
  return routeId === item.href || routeId.startsWith(`${item.href}/`);
}
