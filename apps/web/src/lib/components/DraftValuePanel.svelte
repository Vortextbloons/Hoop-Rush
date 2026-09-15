<script lang="ts">
  import type {
    BracketOpponent,
    ContextualPlayerValue,
    PeakPlayerSeason,
  } from '@hoop-rush/data-contracts';
  import {
    evaluateContextualPlayerValue,
    evaluateLineupMatchup,
    toSimulationPlayer,
    type DraftFitNeed,
    type DraftFitScore,
  } from '@hoop-rush/engine';
  import type { DraftPresentation } from '$lib/draft-presentation';
  import { FIT_NEED_META, FIT_TIER_META, formatNetDelta } from '$lib/draft-fit';
  let {
    players,
    opponent = null,
    presentation = 'ratings',
    poolScores = null,
    missingNeeds = [],
    refinedCount = 0,
  }: {
    players: PeakPlayerSeason[];
    opponent?: BracketOpponent | null;
    presentation?: DraftPresentation;
    poolScores?: DraftFitScore[] | null;
    missingNeeds?: DraftFitNeed[];
    refinedCount?: number;
  } = $props();
  const hideRatings = $derived(presentation === 'ball-knowledge');
  const showSuggestions = $derived(!hideRatings && (poolScores?.length ?? 0) > 0);
  const topSuggestions = $derived((poolScores ?? []).slice(0, 5));
  const needsText = $derived(
    missingNeeds.length === 0
      ? null
      : `Needs: ${missingNeeds.map((need) => FIT_NEED_META[need].label).join(' · ')}`,
  );
  const values = $derived.by((): ContextualPlayerValue[] => {
    const simulationPlayers = players.map(toSimulationPlayer);
    return simulationPlayers.map((player, index) =>
      evaluateContextualPlayerValue(
        player,
        simulationPlayers.filter((_, teammateIndex) => teammateIndex !== index),
        opponent
          ? {
              teamId: opponent.teamId,
              displayName: opponent.displayName,
              players: opponent.players,
            }
          : undefined,
      ),
    );
  });
  const lineupMatchup = $derived.by(() => {
    if (!opponent || players.length !== 5) return null;
    const simulationPlayers = players.map(toSimulationPlayer);
    const first = simulationPlayers[0];
    if (!first) return null;
    return evaluateLineupMatchup(
      { teamId: 'draft', displayName: 'Your five', players: simulationPlayers },
      { teamId: opponent.teamId, displayName: opponent.displayName, players: opponent.players },
    );
  });
  function delta(value: number): string {
    return value > 0 ? `+${String(value)}` : String(value);
  }
</script>

<section class="rounded-none bg-surface-1 sm:rounded-xl" aria-labelledby="draft-value-heading">
  <div class="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
    <div>
      <p class="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">Context</p>
      <h2
        id="draft-value-heading"
        class="font-display text-lg font-extrabold tracking-tight uppercase"
      >
        Lineup fit
      </h2>
    </div>
    {#if lineupMatchup && !hideRatings}
      <span class="font-mono text-[10px] text-muted-foreground">
        next: {opponent?.displayName} · MATCHUP {delta(lineupMatchup.matchupDelta)}
      </span>
    {/if}
  </div>
  {#if showSuggestions}
    <div class="border-b border-border/60 px-3 py-3 sm:px-4" data-fit-top>
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h3 class="font-mono text-[10px] font-bold tracking-[0.14em] text-primary uppercase">
          Suggested picks
        </h3>
        {#if needsText}
          <span class="font-mono text-[10px] text-muted-foreground">{needsText}</span>
        {/if}
      </div>
      <ol class="mt-2 flex flex-col gap-1.5">
        {#each topSuggestions as suggestion, rank (suggestion.playerId)}
          {@const tier = FIT_TIER_META[suggestion.tier]}
          {@const need = FIT_NEED_META[suggestion.primaryNeed]}
          <li
            class="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 {rank === 0
              ? 'border-primary/45 bg-primary/10'
              : 'border-border/60 bg-surface-2'}"
            data-fit-tier={suggestion.tier}
          >
            <span
              class="grid h-5 w-5 shrink-0 place-items-center rounded-full font-mono text-[10px] font-extrabold {rank ===
              0
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-3 text-muted-foreground'}"
              aria-hidden="true">{rank + 1}</span
            >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-bold">
                {suggestion.displayName}
                {#if rank === 0}
                  <span class="sr-only">(best fit)</span>
                {/if}
              </span>
              <span class="block truncate text-xs text-muted-foreground"
                >{suggestion.reasonLabel}</span
              >
            </span>
            <span
              class="shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold {tier.badge}"
              title="Fit quality: {tier.label}"
            >
              {rank === 0 ? 'BEST FIT' : tier.label}
            </span>
            <span
              class="flex shrink-0 items-center gap-1 font-mono text-[10px] text-muted-foreground"
            >
              <span class="h-2 w-2 rounded-full {need.dot}" aria-hidden="true"></span>
              <span class="sr-only">{need.label}: </span>{formatNetDelta(suggestion.netDelta)}
            </span>
          </li>
        {/each}
      </ol>
      <p class="mt-2 font-mono text-[10px] text-muted-foreground">
        {#if refinedCount > 0}
          Deltas from marginal projection over a reference replacement ({refinedCount} refined).
        {:else}
          Heuristic screen — projection unavailable for this pool.
        {/if}
      </p>
    </div>
  {/if}
  {#if !showSuggestions && needsText && !hideRatings}
    <p class="border-b border-border/60 px-3 py-2 font-mono text-[10px] sm:px-4" data-fit-needs>
      <span class="font-bold tracking-[0.14em] text-primary uppercase">Fit guide · </span>
      <span class="text-muted-foreground">{needsText}</span>
    </p>
  {/if}
  {#if players.length < 2}
    <p class="px-3 py-3 text-sm text-muted-foreground sm:p-4">
      Choose at least two players to see marginal fit.
    </p>
  {:else if hideRatings}
    <ul class="divide-y divide-border/60">
      {#each players as player (player.playerId)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
          <span class="min-w-0 flex-1 sm:min-w-36">
            <span class="block text-sm font-bold">{player.displayName}</span>
            <span class="font-mono text-[10px] text-muted-foreground">Ratings hidden</span>
          </span>
        </li>
      {/each}
    </ul>
    <p class="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
      Ratings hidden in Ball Knowledge — draft on memory.
    </p>
  {:else}
    <ul class="divide-y divide-border/60">
      {#each players as player, index (player.playerId)}
        {@const value = values[index]}
        {#if value}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span class="min-w-0 flex-1 sm:min-w-36">
              <span class="block text-sm font-bold">{player.displayName}</span>
              <span class="font-mono text-[10px] text-muted-foreground">
                OVR {value.baseOverall} · FIT {delta(value.fitDelta)}
                {#if opponent}
                  · MATCHUP {delta(value.matchupDelta)}{/if}
              </span>
            </span>
            <span class="max-w-full text-right text-xs text-muted-foreground">
              {value.fitReasons[0]?.label ?? 'Balanced fit'}
            </span>
          </li>
        {/if}
      {/each}
    </ul>
    {#if lineupMatchup && lineupMatchup.reasons[0]}
      <p class="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <span class="font-semibold text-foreground">{lineupMatchup.reasons[0].label}.</span>
      </p>
    {/if}
  {/if}
</section>
