<script lang="ts">
  import type { SeasonLeaderCategory, SeasonLeaderEntry } from '@hoop-rush/data-contracts';
  import { LEADER_CATEGORY_LABELS } from '$lib/season/season-presentation';

  /**
   * League leaders (spec/2.0/02 leaders, M2.3 hub): one table per category
   * from the frozen leaders schema shape. Identity = playerVersionId; rows
   * join roster names for display.
   */

  let {
    tables,
    playerName,
    franchiseAbbrev,
  }: {
    tables: Record<SeasonLeaderCategory, SeasonLeaderEntry[]>;
    playerName: (playerVersionId: string) => string;
    franchiseAbbrev: (franchiseId: string) => string;
  } = $props();

  const categories: SeasonLeaderCategory[] = [
    'points',
    'rebounds',
    'assists',
    'steals',
    'blocks',
    'threePointersMade',
  ];
</script>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
  {#each categories as category (category)}
    {@const entries = tables[category]}
    <section aria-labelledby={`leaders-${category}-heading`} class="rounded-xl bg-surface-1">
      <h3
        id={`leaders-${category}-heading`}
        class="border-b border-border/70 px-4 py-3 font-display text-sm font-extrabold uppercase tracking-tight"
      >
        {LEADER_CATEGORY_LABELS[category]}
      </h3>
      {#if entries.length === 0}
        <p class="px-4 py-3 text-sm text-muted-foreground">No qualified players yet.</p>
      {:else}
        <ol class="flex flex-col divide-y divide-border/50">
          {#each entries as entry, index (entry.playerVersionId)}
            <li class="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span class="w-5 shrink-0 font-mono text-[10px] font-bold text-muted-foreground">
                {index + 1}
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold">
                  {playerName(entry.playerVersionId)}
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {franchiseAbbrev(entry.franchiseId)} · {entry.gamesPlayed} gp
                </span>
              </span>
              <span class="shrink-0 text-right">
                <span class="block font-display text-base font-extrabold">
                  {Number.isInteger(entry.value) ? String(entry.value) : entry.value.toFixed(1)}
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {entry.perGame.toFixed(1)}/g
                </span>
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/each}
</div>
