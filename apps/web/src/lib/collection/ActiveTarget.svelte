<script lang="ts">
  import { resolve } from '$app/paths';

  let {
    playerName,
    summaryLine,
    blurb = 'Every version of this player keeps its rarity odds; targeting never raises a rarity chance and never expires.',
    busy = false,
    onChange,
    onClear,
  }: {
    playerName: string;
    summaryLine: string;
    blurb?: string;
    busy?: boolean;
    onChange?: () => void;
    onClear: () => void;
  } = $props();
</script>

<section
  aria-label="Active target player"
  aria-busy={busy}
  class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"
>
  <div class="min-w-0">
    <p class="ultimate-eyebrow">Active target</p>
    <p class="truncate font-display text-lg font-extrabold">{playerName}</p>
    <p class="text-xs text-muted-foreground">{summaryLine}</p>
    <p class="mt-1 text-xs text-muted-foreground">{blurb}</p>
  </div>
  <div class="flex flex-wrap items-center gap-2">
    {#if onChange}
      <button
        type="button"
        onclick={onChange}
        disabled={busy}
        class="min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Change target
      </button>
    {:else}
      <a
        href={resolve('/ultimate/run/collection' as any)}
        class="inline-flex min-h-11 items-center rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Change target
      </a>
    {/if}
    <button
      type="button"
      onclick={onClear}
      disabled={busy}
      class="min-h-11 rounded-xl bg-surface-2 px-4 py-2 text-sm font-semibold outline-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      Clear target
    </button>
  </div>
</section>
