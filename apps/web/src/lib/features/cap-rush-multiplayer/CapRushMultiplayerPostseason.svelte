<script lang="ts">
  import type {
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
    capRushMultiplayerHumanFinals,
    capRushMultiplayerSeatRecord,
    capRushSeriesWins,
    capRushSeriesWinner,
  } from '@hoop-rush/engine';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushArt } from '../cap-rush/cap-rush-art.js';
  import { initialsOf } from '../cap-rush/cap-rush-presentation.js';
  import CapRushStandings from '../cap-rush/CapRushStandings.svelte';
  import CapRushBracket from '../cap-rush/CapRushBracket.svelte';
  import {
    playoffSeriesSeat,
    seatLabelFor,
    seatOrder,
    teamNameOf,
  } from './cap-rush-multiplayer-presentation.js';

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
  const displayedSeriesSeat = $derived(
    postseason === null ? null : playoffSeriesSeat(postseason.outcomes, localSeat),
  );
  const displayedSeriesTeamId = $derived(
    locked === null || displayedSeriesSeat === null
      ? null
      : locked.seats[displayedSeriesSeat].franchise.franchiseId,
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
  const forcedFinals = $derived(
    locked !== null &&
      postseason !== null &&
      capRushMultiplayerHumanFinals(locked, postseason) !== null,
  );
  const pendingFinalsGame = $derived.by(() => {
    if (locked === null || postseason === null) return null;
    return (
      capRushMultiplayerHumanFinals(locked, postseason)?.games.find(
        (entry) =>
          !game.season?.playbackAcks.some(
            (ack) =>
              ack.gameId === entry.gameId &&
              ack.seat === localSeat &&
              ack.resolved &&
              ack.cursor === ack.total,
          ),
      ) ?? null
    );
  });
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
  const seatDetails = $derived.by(() => {
    if (postseason === null || locked === null) return [];
    return orderedSeats.map((seat) => {
      const teamId = locked.seats[seat].franchise.franchiseId;
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
      };
    });
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
    <section
      class="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-4 sm:p-6"
    >
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

      <ul class="grid min-w-0 gap-3 sm:grid-cols-2">
        {#each seatDetails as detail (detail.seat)}
          {@const team = art === null ? null : art.teamFor(detail.teamId)}
          <li
            class="flex min-w-0 flex-col gap-4 rounded-xl border bg-surface-2 p-4 sm:p-5 {detail.seat ===
            localSeat
              ? 'border-primary/40'
              : 'border-border'}"
            data-seat={detail.seat}
          >
            <div class="flex min-w-0 items-center gap-3">
              {#if team !== null && art !== null}
                <TeamLogo
                  manifest={art.manifest}
                  franchiseId={team.franchiseId}
                  teamExternalId={team.teamExternalId}
                  className="h-10 w-10 sm:h-12 sm:w-12"
                />
              {:else}
                <span
                  class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-3 font-display text-sm font-extrabold text-muted-foreground"
                  aria-hidden="true">{initialsOf(detail.name)}</span
                >
              {/if}
              <div class="min-w-0 flex-1">
                <p
                  class="font-mono text-[9px] font-semibold tracking-[0.12em] text-muted-foreground uppercase"
                >
                  {seatLabelFor(detail.seat, localSeat)}
                </p>
                <p
                  class="font-display text-xl leading-tight font-extrabold break-words uppercase sm:text-2xl"
                >
                  {detail.name}
                </p>
              </div>
              {#if showLeagueResults && detail.seed !== null}
                <span
                  class="seed-badge {detail.seed <= 8 ? 'seed-qualified' : ''}"
                  aria-label={`Conference seed ${detail.seed}`}
                >
                  <span class="seed-label">Seed</span>
                  <span class="seed-number"
                    ><span class="seed-hash" aria-hidden="true">#</span>{detail.seed}</span
                  >
                  <span class="seed-rule" aria-hidden="true"></span>
                </span>
              {/if}
            </div>
            {#if showLeagueResults && detail.record !== null}
              <div
                class="flex flex-wrap items-end justify-between gap-3 border-t border-line-soft pt-4"
              >
                <div>
                  <p
                    class="mb-1 font-mono text-[10px] tracking-wider text-muted-foreground uppercase"
                  >
                    Regular season
                  </p>
                  <p
                    class="font-display text-4xl leading-none font-extrabold tabular-nums sm:text-5xl"
                  >
                    {detail.record.wins}<span class="px-1 text-muted-foreground">&ndash;</span
                    >{detail.record.losses}
                  </p>
                </div>
                {#if showLeagueResults && detail.seed !== null}
                  <span
                    class="rounded-md px-2 py-1 font-mono text-[10px] font-bold tracking-wide uppercase {detail.seed <=
                    8
                      ? 'bg-accent/10 text-accent'
                      : 'bg-surface-3 text-muted-foreground'}"
                  >
                    {detail.seed <= 8 ? 'Playoff berth' : 'Missed playoffs'}
                  </span>
                {/if}
              </div>
            {/if}
            {#if !showLeagueResults}
              <p
                class="text-sm font-bold {detail.seed !== null && detail.seed <= 8
                  ? 'text-accent'
                  : 'text-muted-foreground'}"
              >
                {detail.seed !== null && detail.seed <= 8
                  ? 'Qualified for playoffs'
                  : 'Missed playoffs'}
              </p>
              <p class="text-xs text-muted-foreground">{outcomeLabel(detail.outcome)}</p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if !showLeagueResults}
        {#each postseason.series.filter((series) => series.round === currentRound && (series.highTeamId === displayedSeriesTeamId || series.lowTeamId === displayedSeriesTeamId)) as series (series.seriesId)}
          <section class="rounded-xl border border-line-soft bg-surface-1 p-4">
            <header class="flex flex-wrap items-baseline justify-between gap-2">
              <h3 class="font-display text-xl font-extrabold uppercase">
                {capRushConferenceRoundName(series.round)}
              </h3>
              <p class="font-mono text-[10px] text-muted-foreground uppercase">
                Best of seven &middot; First to 4
              </p>
            </header>
            <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              {#each [series.highTeamId, series.lowTeamId] as teamId, index (teamId)}
                {@const identity = art?.teamFor(teamId) ?? null}
                {@const wins = capRushSeriesWins(series, teamId)}
                <div
                  class="flex min-w-0 items-center gap-3 rounded-xl border p-3 {teamId ===
                  localTeamId
                    ? 'border-primary/50 bg-primary/10'
                    : 'border-line-soft bg-card'} {index === 1 ? 'sm:order-3' : ''}"
                >
                  {#if identity !== null && art !== null}<TeamLogo
                      manifest={art.manifest}
                      franchiseId={identity.franchiseId}
                      teamExternalId={identity.teamExternalId}
                      className="h-10 w-10"
                    />{/if}
                  <div class="min-w-0 flex-1">
                    <p class="font-display text-lg leading-tight font-extrabold uppercase">
                      {teamName(teamId)}
                    </p>
                    {#if wins >= 4}<p class="font-mono text-[9px] font-bold text-accent uppercase">
                        Series won
                      </p>{/if}
                  </div>
                  <span
                    class="font-display text-4xl leading-none font-extrabold tabular-nums {wins >= 4
                      ? 'text-accent'
                      : 'text-foreground'}">{wins}</span
                  >
                </div>
                {#if index === 0}<span
                    class="hidden text-center font-mono text-[10px] text-muted-foreground uppercase sm:order-2 sm:block"
                    >vs</span
                  >{/if}
              {/each}
            </div>
          </section>
        {/each}
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
            Playoffs
          </p>
          <h2 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {championTeamId === null
              ? `${capRushConferenceRoundName(currentRound)}`
              : 'League complete'}
          </h2>
        </header>

        {#if pendingFinalsGame !== null}
          <button
            type="button"
            class="inline-flex min-h-11 w-fit items-center justify-center rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            disabled={busy}
            onclick={onwatchplayoff}
            >Watch Simcast &middot; Game {pendingFinalsGame.gameOrdinal}</button
          >
        {/if}
        {#if championTeamId === null}
          {#if pendingFinalsGame === null}
            <div class="flex flex-wrap gap-2">
              {#if !forcedFinals}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center justify-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                  disabled={forcedFinals || busy || (localPlan !== null && (!ishost || !bothPlans))}
                  onclick={() => (localPlan === null ? onchooseplan('sim') : onsimulatestep())}
                >
                  Sim series
                </button>
              {/if}
              <button
                type="button"
                class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-surface-2 px-4 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
                disabled={busy || !hasOpenSeries || (forcedFinals && localPlan !== null)}
                onclick={() => (localPlan === null ? onchooseplan('simcast') : onwatchplayoff())}
              >
                Simcast game
              </button>
            </div>
          {/if}
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

<style>
  .seed-badge {
    display: flex;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 4.25rem;
    padding: 0.65rem 0.8rem 0.8rem;
    color: var(--color-muted-foreground);
    background: var(--color-surface-1);
    border: 1px solid var(--color-line-strong);
    border-radius: 0.75rem 0.75rem 1.5rem 1.5rem;
  }
  .seed-qualified {
    color: var(--color-primary);
    border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
    background: linear-gradient(
      155deg,
      color-mix(in srgb, var(--color-primary) 14%, var(--color-surface-1)),
      var(--color-surface-1)
    );
    box-shadow: inset 0 2px 0 color-mix(in srgb, var(--color-primary) 25%, transparent);
  }
  .seed-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }
  .seed-number {
    display: flex;
    align-items: baseline;
    gap: 0.1rem;
    margin-top: 0.15rem;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .seed-hash {
    font-size: 0.8rem;
    opacity: 0.6;
  }
  .seed-rule {
    width: 1rem;
    height: 2px;
    margin-top: 0.5rem;
    background: currentColor;
    opacity: 0.6;
  }
</style>
