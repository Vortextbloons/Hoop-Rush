<script lang="ts">
  import type { SeasonTiebreakResolution } from '@hoop-rush/data-contracts';
  import { tiebreakResolutionViewModel } from '$lib/season/season-postseason-presentation';

  /**
   * Tiebreak explanations (M2.6 League tab): every recorded tie resolution
   * from the authoritative engine ranking, grouped by conference and
   * expandable — the collapsed row names the rule, the kind, and the slots
   * it decided; the expanded body lists the teams in decided order with the
   * recorded deciding facts. Scannable, not a spreadsheet.
   */

  let {
    resolutions,
    franchiseName,
    conference = null,
  }: {
    resolutions: readonly SeasonTiebreakResolution[];
    franchiseName: (franchiseId: string) => string;
    conference?: 'east' | 'west' | null;
  } = $props();

  const groups = $derived.by(() => {
    const east = resolutions.filter((resolution) => resolution.conference === 'east');
    const west = resolutions.filter((resolution) => resolution.conference === 'west');
    const sections: Array<{
      conference: 'east' | 'west';
      entries: ReturnType<typeof tiebreakResolutionViewModel>[];
    }> = [];
    if (conference === null || conference === 'east') {
      sections.push({
        conference: 'east',
        entries: east.map((resolution) => tiebreakResolutionViewModel(resolution, franchiseName)),
      });
    }
    if (conference === null || conference === 'west') {
      sections.push({
        conference: 'west',
        entries: west.map((resolution) => tiebreakResolutionViewModel(resolution, franchiseName)),
      });
    }
    return sections;
  });

  const total = $derived(resolutions.length);
</script>

<section
  aria-labelledby="tiebreak-heading"
  data-season-tiebreak-explanations
  class="rounded-xl border border-border bg-surface-1 p-4"
>
  <div class="flex flex-wrap items-baseline justify-between gap-2">
    <h2
      id="tiebreak-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Tiebreak explanations
    </h2>
    <span class="font-mono text-[10px] text-muted-foreground">
      {total} recorded resolution{total === 1 ? '' : 's'} · official NBA sequence
    </span>
  </div>

  {#if total === 0}
    <p class="mt-2 text-sm text-muted-foreground">
      No tied slots in the current standings — the ranking is decided outright.
    </p>
  {:else}
    <div class="mt-3 flex flex-col gap-4">
      {#each groups as group (group.conference)}
        {#if group.entries.length > 0}
          <section aria-labelledby={`tiebreak-${group.conference}-heading`}>
            <h3
              id={`tiebreak-${group.conference}-heading`}
              class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {group.conference === 'east' ? 'East' : 'West'}
            </h3>
            <ul class="mt-1.5 flex flex-col gap-1.5">
              {#each group.entries as entry (entry.resolution.resolutionId)}
                <li>
                  <details
                    class="group rounded-lg border border-border/60 bg-surface-2"
                    data-season-tiebreak-resolution={entry.resolution.resolutionId}
                  >
                    <summary
                      class="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                    >
                      <span
                        class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
                      >
                        {entry.ruleLabel}
                      </span>
                      <span class="font-mono text-[10px] text-muted-foreground">
                        {entry.kindLabel} · {entry.slotsLabel}
                      </span>
                      <span
                        class="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground"
                      >
                        {entry.teamLabels.join(' > ')}
                      </span>
                    </summary>
                    <div class="border-t border-border/50 px-3 py-2">
                      <p class="text-sm">
                        <strong class="text-foreground">{entry.ruleLabel}</strong>
                        decided {entry.kindLabel.toLowerCase()} for
                        <span class="font-semibold"> {entry.slotsLabel}</span>. Teams in decided
                        order:
                      </p>
                      <ol class="mt-1 flex flex-col gap-0.5">
                        {#each entry.teamLabels as team (team)}
                          <li class="text-sm">
                            <span class="font-mono text-[10px] text-muted-foreground">
                              {String(entry.teamLabels.indexOf(team) + 1)}.
                            </span>
                            <span class="font-semibold">{team}</span>
                          </li>
                        {/each}
                      </ol>
                      {#if entry.resolution.evidence.length > 0}
                        <dl class="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-0.5">
                          {#each entry.resolution.evidence as item (item.label)}
                            <dt class="font-mono text-[10px] text-muted-foreground">
                              {item.label}
                            </dt>
                            <dd class="font-mono text-[10px] font-bold">{String(item.value)}</dd>
                          {/each}
                        </dl>
                      {/if}
                      {#if entry.resolution.drawSeed !== null}
                        <p class="mt-2 font-mono text-[10px] text-muted-foreground">
                          Decided by saved draw seed {entry.resolution.drawSeed}
                        </p>
                      {/if}
                    </div>
                  </details>
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      {/each}
    </div>
    <p class="mt-3 font-mono text-[10px] text-muted-foreground">
      The published NBA sequence decides ties in order; earlier rules win. Explanations come from
      the recorded resolution trace, never from invented numbers.
    </p>
  {/if}
</section>
