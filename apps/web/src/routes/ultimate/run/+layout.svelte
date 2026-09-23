<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import { asset, resolve } from '$app/paths';
  import { page } from '$app/state';
  import {
    ArrowLeftRight,
    BookOpen,
    Coins,
    Home,
    Layers,
    Package,
    Play,
    Users,
  } from '@lucide/svelte';
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
  const ownedCount = $derived(shell.snapshot?.ownedCount.toLocaleString('en-US') ?? '—');

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
    <div class="ur-topbar">
      <a class="ur-brand" href={resolve('/ultimate/run')} aria-label="Ultimate Run hub">
        <img
          src={asset('/ultimate/logo.svg')}
          alt=""
          width="32"
          height="32"
          class="ur-mark"
          fetchpriority="high"
          decoding="async"
        />
        <span class="ur-brand-name">Ultimate Run</span>
      </a>
      <nav aria-label="Ultimate Run" class="ur-desktop-nav ur-nav-pills">
        {#each items as item (item.id)}
          {@const active = isNavItemActive(item, routeId)}
          <a href={resolve(item.href as any)} aria-current={active ? 'page' : undefined}>
            <item.icon class="h-4 w-4" />
            {item.label}
          </a>
        {/each}
      </nav>
      <div class="ur-top-actions">
        <div class="ur-balance-strip" aria-label="Collection balances">
          <span class="ur-currency-pill is-coins">
            <Coins aria-hidden="true" />
            {balanceCoins} Coins
          </span>
          <span class="ur-currency-pill is-exchange">
            <ArrowLeftRight aria-hidden="true" />
            {balanceExchange} Exchange
          </span>
          <span class="ur-currency-pill is-cards">
            <Layers aria-hidden="true" />
            {ownedCount} Cards
          </span>
        </div>
        <ArenaSoundToggle className="ur-sound-pill" />
        <a class="ur-home-pill" href={resolve('/')} aria-label="Return to Hoop Rush home">
          <Home class="h-4 w-4" aria-hidden="true" />
          <span>Home</span>
        </a>
      </div>
    </div>
    <h1 class="sr-only">{activeItem.label} · Ultimate Run</h1>
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
    border-bottom: 1px solid rgb(255 197 61 / 30%);
    background: #000;
  }

  .ur-shell-header::after {
    position: absolute;
    inset: auto 0 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      rgb(255 197 61 / 70%) 25%,
      var(--ur-gold) 50%,
      rgb(255 197 61 / 70%) 75%,
      transparent
    );
    content: '';
    pointer-events: none;
  }

  .ur-topbar {
    display: flex;
    width: min(100% - 2rem, 82rem);
    min-height: 4.25rem;
    margin-inline: auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1rem;
    padding-block: 0.55rem;
  }

  .ur-brand {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    text-decoration: none;
  }

  .ur-mark {
    width: 2rem;
    height: 2rem;
    flex: none;
    filter: drop-shadow(0 0 0.6rem rgb(255 197 61 / 35%));
  }

  .ur-brand-name {
    color: #fff;
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 800;
    letter-spacing: 0.01em;
    line-height: 1;
    white-space: nowrap;
  }

  .ur-desktop-nav {
    order: 2;
  }

  .ur-desktop-nav a {
    outline: none;
  }

  .ur-top-actions {
    display: flex;
    flex: none;
    align-items: center;
    gap: 0.5rem;
    order: 3;
  }

  .ur-balance-strip {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-variant-numeric: tabular-nums;
  }

  .ur-balance-strip .ur-currency-pill :global(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }

  .ur-top-actions :global(.ur-sound-pill) {
    min-width: 0 !important;
    padding: 0.35rem 0.7rem !important;
    border: 1px solid rgb(255 197 61 / 35%) !important;
    border-radius: 999px !important;
    background: #0d1216 !important;
    color: var(--ur-paper) !important;
    font-size: 0.75rem !important;
    letter-spacing: 0.04em !important;
  }

  .ur-home-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid rgb(255 197 61 / 35%);
    border-radius: 999px;
    background: #0d1216;
    color: var(--ur-paper);
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1.2;
    text-decoration: none;
    white-space: nowrap;
    outline: none;
  }

  .ur-home-pill:hover {
    border-color: rgb(255 197 61 / 60%);
    color: #fff;
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

  .ur-brand:focus-visible,
  .ur-home-pill:focus-visible,
  .ur-desktop-nav a:focus-visible,
  .ur-mobile-nav a:focus-visible {
    outline: 3px solid var(--ur-focus);
    outline-offset: 2px;
  }

  @media (max-width: 1100px) {
    .ur-topbar {
      row-gap: 0.6rem;
    }

    .ur-desktop-nav {
      flex-basis: 100%;
      order: 3;
      overflow-x: auto;
      justify-content: flex-start;
      scrollbar-width: thin;
    }

    .ur-top-actions {
      order: 2;
      margin-left: auto;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
  }

  @media (max-width: 767px) {
    .ur-topbar {
      width: calc(100% - 1.5rem);
    }

    .ur-desktop-nav {
      display: none;
    }

    .ur-top-actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-start;
    }

    .ur-balance-strip {
      flex-wrap: wrap;
    }

    .ur-main {
      width: calc(100% - 1.5rem);
      padding-bottom: calc(6.75rem + env(safe-area-inset-bottom));
    }

    .ur-home-pill {
      padding: 0.35rem 0.55rem;
    }

    .ur-home-pill span {
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
      border-top: 1px solid rgb(255 197 61 / 30%);
      background: #0b0e11;
    }

    .ur-mobile-nav a {
      display: flex;
      min-width: 0;
      min-height: 3.25rem;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      border-radius: 0.6rem;
      color: var(--ur-muted);
      font-size: 0.68rem;
      font-weight: 700;
      text-decoration: none;
      outline: none;
    }

    .ur-mobile-nav a[aria-current='page'] {
      background: linear-gradient(180deg, #ffda73, var(--ur-gold));
      color: #241a02;
      box-shadow: 0 2px 14px rgb(255 197 61 / 35%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .ur-shell-header,
    .ur-mobile-nav {
      scroll-behavior: auto;
    }
  }
</style>
