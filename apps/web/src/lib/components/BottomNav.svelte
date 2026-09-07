<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { RouteId } from '$app/types';
  import { isNavItemActive, type NavItem } from '$lib/nav-items';
  import { MoreHorizontal, X } from '@lucide/svelte';
  export type { NavItem } from '$lib/nav-items';
  export type BottomNavItem = NavItem;
  let {
    items,
    overflowItems = [],
    label = 'Main navigation',
    onNavigate,
  }: {
    items: NavItem[];
    overflowItems?: NavItem[];
    label?: string;
    onNavigate?: (itemId: string) => void;
  } = $props();
  const routeId = $derived(page.route.id);
  let overflowOpen = $state(false);
  const overflowActive = $derived(overflowItems.some((item) => isNavItemActive(item, routeId)));
  function intent(itemId: string): void {
    onNavigate?.(itemId);
  }
  function closeOverflow(): void {
    overflowOpen = false;
  }
</script>

<nav
  aria-label={label}
  class="fixed inset-x-0 bottom-0 z-40 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden"
>
  <div
    class="relative flex w-full items-stretch gap-0.5 border-t border-border bg-background/90 p-1 shadow-2xl shadow-black/30 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:rounded-none"
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
    {#if overflowItems.length > 0}
      <button
        type="button"
        aria-expanded={overflowOpen}
        aria-controls="bottom-nav-overflow"
        class="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-semibold leading-none outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {overflowActive
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
        onclick={() => (overflowOpen = !overflowOpen)}
      >
        <span aria-hidden="true" class="contents">
          {#if overflowOpen}
            <X class="h-5 w-5 shrink-0" />
          {:else}
            <MoreHorizontal class="h-5 w-5 shrink-0" />
          {/if}
        </span>
        <span class="max-w-full truncate">More</span>
      </button>
    {/if}
    {#if overflowOpen}
      <div
        id="bottom-nav-overflow"
        class="absolute right-1 bottom-full left-1 mb-2 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card/95 p-2 shadow-2xl shadow-black/40 backdrop-blur"
      >
        {#each overflowItems as item (item.id)}
          {@const active = isNavItemActive(item, routeId)}
          {#if item.href !== null}
            <a
              href={resolve(item.href as any)}
              aria-current={active ? 'page' : undefined}
              onclick={closeOverflow}
              onpointerenter={() => intent(item.id)}
              onfocus={() => intent(item.id)}
              class="flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
            >
              <item.icon class="h-4 w-4 shrink-0" />
              <span class="truncate">{item.label}</span>
            </a>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</nav>
