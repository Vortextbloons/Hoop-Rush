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
  } from '@hoop-rush/engine';

  let {
    players,
    opponent = null,
  }: {
    players: PeakPlayerSeason[];
    opponent?: BracketOpponent | null;
  } = $props();

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
    {#if lineupMatchup}
      <span class="font-mono text-[10px] text-muted-foreground">
        next: {opponent?.displayName} · MATCHUP {delta(lineupMatchup.matchupDelta)}
      </span>
    {/if}
  </div>
  {#if players.length < 2}
    <p class="px-3 py-3 text-sm text-muted-foreground sm:p-4">
      Choose at least two players to see marginal fit.
    </p>
  {:else}
    <ul class="divide-y divide-border/60">
      {#each players as player, index (player.playerId)}
        {@const value = values[index]}
        {#if value}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
            <span class="min-w-36 flex-1">
              <span class="block text-sm font-bold">{player.displayName}</span>
              <span class="font-mono text-[10px] text-muted-foreground">
                OVR {value.baseOverall} · FIT {delta(value.fitDelta)}
                {#if opponent}
                  · MATCHUP {delta(value.matchupDelta)}{/if}
              </span>
            </span>
            <span class="max-w-full text-right text-xs text-muted-foreground">
              {value.fitReasons[0]?.label ?? 'Balanced marginal contribution'}
            </span>
          </li>
        {/if}
      {/each}
    </ul>
    {#if lineupMatchup && lineupMatchup.reasons[0]}
      <p class="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <span class="font-semibold text-foreground">{lineupMatchup.reasons[0].label}.</span>
        Measured {lineupMatchup.reasons[0].measuredValue.toFixed(0)} vs
        {lineupMatchup.reasons[0].comparisonValue.toFixed(0)}.
      </p>
    {/if}
  {/if}
</section>
