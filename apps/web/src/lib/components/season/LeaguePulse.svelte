<script lang="ts">
  import type { LeaguePulseEntry } from '$lib/season/season-presentation';
  let { entries }: { entries: LeaguePulseEntry[] } = $props();
  const kindLabel: Record<LeaguePulseEntry['kind'], string> = {
    threat: 'Threat',
    streak: 'Streak',
    trade: 'Trade',
    signing: 'Signing',
    rehab: 'Gamble',
    innovation: 'Scheme',
  };
</script>

<section
  aria-labelledby="league-pulse-heading"
  data-testid="league-pulse"
  class="flex flex-col gap-2 rounded-xl border border-border bg-card p-4"
>
  <h2 id="league-pulse-heading" class="text-base font-extrabold uppercase tracking-tight">
    League pulse
  </h2>
  {#if entries.length === 0}
    <p class="text-xs text-muted-foreground">Play a block and rivals will show up here.</p>
  {:else}
    <ul class="flex flex-col gap-2">
      {#each entries as entry (entry.kind + entry.headline)}
        <li class="flex items-start gap-2 text-xs">
          <span
            class="mt-0.5 shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
          >
            {kindLabel[entry.kind]}
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">{entry.headline}</span>
            <span class="block text-muted-foreground">{entry.detail}</span>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>
