<script lang="ts">
  import type {
    CapRushConferenceSeries,
    CapRushMultiplayerSeatId,
    CapRushMultiplayerState,
    CapRushPostseasonUserOutcome,
  } from '@hoop-rush/data-contracts';
  import {
    capRushConferenceRoundName,
    capRushConferenceStandingsEntries,
  } from '@hoop-rush/data-contracts';
  import {
    capRushMultiplayerCurrentRound,
    capRushMultiplayerSeatRecord,
    capRushSeriesWins,
    capRushSeriesWinner,
  } from '@hoop-rush/engine';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushStandings from '../cap-rush/CapRushStandings.svelte';
  import CapRushBracket from '../cap-rush/CapRushBracket.svelte';
  import { seatLabelFor, seatOrder, teamNameOf } from './cap-rush-multiplayer-presentation.js';

  let {
    state: game,
    localSeat,
    art = null,
    busy = false,
    ishost,
    onchooseplan,
    onsimulatestep,
    onwatchplayoff,
    oncomplete,
  }: {
    state: CapRushMultiplayerState;
    localSeat: CapRushMultiplayerSeatId;
    art?: CapRushArt | null;
    busy?: boolean;
    ishost: boolean;
    onchooseplan: (choice: 'sim' | 'simcast') => void;
    onsimulatestep: () => void;
    onwatchplayoff: () => void;
    oncomplete: () => void;
  } = $props();

  let showingPlayoffs = $state(false);
  const postseason = $derived(game.postseason);
  const playoffsStarted = $derived(
    postseason?.series.some((series) => series.games.length > 0) ?? false,
  );
  const showLeagueResults = $derived(!showingPlayoffs && !playoffsStarted);
  const locked = $derived(game.locked);
  const orderedSeats = $derived(seatOrder(localSeat));
  const otherSeat = $derived(localSeat === 'p1' ? ('p2' as const) : ('p1' as const));
  const localTeamId = $derived(
    locked === null ? null : locked.seats[localSeat].franchise.franchiseId,
  );
  const standings = $derived(postseason?.standings ?? null);
  const championTeamId = $derived(postseason?.championTeamId ?? null);
  const championName = $derived(championTeamId === null ? null : teamName(championTeamId));
  const championTeam = $derived(
    championTeamId === null || art === null ? null : art.teamFor(championTeamId),
  );
  const currentRound = $derived(
    postseason === null ? 1 : capRushMultiplayerCurrentRound(postseason),
  );
  const localPlan = $derived(postseason?.plans[localSeat] ?? null);
  const otherPlan = $derived(postseason?.plans[otherSeat] ?? null);
  const bothPlans = $derived(localPlan !== null && otherPlan !== null);
  const hasOpenSeries = $derived(
    postseason !== null && postseason.series.some((series) => capRushSeriesWinner(series) === null),
  );
  const championSeat = $derived.by((): CapRushMultiplayerSeatId | null => {
    if (locked === null || championTeamId === null) return null;
    for (const seat of orderedSeats) {
      if (locked.seats[seat].franchise.franchiseId === championTeamId) return seat;
    }
    return null;
  });
  const localOutcome = $derived(postseason?.outcomes[localSeat] ?? null);
  const seatDetails = $derived.by(() => {
    if (postseason === null || locked === null) return [];
    return orderedSeats.map((seat) => {
      const teamId = locked.seats[seat].franchise.franchiseId;
      const series = latestSeriesOf(teamId);
      return {
        seat,
        teamId,
        name: locked.seats[seat].franchise.displayName,
        seed: seedOf(teamId),
        record:
          game.season === null
            ? null
            : capRushMultiplayerSeatRecord(locked, game.season.games, seat),
        outcome: postseason.outcomes[seat],
        seriesLine: series === null ? null : seriesLine(series, teamId),
      };
    });
  });
  const personalNote = $derived.by((): string | null => {
    if (postseason === null || localOutcome === null) return null;
    if (championTeamId === null) {
      if (standings === null) {
        return 'Waiting for final standings.';
      }
      if (localOutcome.status === 'eliminated') {
        return `Your run ends here${
          localOutcome.round === null
            ? ''
            : ` in the ${capRushConferenceRoundName(localOutcome.round)}`
        }.`;
      }
      if (localOutcome.status === 'not-qualified') {
        return 'Your team missed the playoffs.';
      }
      return 'Your team is still alive in the bracket.';
    }
    if (championSeat === localSeat) {
      return 'Your team won the league.';
    }
    if (localOutcome.status === 'eliminated') {
      return `Your run ended in the ${
        localOutcome.round === null ? 'postseason' : capRushConferenceRoundName(localOutcome.round)
      }. The league is complete.`;
    }
    if (localOutcome.status === 'not-qualified') {
      return 'Your team missed the playoffs. The league is complete.';
    }
    return 'The league is complete without the title for your team.';
  });

  function teamName(teamId: string): string {
    return teamNameOf(locked, teamId);
  }

  function seedOf(teamId: string): number | null {
    if (standings === null) return null;
    return (
      capRushConferenceStandingsEntries(standings).find((entry) => entry.teamId === teamId)?.seed ??
      null
    );
  }

  function latestSeriesOf(teamId: string): CapRushConferenceSeries | null {
    if (postseason === null) return null;
    return (
      postseason.series
        .filter((series) => series.highTeamId === teamId || series.lowTeamId === teamId)
        .sort((left, right) => right.round - left.round || right.seriesSlot - left.seriesSlot)[0] ??
      null
    );
  }

  function seriesLine(series: CapRushConferenceSeries, teamId: string): string {
    const opponentId = series.highTeamId === teamId ? series.lowTeamId : series.highTeamId;
    const ownWins = capRushSeriesWins(series, teamId);
    const opponentWins = capRushSeriesWins(series, opponentId);
    const winner = capRushSeriesWinner(series);
    const status =
      winner === null
        ? series.games.length === 0
          ? 'Not started'
          : 'In progress'
        : winner === teamId
          ? 'Won'
          : 'Lost';
    return `${capRushConferenceRoundName(series.round)} vs ${teamName(opponentId)} · ${status} ${ownWins}–${opponentWins}`;
  }

  function outcomeLabel(outcome: CapRushPostseasonUserOutcome): string {
    switch (outcome.status) {
      case 'champion':
        return 'League champion';
      case 'eliminated':
        return outcome.round === null
          ? 'Eliminated'
          : `Eliminated in the ${capRushConferenceRoundName(outcome.round)}`;
      case 'not-qualified':
        return 'Missed the playoffs';
      default:
        return 'Still playing';
    }
  }
</script>

{#if postseason === null || locked === null}
  <p class="text-sm text-muted-foreground">The postseason has not started.</p>
{:else}
  <div class="flex min-w-0 flex-col gap-4" data-cap-rush-multiplayer-postseason>
    <section class="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <header class="flex flex-wrap items-end justify-between gap-2">
        <div class="min-w-0">
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Postseason · {championTeamId === null ? `round ${currentRound} of 4` : 'complete'}
          </p>
          <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {showLeagueResults
              ? 'League results'
              : championTeamId === null
                ? capRushConferenceRoundName(currentRound)
                : 'Champion crowned'}
          </h2>
        </div>
      </header>

      <ul class="grid min-w-0 gap-2 sm:grid-cols-2">
        {#each seatDetails as detail (detail.seat)}
          {@const team = art === null ? null : art.teamFor(detail.teamId)}
          <li
            class="flex min-w-0 flex-col gap-1 rounded-xl border bg-surface-2 p-3 {detail.seat ===
            localSeat
              ? 'border-primary/40'
              : 'border-border'}"
            data-seat={detail.seat}
          >
            <div class="flex min-w-0 items-center gap-2">
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-5 w-5"
                />
              {:else}
                <span
                  class="grid h-5 w-5 shrink-0 place-items-center rounded bg-surface-3 font-display text-[9px] font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(detail.name)}</span
                >
              {/if}
              <div class="min-w-0 flex-1">
                <p
                  class="font-mono text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(detail.seat, localSeat)}
                </p>
                <p class="truncate font-display text-base leading-tight font-extrabold uppercase">
                  {detail.name}
                </p>
              </div>
              {#if detail.seed !== null}
                <span
                  class="shrink-0 rounded-full border border-line-strong px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase"
                  >Seed {detail.seed}</span
                >
              {/if}
            </div>
            {#if detail.record !== null}
              <p class="font-display text-2xl font-extrabold tabular-nums">
                {detail.record.wins}&ndash;{detail.record.losses}
                <span
                  class="font-mono text-[9px] font-normal tracking-wider text-muted-foreground uppercase"
                  >Regular season</span
                >
              </p>
            {/if}
            {#if !showLeagueResults}
              <p class="text-xs font-semibold">{outcomeLabel(detail.outcome)}</p>
              <p class="min-w-0 truncate text-[11px] text-muted-foreground">
                {detail.seriesLine ?? 'No bracket series yet.'}
              </p>
            {/if}
          </li>
        {/each}
      </ul>

      {#if !showLeagueResults && personalNote !== null}
        <p
          class="rounded-xl border p-3 text-xs leading-relaxed {championSeat === localSeat
            ? 'border-accent/50 bg-accent/10 text-foreground'
            : 'border-border bg-surface-1 text-muted-foreground'}"
          role="status"
        >
          {personalNote}
        </p>
      {/if}
    </section>

    {#if showLeagueResults && standings !== null}
      <section class="min-w-0" aria-label="Final regular season standings">
        <header class="mb-3">
          <p class="font-mono text-[10px] tracking-[0.16em] text-primary uppercase">
            Regular season complete
          </p>
          <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            Final standings
          </h2>
        </header>
        <CapRushStandings {standings} manifest={art?.manifest ?? null} userTeamId={localTeamId} />
      </section>
    {/if}

    {#if showLeagueResults && standings !== null}
      <button
        type="button"
        class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onclick={() => (showingPlayoffs = true)}
      >
        Continue to playoffs
      </button>
    {:else if standings === null}
      <section class="rounded-2xl border border-border bg-card p-4">
        <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
          Bracket
        </p>
        <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
          Waiting for final standings
        </h2>
      </section>
    {:else}
      <section class="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <header>
          <p class="font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            Round plan
          </p>
          <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {championTeamId === null
              ? `${capRushConferenceRoundName(currentRound)}`
              : 'League complete'}
          </h2>
        </header>

        {#if championTeamId === null}
          <ul class="grid min-w-0 gap-2 sm:grid-cols-2">
            {#each orderedSeats as seat (seat)}
              {@const plan = postseason.plans[seat]}
              <li
                class="min-w-0 rounded-xl border bg-surface-2 p-3 {seat === localSeat
                  ? 'border-primary/40'
                  : 'border-border'}"
                data-seat={seat}
              >
                <p
                  class="font-mono text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(seat, localSeat)}
                </p>
                <p class="mt-1 truncate font-display text-lg font-bold tracking-tight uppercase">
                  {plan === null ? 'Choosing…' : plan === 'sim' ? 'Sim' : 'Simcast'}
                </p>
              </li>
            {/each}
          </ul>

          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              disabled={busy || (localPlan !== null && (!ishost || !bothPlans))}
              onclick={() => (localPlan === null ? onchooseplan('sim') : onsimulatestep())}
            >
              Sim series
            </button>
            <button
              type="button"
              class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              disabled={busy || !hasOpenSeries}
              onclick={() => (localPlan === null ? onchooseplan('simcast') : onwatchplayoff())}
            >
              Simcast game
            </button>
          </div>
        {:else}
          <div
            class="flex min-w-0 flex-col gap-2 rounded-xl border border-accent/50 bg-accent/10 p-3"
          >
            <div class="flex min-w-0 items-center gap-2">
              {#if championTeam !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={championTeam.franchiseId}
                  teamExternalId={championTeam.teamExternalId}
                  className="h-6 w-6"
                />
              {/if}
              <p class="min-w-0 font-display text-xl font-extrabold tracking-tight uppercase">
                {championName} won the league
              </p>
            </div>
            {#if championSeat !== null}
              <p class="font-mono text-[10px] tracking-[0.12em] text-accent uppercase">
                {seatLabelFor(championSeat, localSeat)}'s franchise
              </p>
            {/if}
            <button
              type="button"
              class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none
                focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              disabled={busy}
              onclick={oncomplete}
            >
              Accept final report
            </button>
          </div>
        {/if}
      </section>

      <CapRushBracket
        series={postseason.series}
        {standings}
        manifest={art?.manifest ?? null}
        userTeamId={localTeamId}
      />
    {/if}
  </div>
{/if}
