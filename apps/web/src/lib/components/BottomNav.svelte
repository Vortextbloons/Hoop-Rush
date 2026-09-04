<script lang="ts">import { resolve } from '$app/paths';
import { page } from '$app/state';
import type { RouteId } from '$app/types';
import { isNavItemActive, type NavItem } from '$lib/nav-items';
export type { NavItem } from '$lib/nav-items';
export type BottomNavItem = NavItem;
let { items, label = 'Main navigation', onNavigate, }: {
    items: NavItem[];
    label?: string;
    onNavigate?: (itemId: string) => void;
} = $props();
const routeId = $derived(page.route.id);
function intent(itemId: string): void {
    onNavigate?.(itemId);
}
</script>

<nav
  aria-label={label}
  class="fixed inset-x-0 bottom-0 z-40 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
>
  <div
    class="flex w-full items-stretch gap-0.5 border-t border-border bg-background/90 p-1 shadow-2xl shadow-black/30 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:rounded-none"
  >
    {#each items as item (item.id)}
      {@const active = isNavItemActive(item, routeId)}
      {#if item.href !== null}
        <a
          href={resolve(item.href as any)}
          aria-current={active ? 'page' : undefined}
          onpointerenter={() => intent(item.id)}
          onfocus={() => intent(item.id)}
          ontouchstart={() => intent(item.id)}
          class="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {active
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
        >
          <span aria-hidden="true" class="contents">
            <item.icon class="h-5 w-5 shrink-0" />
          </span>
          <span class="max-w-full truncate">{item.label}</span>
        </a>
      {/if}
    {/each}
  </div>
</nav>
