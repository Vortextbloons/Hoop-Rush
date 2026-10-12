<script lang="ts">
  import { resolve } from '$app/paths';

  let { current }: { current: 'collection' | 'packs' | 'team' | 'play' } = $props();

  const LINKS = [
    { id: 'hub', label: 'Hub', href: '/ultimate/run' },
    { id: 'collection', label: 'Collection', href: '/ultimate/run/collection' },
    { id: 'packs', label: 'Packs', href: '/ultimate/run/packs' },
    { id: 'team', label: 'Team', href: '/ultimate/run/team' },
    { id: 'play', label: 'Play', href: '/ultimate/run/play' },
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
