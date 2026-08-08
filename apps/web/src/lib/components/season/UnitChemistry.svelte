<script lang="ts">
  import type { SeasonEffectsState, SeasonRoster } from '@hoop-rush/data-contracts';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import {
    activeLineupChemistryBp,
    strongestAndWeakestPairs,
  } from '$lib/season/season-effects-view';

  /**
   * Season Run unit-chemistry panel (M2.4): the active-lineup chemistry
   * derived from the recorded pair states, plus the strongest and weakest
   * shared-play pairs of the ten-player roster. Shared possessions are
   * recorded evidence from completed trips, never a prediction.
   */

  let {
    roster,
    effects,
    shell,
  }: {
    roster: SeasonRoster;
    effects: SeasonEffectsState | null;
    shell: SeasonRunShellData;
  } = $props();

  const rosterVersions = $derived(roster.players.map((entry) => entry.playerVersionId));

  const pendingUnit = $derived(shell.editor?.rows() ?? []);
  const pendingStarters = $derived(
    pendingUnit
      .filter((row) => row.role.startsWith('Starter'))
      .map((row) => row.member.playerVersionId),
  );
  const pendingStartersFive = $derived(
    pendingStarters.length === 5 ? pendingStarters : rosterVersions.slice(0, 5),
  );

  const lineupChemistry = $derived(
    effects === null ? null : activeLineupChemistryBp(effects, pendingStartersFive),
  );

  const pairs = $derived(
    effects === null ? null : strongestAndWeakestPairs(effects, rosterVersions),
  );

  function nameOf(playerVersionId: string): string {
    const entry = roster.players.find((p) => p.playerVersionId === playerVersionId);
    return entry?.displayName ?? playerVersionId;
  }
</script>

{#if effects !== null}
  <section aria-labelledby="chemistry-heading" class="bg-surface-1 p-4 sm:rounded-xl">
    <p id="chemistry-heading" class="text-label uppercase text-muted-foreground">Unit chemistry</p>
    <p class="mt-1 font-mono text-xs text-foreground">
      Active lineup <span class="font-bold">
        {lineupChemistry === null ? '—' : `${(lineupChemistry / 100).toFixed(0)}%`}
      </span>
      {#if pendingStarters.length !== 5}
        <span class="text-muted-foreground"> · pending starters</span>
      {/if}
    </p>
    {#if pairs !== null && (pairs.strongest.length > 0 || pairs.weakest.length > 0)}
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        {#if pairs.strongest.length > 0}
          <div>
            <p class="font-mono text-xs text-muted-foreground">Most shared play</p>
            <ul class="mt-1 space-y-1">
              {#each pairs.strongest as pair (pair.a + pair.b)}
                <li class="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <span class="min-w-0">
                    {nameOf(pair.a)} + {nameOf(pair.b)}
                  </span>
                  <span class="shrink-0 text-positive">
                    {pair.shared} trips · {(pair.chemistryBp / 100).toFixed(0)}%
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if pairs.weakest.length > 0}
          <div>
            <p class="font-mono text-xs text-muted-foreground">Least shared play</p>
            <ul class="mt-1 space-y-1">
              {#each pairs.weakest as pair (pair.a + pair.b)}
                <li class="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <span class="min-w-0">
                    {nameOf(pair.a)} + {nameOf(pair.b)}
                  </span>
                  <span class="shrink-0 text-muted-foreground">
                    {pair.shared} trips · {(pair.chemistryBp / 100).toFixed(0)}%
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
    <p class="mt-3 font-mono text-[10px] text-muted-foreground/70">
      Shared possessions are recorded evidence from completed trips, not a prediction.
    </p>
  </section>
{/if}
