<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { RouteId } from '$app/types';
  import { isNavItemActive, type NavItem } from '$lib/nav-items';

  export type { NavItem } from '$lib/nav-items';

  /** Backward-compatible alias used by the root layout's nav wiring. */
  export type BottomNavItem = NavItem;

  /**
   * Shared fixed bottom navigation. Accessible label and an optional intent
   * callback (used to warm caches on hover/focus) are caller-provided; there
   * is no hardcoded route behavior.
   */
  let {
    items,
    label = 'Main navigation',
    onNavigate,
  }: {
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
  class="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
>
  <div
    class="flex items-center gap-1 rounded-2xl border border-border bg-background/90 p-1.5 shadow-2xl shadow-black/30 backdrop-blur supports-[backdrop-filter]:bg-background/80"
  >
    {#each items as item (item.id)}
      {@const active = isNavItemActive(item, routeId)}
      {#if item.href === null}
        <span
          aria-disabled="true"
          title="Coming soon"
          class="inline-flex cursor-default items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-muted-foreground/60"
        >
          <item.icon class="h-4 w-4 shrink-0" />
          {item.label}
        </span>
      {:else}
        <a
          href={resolve(item.href as RouteId)}
          aria-current={active ? 'page' : undefined}
          onpointerenter={() => intent(item.id)}
          onfocus={() => intent(item.id)}
          ontouchstart={() => intent(item.id)}
          class="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {active
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
        >
          <item.icon class="h-4 w-4 shrink-0" />
          {item.label}
        </a>
      {/if}
    {/each}
  </div>
</nav>
