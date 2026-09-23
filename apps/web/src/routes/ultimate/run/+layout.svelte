<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { asset, resolve } from '$app/paths';
  import { page } from '$app/state';
  import { BookOpen, Home, Package, Play, Users } from '@lucide/svelte';
  import ArenaSoundToggle from '$lib/components/ArenaSoundToggle.svelte';
  import {
    UltimateRunShell,
    ULTIMATE_RUN_SHELL_CONTEXT,
  } from '$lib/collection/ultimate-shell.svelte';
  import { isNavItemActive, type NavItem } from '$lib/nav-items';
  import '$lib/collection/ultimate-theme.css';

  let { children } = $props();
  const shell = new UltimateRunShell();
  setContext(ULTIMATE_RUN_SHELL_CONTEXT, shell);

  const items: NavItem[] = [
    { id: 'hub', label: 'Hub', href: '/ultimate/run', icon: Home },
    { id: 'collection', label: 'Collection', href: '/ultimate/run/collection', icon: BookOpen },
    { id: 'packs', label: 'Packs', href: '/ultimate/run/packs', icon: Package },
    { id: 'team', label: 'Team', href: '/ultimate/run/team', icon: Users },
    { id: 'play', label: 'Play', href: '/ultimate/run/play', icon: Play },
  ];

  const routeId = $derived(page.route.id ?? '');
  const activeItem = $derived(items.find((item) => isNavItemActive(item, routeId)) ?? items[0]!);
  const balanceCoins = $derived(shell.snapshot?.balances.Coins.toLocaleString('en-US') ?? '—');
  const balanceExchange = $derived(
    shell.snapshot?.balances.Exchange.toLocaleString('en-US') ?? '—',
  );

  onMount(() => {
    void shell.refresh();
  });
</script>

<svelte:head>
  <title>{activeItem.label} · Ultimate Run · Hoop Rush</title>
  <meta name="theme-color" content="#080b0e" />
</svelte:head>

<div class="ultimate-root min-h-[100svh]">
  <header class="ur-shell-header">
    <div class="ur-masthead">
      <div class="flex min-w-0 items-center gap-3">
        <img
          src={asset('/ultimate/logo.svg')}
          alt=""
          width="44"
          height="44"
          class="ur-mark"
          fetchpriority="high"
          decoding="async"
        />
        <div class="min-w-0">
          <p class="ur-mode-name">Ultimate Run</p>
          <h1 class="ur-page-name">{activeItem.label}</h1>
        </div>
      </div>
      <div class="ur-masthead-actions flex shrink-0 items-center gap-2 sm:gap-3">
        <div class="ur-balance-strip" aria-label="Collection balances">
          <span><strong>{balanceCoins}</strong><small>Coins</small></span>
          <span><strong>{balanceExchange}</strong><small>Exchange</small></span>
          <span class="hidden sm:flex"
            ><strong>{shell.snapshot?.ownedCount.toLocaleString('en-US') ?? '—'}</strong><small
              >Cards</small
            ></span
          >
        </div>
        <ArenaSoundToggle />
        <a class="ur-home-link" href={resolve('/')} aria-label="Return to Hoop Rush home">
          <Home class="h-4 w-4" />
          <span>Home</span>
        </a>
      </div>
    </div>
    <nav aria-label="Ultimate Run" class="ur-desktop-nav">
      {#each items as item (item.id)}
        {@const active = isNavItemActive(item, routeId)}
        <a href={resolve(item.href as any)} aria-current={active ? 'page' : undefined}>
          <item.icon class="h-4 w-4" />
          {item.label}
        </a>
      {/each}
    </nav>
  </header>

  {#if shell.announcement}
    <p class="sr-only" role="status">{shell.announcement}</p>
  {/if}

  <main class="ur-main">
    {@render children()}
  </main>

  <nav aria-label="Ultimate Run" class="ur-mobile-nav">
    {#each items as item (item.id)}
      {@const active = isNavItemActive(item, routeId)}
      <a href={resolve(item.href as any)} aria-current={active ? 'page' : undefined}>
        <item.icon class="h-5 w-5" />
        <span>{item.label}</span>
      </a>
    {/each}
  </nav>
</div>

<style>
  .ur-shell-header {
    position: relative;
    z-index: 5;
    border-bottom: 1px solid var(--ur-line);
    background: color-mix(in srgb, var(--ur-canvas) 94%, transparent);
  }

  .ur-masthead {
    display: flex;
    width: min(100% - 2rem, 82rem);
    min-height: 5.25rem;
    margin-inline: auto;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .ur-mark {
    width: 2.75rem;
    height: 2.75rem;
    flex: none;
  }

  .ur-mode-name {
    color: var(--ur-muted);
    font-family: var(--font-display);
    font-size: 0.77rem;
    letter-spacing: 0.1em;
    line-height: 1;
  }

  .ur-page-name {
    overflow: hidden;
    color: var(--ur-paper);
    font-family: var(--font-display);
    font-size: clamp(1.35rem, 3vw, 1.75rem);
    font-weight: 800;
    line-height: 1.1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ur-balance-strip {
    display: flex;
    align-items: center;
    gap: clamp(0.6rem, 2vw, 1.35rem);
    font-variant-numeric: tabular-nums;
  }

  .ur-balance-strip span {
    display: flex;
    flex-direction: column;
    line-height: 1.05;
  }

  .ur-balance-strip strong {
    color: var(--ur-paper);
    font-size: 0.9rem;
  }

  .ur-balance-strip small {
    margin-top: 0.2rem;
    color: var(--ur-muted);
    font-size: 0.68rem;
  }

  .ur-home-link {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.45rem;
    padding-inline: 0.75rem;
    border: 1px solid var(--ur-line);
    color: var(--ur-paper);
    font-size: 0.8rem;
    font-weight: 700;
  }

  .ur-desktop-nav {
    display: flex;
    width: min(100% - 2rem, 82rem);
    min-height: 3rem;
    margin-inline: auto;
    align-items: stretch;
    gap: 0.25rem;
  }

  .ur-desktop-nav a {
    display: inline-flex;
    min-width: 7rem;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding-inline: 1rem;
    border-bottom: 2px solid transparent;
    color: var(--ur-muted);
    font-size: 0.83rem;
    font-weight: 700;
    outline: none;
  }

  .ur-desktop-nav a:hover,
  .ur-desktop-nav a[aria-current='page'] {
    border-bottom-color: var(--ur-apex);
    color: var(--ur-paper);
  }

  .ur-desktop-nav a[aria-current='page'] {
    background: linear-gradient(
      0deg,
      color-mix(in srgb, var(--ur-apex) 9%, transparent),
      transparent 80%
    );
  }

  .ur-main {
    width: min(100% - 2rem, 82rem);
    min-height: 60vh;
    margin-inline: auto;
    padding-block: clamp(1rem, 3vw, 2.25rem) 3rem;
  }

  .ur-mobile-nav {
    display: none;
  }

  .ur-home-link:focus-visible,
  .ur-desktop-nav a:focus-visible,
  .ur-mobile-nav a:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  @media (max-width: 767px) {
    .ur-masthead {
      width: calc(100% - 1.5rem);
      min-height: 4.5rem;
      flex-wrap: wrap;
      padding-block: 0.5rem;
    }

    .ur-masthead > div:first-child {
      flex: 1 1 100%;
    }

    .ur-masthead-actions {
      width: 100%;
      justify-content: space-between;
    }

    .ur-desktop-nav {
      display: none;
    }

    .ur-main {
      width: calc(100% - 1.5rem);
      padding-bottom: calc(6.75rem + env(safe-area-inset-bottom));
    }

    .ur-home-link {
      width: 2.75rem;
      justify-content: center;
      padding: 0;
    }

    .ur-home-link span {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
    }

    .ur-mobile-nav {
      position: fixed;
      z-index: 50;
      inset: auto 0 0;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      min-height: 4.25rem;
      padding: 0.35rem 0.25rem max(0.35rem, env(safe-area-inset-bottom));
      border-top: 1px solid var(--ur-line);
      background: color-mix(in srgb, var(--ur-canvas) 97%, transparent);
      backdrop-filter: blur(18px);
    }

    .ur-mobile-nav a {
      display: flex;
      min-width: 0;
      min-height: 3.25rem;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      color: var(--ur-muted);
      font-size: 0.68rem;
      font-weight: 700;
      outline: none;
    }

    .ur-mobile-nav a[aria-current='page'] {
      color: var(--ur-apex);
    }
  }

  @media (max-width: 400px) {
    .ur-balance-strip {
      gap: 0.45rem;
    }

    .ur-balance-strip strong {
      font-size: 0.75rem;
    }

    .ur-balance-strip small {
      font-size: 0.62rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-shell-header,
    .ur-mobile-nav {
      scroll-behavior: auto;
    }
  }
</style>
