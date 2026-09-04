<script lang="ts">import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { page } from '$app/state';
import type { RouteId } from '$app/types';
import { Home, Users, Swords } from '@lucide/svelte';
import '../app.css';
import { ModeWatcher } from 'mode-watcher';
import { Toaster } from 'svelte-sonner';
import BottomNav from '$lib/components/BottomNav.svelte';
import { isNavItemActive, type NavItem } from '$lib/nav-items';
import { warmManifest, warmPlayersIndex } from '$lib/data';
let { children } = $props();
const homeHref = resolve('/');
const navItems: NavItem[] = [
    { id: 'home', label: 'Home', href: '/', icon: Home },
    { id: 'roster', label: 'Roster', href: '/roster', icon: Users },
    { id: 'multiplayer', label: 'Multiplayer', href: '/multiplayer', icon: Swords },
];
const routeId = $derived(page.route.id);
const isMultiplayerLobby = $derived(routeId === '/multiplayer');
const showBottomNav = $derived(routeId === '/' || routeId === '/roster' || routeId === '/multiplayer');
$effect(() => {
    if (!browser || isMultiplayerLobby)
        return;
    warmManifest();
});
function isActive(item: NavItem): boolean {
    return isNavItemActive(item, routeId);
}
function warmForRoster(itemId: string): void {
    if (itemId === 'roster')
        warmPlayersIndex();
}
</script>

<svelte:head>
  <meta name="color-scheme" content="dark light" />
  <title>Hoop Rush — make yours never</title>
</svelte:head>

<ModeWatcher />

<header class="border-b border-border/70">
  <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-3 sm:px-6">
    <a
      href={homeHref}
      class="flex items-center gap-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src={asset('/app-icon-96.png')}
        alt=""
        class="h-9 w-9 rounded-lg object-contain"
        width="36"
        height="36"
        fetchpriority="high"
        decoding="async"
      />
      <span class="font-display text-2xl font-extrabold tracking-tight">
        Hoop <span class="text-primary">Rush</span>
      </span>
    </a>
    {#if showBottomNav}
      <nav aria-label="Main navigation" class="hidden items-center gap-1 md:flex">
        {#each navItems as item (item.id)}
          {@const active = isActive(item)}
          <a
            href={resolve(item.href as any)}
            aria-current={active ? 'page' : undefined}
            onpointerenter={() => warmForRoster(item.id)}
            onfocus={() => warmForRoster(item.id)}
            class="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring {active
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
          >
            <item.icon class="h-4 w-4 shrink-0" />
            {item.label}
          </a>
        {/each}
      </nav>
    {/if}
  </div>
</header>

<main class="min-w-0 overflow-x-clip">
  {@render children()}
</main>

{#if showBottomNav}
  <BottomNav items={navItems} label="Main navigation" onNavigate={warmForRoster} />
{/if}

<Toaster richColors closeButton theme="system" />
