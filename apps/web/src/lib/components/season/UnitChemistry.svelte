<script lang="ts">
  import type { SeasonEffectsState, SeasonRoster } from '@hoop-rush/data-contracts';
  import type { SeasonRunShellData } from '$lib/season/season-shell-context';
  import {
    activeLineupChemistryBp,
    strongestAndWeakestPairs,
  } from '$lib/season/season-effects-view';
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
  const chemistryLabel = $derived(
    lineupChemistry === null ? '—' : `${(lineupChemistry / 100).toFixed(0)}`,
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
  <details class="sr-panel-quiet group px-3 py-2" data-unit-chemistry>
    <summary
      class="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
    >
      <span class="sr-section-label">Chemistry {chemistryLabel}</span>
      <span class="text-xs font-semibold text-primary group-open:hidden">View details</span>
      <span class="hidden text-xs font-semibold text-primary group-open:inline">Hide details</span>
    </summary>
    {#if pairs !== null && (pairs.strongest.length > 0 || pairs.weakest.length > 0)}
      <div class="grid gap-3 pb-2 sm:grid-cols-2">
        {#if pairs.strongest.length > 0}
          <div>
            <p class="sr-section-label">Strong chemistry</p>
            <ul class="mt-1 space-y-1">
              {#each pairs.strongest as pair (pair.a + pair.b)}
                <li class="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <span class="min-w-0">
                    {nameOf(pair.a)} + {nameOf(pair.b)}
                  </span>
                  <span class="sr-number shrink-0 text-positive">
                    {(pair.chemistryBp / 100).toFixed(0)}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if pairs.weakest.length > 0}
          <div>
            <p class="sr-section-label">Still building</p>
            <ul class="mt-1 space-y-1">
              {#each pairs.weakest as pair (pair.a + pair.b)}
                <li class="flex items-baseline justify-between gap-2 font-mono text-xs">
                  <span class="min-w-0">
                    {nameOf(pair.a)} + {nameOf(pair.b)}
                  </span>
                  <span class="sr-number shrink-0 text-muted-foreground">
                    {(pair.chemistryBp / 100).toFixed(0)}
                  </span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </details>
{/if}
