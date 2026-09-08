<script lang="ts">
  import { resolve } from '$app/paths';

  let { current }: { current: 'collection' | 'packs' | 'team' | 'play' } = $props();

  const LINKS = [
    { id: 'collection', label: 'Collection', href: '/collection' },
    { id: 'packs', label: 'Packs', href: '/collection/packs' },
    { id: 'team', label: 'Team', href: '/collection/team' },
    { id: 'play', label: 'Play', href: '/collection/play' },
  ] as const;
</script>

<nav aria-label="Ultimate Run" class="flex flex-wrap items-center gap-2">
  {#each LINKS as link (link.id)}
    {#if link.id === current}
      <span
        aria-current="page"
        class="rounded-xl bg-accent px-4 py-2 text-sm font-bold text-accent-foreground"
      >
        {link.label}
      </span>
    {:else}
      <a
        href={resolve(link.href)}
        class="rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {link.label}
      </a>
    {/if}
  {/each}
</nav>
