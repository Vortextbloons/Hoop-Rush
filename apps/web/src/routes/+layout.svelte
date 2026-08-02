<script lang="ts">
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { Home } from '@lucide/svelte';
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';
  import BottomNav, { type BottomNavItem } from '$lib/components/BottomNav.svelte';

  let { children } = $props();

  const homeHref = resolve('/');

  // Route IDs (not resolved paths): BottomNav resolves them at render time,
  // which keeps relative-base static builds correct.
  const navItems: BottomNavItem[] = [{ id: 'home', label: 'Home', href: '/', icon: Home }];

  const pathname = $derived(page.url.pathname);
  const showBottomNav = $derived(pathname === '/');
</script>

<svelte:head>
  <meta name="color-scheme" content="dark light" />
  <title>Hoop Rush — make yours never</title>
</svelte:head>

<ModeWatcher />

<header class="border-b border-border/70">
  <div class="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
    <a
      href={homeHref}
      class="flex items-center gap-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <img
        src="/app-icon-512.png"
        alt=""
        class="h-9 w-9 rounded-lg object-contain"
        width="36"
        height="36"
      />
      <span class="font-display text-2xl font-extrabold tracking-tight">
        Hoop <span class="text-primary">Rush</span>
      </span>
    </a>
  </div>
</header>

<main>
  {@render children()}
</main>

{#if showBottomNav}
  <BottomNav items={navItems} />
{/if}

<Toaster richColors closeButton theme="system" />
