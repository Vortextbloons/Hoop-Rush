<script lang="ts">
  import type { SeasonBlockRecap, SeasonRecordMovement } from '@hoop-rush/data-contracts';
  import { ordinal, recordLabel, streakLabel } from '$lib/season/season-presentation';

  /**
   * Factual block recap (spec/2.0/02 recap, spec/2.0/11 block recap, M2.3).
   * Leads with record and standings movement, then notable performances,
   * streaks, version-versus-version spotlights, and the next human games.
   * M2.3 recaps deliberately do NOT report injuries, trades, Influence,
   * stamina, or chemistry claims — those systems ship in later milestones.
   */

  let {
    recap,
    humanRecord,
    franchiseName,
    playerName,
  }: {
    recap: SeasonBlockRecap;
    humanRecord: SeasonRecordMovement | null;
    franchiseName: (franchiseId: string) => string;
    playerName: (playerVersionId: string) => string;
  } = $props();

  const movementLabel = (movement: SeasonRecordMovement): string =>
    `${movement.winsBefore}–${movement.lossesBefore} → ${movement.winsAfter}–${movement.lossesAfter} (${
      movement.positionBefore !== movement.positionAfter
        ? `${ordinal(movement.positionBefore)} → ${ordinal(movement.positionAfter)}`
        : `${ordinal(movement.positionAfter)} in conference`
    })`;
</script>

<div class="flex flex-col gap-6">
  {#if humanRecord}
    <section aria-labelledby="recap-record-heading" class="rounded-xl bg-surface-1 p-4">
      <h2
        id="recap-record-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Your block
      </h2>
      <p class="mt-2 text-2xl font-extrabold">
        {recordLabel(humanRecord.winsAfter, humanRecord.lossesAfter)}
        <span class="ml-2 font-mono text-xs font-normal text-muted-foreground">
          from {recordLabel(humanRecord.winsBefore, humanRecord.lossesBefore)} ·
          {ordinal(humanRecord.positionAfter)} in conference (provisional)
        </span>
      </p>
      <p class="mt-1 font-mono text-[10px] text-muted-foreground">
        Block {recap.blockIndex + 1} of 9 · rounds 1–{recap.completedRounds} complete
      </p>
    </section>
  {/if}

  {#if recap.standingsMovement.length > 0}
    <section aria-labelledby="recap-movement-heading" class="rounded-xl bg-surface-1 p-4">
      <h2
        id="recap-movement-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Standings movement
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.standingsMovement as movement (movement.franchiseId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(movement.franchiseId)}
            </span>
            <span class="font-mono text-[10px] text-muted-foreground">
              {movementLabel(movement)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.notablePerformances.length > 0}
    <section aria-labelledby="recap-performances-heading" class="rounded-xl bg-surface-1 p-4">
      <h2
        id="recap-performances-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Notable performances
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.notablePerformances as performance (performance.playerVersionId + performance.gameId)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {playerName(performance.playerVersionId)}
            </span>
            {#if performance.humanTeam}
              <span
                class="rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-primary"
              >
                Your team
              </span>
            {/if}
            <span class="font-mono text-[10px] text-muted-foreground">
              {performance.points} pts · {performance.rebounds} reb · {performance.assists} ast ·
              {performance.gameId}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.streaks.length > 0}
    <section aria-labelledby="recap-streaks-heading" class="rounded-xl bg-surface-1 p-4">
      <h2
        id="recap-streaks-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Streaks
      </h2>
      <ul class="mt-2 flex flex-col gap-1.5">
        {#each recap.streaks as streak (streak.franchiseId)}
          <li class="flex items-center gap-2 text-sm">
            <span class="min-w-0 flex-1 truncate font-semibold">
              {franchiseName(streak.franchiseId)}
            </span>
            <span class="shrink-0 font-mono text-[10px] font-bold">
              {streakLabel(streak.kind, streak.length)}
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if recap.versionSpotlights.length > 0}
    <section aria-labelledby="recap-spotlights-heading" class="rounded-xl bg-surface-1 p-4">
      <h2
        id="recap-spotlights-heading"
        class="font-display text-base font-extrabold uppercase tracking-tight"
      >
        Version vs version
      </h2>
      <ul class="mt-2 flex flex-col divide-y divide-border/50">
        {#each recap.versionSpotlights as spotlight (spotlight.versionA + spotlight.versionB)}
          <li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">
                {playerName(spotlight.versionA)}
                <span class="mx-1 text-muted-foreground">vs</span>
                {playerName(spotlight.versionB)}
              </span>
              <span class="block font-mono text-[10px] text-muted-foreground">
                {spotlight.sameTeam
                  ? 'Same roster · '
                  : ''}{spotlight.gamesPlayedA}/{spotlight.gamesPlayedB}
                games · {spotlight.pointsA}/{spotlight.pointsB} pts ·
                {spotlight.reboundsA}/{spotlight.reboundsB} reb ·
                {spotlight.assistsA}/{spotlight.assistsB} ast
                {#if spotlight.headToHeadGames > 0}
                  · {spotlight.headToHeadGames} meeting{spotlight.headToHeadGames === 1 ? '' : 's'}
                  ({spotlight.headToHeadWinsA}–{spotlight.headToHeadWinsB})
                {/if}
              </span>
            </span>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section aria-labelledby="recap-upcoming-heading" class="rounded-xl bg-surface-1 p-4">
    <h2
      id="recap-upcoming-heading"
      class="font-display text-base font-extrabold uppercase tracking-tight"
    >
      Next opponents
    </h2>
    {#if recap.upcomingHumanGames.length === 0}
      <p class="mt-2 text-sm text-muted-foreground">
        {recap.completedRounds >= 82
          ? 'The regular season is complete.'
          : 'No human games scheduled.'}
      </p>
    {:else}
      <ol class="mt-2 flex flex-col gap-1.5">
        {#each recap.upcomingHumanGames as game (game.gameId)}
          <li class="flex flex-wrap items-center gap-2 text-sm">
            <span class="w-14 shrink-0 font-mono text-[10px] text-muted-foreground">
              R{game.round}
            </span>
            <span class="min-w-0 flex-1 truncate">
              {game.humanIsHome ? 'vs' : 'at'}
              {franchiseName(game.opponentFranchiseId)}
            </span>
            <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{game.gameId}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</div>
