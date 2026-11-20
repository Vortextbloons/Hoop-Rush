<script lang="ts">
  import { Search } from '@lucide/svelte';
  import { SLOT_LABELS } from '#lib/player-positions.js';

  let {
    search,
    position,
    onsearch,
    onposition,
  }: {
    search: string;
    position: number | null;
    onsearch: (value: string) => void;
    onposition: (value: number | null) => void;
  } = $props();
</script>

<div class="flex min-w-0 flex-col gap-2">
  <div class="relative min-w-0">
    <Search
      class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
    <input
      type="search"
      value={search}
      oninput={(event) => onsearch(event.currentTarget.value)}
      placeholder="Search players…"
      aria-label="Search players by name"
      class="h-10 w-full rounded-lg bg-surface-2 pr-3 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
    />
  </div>
  <div
    class="flex min-w-0 items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    role="group"
    aria-label="Filter by position"
  >
    <button
      type="button"
      aria-pressed={position === null}
      onclick={() => onposition(null)}
      class="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {position ===
      null
        ? 'bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
    >
      All
    </button>
    {#each SLOT_LABELS as label, index (label)}
      <button
        type="button"
        aria-pressed={position === index}
        onclick={() => onposition(position === index ? null : index)}
        class="shrink-0 rounded-md px-2.5 py-1 text-xs font-bold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {position ===
        index
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'}"
      >
        {label}
      </button>
    {/each}
  </div>
</div>
