<script lang="ts">
  import {
    CAP_RUSH_SERIES_WINS,
    CAP_RUSH_USER_TEAM_ID,
    capRushRoundName,
    capRushSeriesWins,
    type CapRushPlayoffSeries,
    type CapRushPostseasonStandings,
  } from '@hoop-rush/data-contracts';
  import { Play, Trophy, X } from '@lucide/svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import type { CapRushSeasonController } from './cap-rush-season-state.svelte.js';
  import CapRushBracket from './CapRushBracket.svelte';
  import CapRushStandings from './CapRushStandings.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatAverage, initialsOf, recordLabel } from './cap-rush-presentation.ts';

  let {
    controller,
    view,
    art = null,
    onAdvance,
    onCancel,
    onReport,
  }: {
    controller: CapRushSeasonController;
    view: CapRushDraftView;
    art?: CapRushArt | null;
    onAdvance: () => void;
    onCancel: () => void;
    onReport: () => void;
  } = $props();

  const postseason = $derived(view.postseason);
  const standings = $derived(postseason?.standings ?? null);
  const series = $derived(postseason?.series ?? []);
  const userTeamId = $derived(view.draft.locked?.human.teamId ?? CAP_RUSH_USER_TEAM_ID);
  const userEntry = $derived(
    standings?.entries.find((entry) => entry.teamId === userTeamId) ?? null,
  );
  const latestRound = $derived(
    series.length === 0 ? 1 : Math.max(...series.map((entry) => entry.round)),
  );
  const userSeries = $derived(
    series.find(
      (entry) =>
        entry.round === latestRound &&
        (entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId),
    ) ?? null,
  );
  const currentRoundComplete = $derived(
    series
      .filter((entry) => entry.round === latestRound)
      .every((entry) => winnerOf(entry) !== null),
  );
  const championEntry = $derived(
    postseason?.championTeamId === null || postseason?.championTeamId === undefined
      ? null
      : (standings?.entries.find((entry) => entry.teamId === postseason.championTeamId) ?? null),
  );
  const finalsMvp = $derived(postseason?.finalsMvp ?? null);
  const mvpFace = $derived(
    finalsMvp === null || art === null ? null : art.faceForPlayerId(finalsMvp.playerId),
  );
  const isChampion = $derived(
    postseason?.userOutcome.status === 'champion' && postseason.championTeamId === userTeamId,
  );
  const liveChampion = $derived(isChampion && postseason?.phase === 'playoffs');
  const awaitingStandings = $derived(postseason?.phase === 'awaiting-standings');
  const finalsReady = $derived(
    postseason !== null &&
      postseason.championTeamId !== null &&
      postseason.phase !== 'complete' &&
      postseason.series.length === 15,
  );

  function winnerOf(entry: CapRushPlayoffSeries): string | null {
    if (capRushSeriesWins(entry, entry.highTeamId) >= CAP_RUSH_SERIES_WINS) return entry.highTeamId;
    if (capRushSeriesWins(entry, entry.lowTeamId) >= CAP_RUSH_SERIES_WINS) return entry.lowTeamId;
    return null;
  }

  function nameOf(teamId: string): string {
    return standings?.entries.find((entry) => entry.teamId === teamId)?.displayName ?? teamId;
  }

  function seedOf(teamId: string): number {
    return standings?.entries.find((entry) => entry.teamId === teamId)?.seed ?? 0;
  }

  function identityOf(teamId: string) {
    return art === null ? null : art.teamFor(teamId);
  }

  function actionLabel(): string {
    if (awaitingStandings) return 'Complete league standings';
    if (finalsReady || postseason?.phase === 'complete') return 'Open the final report';
    if (postseason?.userOutcome.status === 'not-qualified') return 'Finish the postseason';
    if (postseason?.userOutcome.status === 'eliminated') return 'Finish the postseason';
    if (userSeries !== null && winnerOf(userSeries) === null) return 'Play next game';
    if (userSeries !== null && !currentRoundComplete) return 'Finish the round';
    return 'Continue the postseason';
  }

  function statusHeadline(): string {
    if (postseason === null) return 'The postseason awaits.';
    if (postseason.phase === 'complete') {
      return isChampion ? 'Champions.' : `${championEntry?.displayName ?? 'The champion'}.`;
    }
    if (postseason.userOutcome.status === 'champion') return 'Champions.';
    if (postseason.userOutcome.status === 'not-qualified') return 'The field closed without you.';
    if (postseason.userOutcome.status === 'eliminated') {
      return `Out in the ${capRushRoundName(postseason.userOutcome.round ?? 1).toLowerCase()}.`;
    }
    if (awaitingStandings) return 'The regular season is in the books.';
    if (latestRound === 4) return 'The Finals.';
    if (latestRound === 1) return 'The first round is live.';
    return `${capRushRoundName(latestRound)} is live.`;
  }

  function statusMessage(): string {
    if (postseason === null) return 'Finish the regular season to reach the bracket.';
    if (postseason.phase === 'complete') {
      return `${championEntry?.displayName ?? 'The champion'} won the championship.`;
    }
    if (postseason.userOutcome.status === 'not-qualified') {
      return `You finished ${userEntry?.seed ?? '\u2014'}th at ${recordLabel(userEntry?.wins ?? 0, userEntry?.losses ?? 0)} and missed the top sixteen.`;
    }
    if (postseason.userOutcome.status === 'eliminated') {
      return `The ${capRushRoundName(postseason.userOutcome.round ?? 1)} ended your run. The rest of the bracket is finishing without you.`;
    }
    if (awaitingStandings) {
      return 'Every team has played 82 games. Complete the league schedule to seed the bracket.';
    }
    if (userSeries === null) {
      return 'Your run is over. The remaining bracket will finish automatically.';
    }
    if (winnerOf(userSeries) !== null) {
      return 'Your series is decided. The rest of the round must finish before the next round opens.';
    }
    return 'One game at a time. Your locked lineup, apron effects and spin carry over.';
  }
</script>

<section class="flex flex-col gap-4" aria-label="Cap Rush postseason">
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
        Cap Rush · Postseason
      </p>
      <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
        {statusHeadline()}
      </h1>
      <p class="mt-2 max-w-2xl text-sm text-muted-foreground">{statusMessage()}</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if userEntry !== null}
        <span
          class="seed-reveal rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] font-bold text-primary uppercase"
          >Seed {userEntry.seed} · {recordLabel(userEntry.wins, userEntry.losses)}</span
        >
      {:else if postseason?.phase === 'awaiting-standings'}
        <span class="font-mono text-[10px] text-muted-foreground uppercase">82 games complete</span>
      {/if}
    </div>
  </header>

  {#if isChampion}
    <div
      class="relative overflow-hidden rounded-2xl border border-accent/50 bg-accent/10 p-5 sm:p-7 {liveChampion
        ? 'trophy-banner'
        : ''}"
      role="status"
    >
      {#if liveChampion}
        <div class="confetti" aria-hidden="true">
          {#each Array.from({ length: 14 }, (_, index) => index) as piece (piece)}
            <span style="--i:{piece}"></span>
          {/each}
        </div>
      {/if}
      <div class="relative flex items-center gap-4">
        <Trophy size={40} class="shrink-0 text-accent" aria-hidden="true" />
        <div class="min-w-0">
          <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
            Cap Rush champion
          </p>
          <h2 class="font-display text-3xl font-extrabold tracking-tight uppercase">
            {championEntry?.displayName ?? 'Your five'}
          </h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Four series. Four wins each. The championship is yours.
          </p>
        </div>
      </div>
    </div>
  {:else if championEntry !== null}
    <div class="rounded-2xl border border-border bg-card p-5 sm:p-6" role="status">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
        Champion
      </p>
      <h2 class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase">
        {championEntry.displayName}
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        {isChampion
          ? 'Your run ends with the trophy.'
          : 'Your run is over, but the bracket finished.'}
      </p>
    </div>
  {/if}

  {#if finalsMvp !== null}
    <div class="rounded-2xl border border-accent/40 bg-card p-5 sm:p-6" aria-label="Finals MVP">
      <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
        Finals MVP
      </p>
      <div class="mt-3 flex flex-wrap items-center gap-4">
        <div class="shrink-0">
          {#if mvpFace && art}
            <PlayerFace
              player={mvpFace}
              manifest={art.manifest}
              size="xl"
              fallbackInitials={initialsOf(finalsMvp.displayName)}
            />
          {:else}
            <span
              class="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-3 font-display text-xl font-extrabold"
              aria-hidden="true">{initialsOf(finalsMvp.displayName)}</span
            >
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <h3 class="font-display text-2xl font-extrabold tracking-tight uppercase">
            {finalsMvp.displayName}
          </h3>
          <p class="font-mono text-[10px] text-muted-foreground uppercase">
            {finalsMvp.slot} · {nameOf(finalsMvp.teamId)} · {finalsMvp.games} Finals games
          </p>
          <dl class="mt-3 grid grid-cols-4 gap-2">
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">PTS</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(finalsMvp.totalPoints, finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">REB</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(finalsMvp.totalRebounds, finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">AST</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(finalsMvp.totalAssists, finalsMvp.games)}
              </dd>
            </div>
            <div>
              <dt class="font-mono text-[8px] text-muted-foreground uppercase">Game score</dt>
              <dd class="font-display text-lg font-extrabold tabular-nums">
                {formatAverage(finalsMvp.totalGameScore, finalsMvp.games)}
              </dd>
            </div>
          </dl>
        </div>
      </div>
      <p class="mt-3 text-[11px] text-muted-foreground">
        Cumulative Finals game score
        <strong class="text-foreground">{finalsMvp.totalGameScore.toFixed(1)}</strong>. Ranked by
        cumulative Finals game score, then Finals points, assists, rebounds and stable player ID.
      </p>
    </div>
  {/if}

  <div class="rounded-2xl border border-border bg-card p-4 sm:p-5" aria-label="Postseason action">
    <div class="flex flex-wrap items-center gap-2">
      {#if controller.busy}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-negative hover:text-negative focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          disabled={controller.cancelling}
          onclick={onCancel}
        >
          <X size={15} aria-hidden="true" />
          {controller.cancelling ? 'Pausing…' : 'Pause'}
        </button>
      {:else if postseason?.phase === 'complete'}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={onReport}
        >
          <Trophy size={15} aria-hidden="true" />
          Open the final report
        </button>
      {:else if awaitingStandings}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={onAdvance}
        >
          <Play size={15} aria-hidden="true" />
          {actionLabel()}
        </button>
      {:else}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={onAdvance}
        >
          <Play size={15} aria-hidden="true" />
          {actionLabel()}
        </button>
      {/if}
      <span class="text-[11px] text-muted-foreground">
        {#if controller.progress !== null}
          {controller.progress.completed} of {controller.progress.total} tasks in this batch…
        {:else if postseason?.phase === 'complete'}
          The bracket and Finals MVP are saved.
        {:else}
          Accepted results save immediately.
        {/if}
      </span>
    </div>

    {#if controller.progress !== null}
      <div
        class="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3"
        role="progressbar"
        aria-label="Postseason simulation progress"
        aria-valuemin={0}
        aria-valuemax={controller.progress.total}
        aria-valuenow={controller.progress.completed}
      >
        <span
          class="block h-full rounded-full bg-primary motion-reduce:transition-none"
          style:width={`${Math.min(100, (controller.progress.completed / controller.progress.total) * 100)}%`}
        ></span>
      </div>
    {/if}

    {#if controller.notice !== null}
      <p class="mt-3 text-xs font-semibold text-muted-foreground" role="status">
        {controller.notice}
      </p>
    {/if}
    {#if controller.error !== null}
      <div
        role="alert"
        class="mt-3 rounded-xl border border-negative/40 bg-negative/10 p-3 text-sm text-negative"
      >
        {controller.error}
      </div>
    {/if}
  </div>

  {#if userSeries !== null && postseason?.phase !== 'complete'}
    <section
      class="rounded-2xl border border-primary/30 bg-card p-4 sm:p-6"
      aria-label="Current series"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          {capRushRoundName(userSeries.round)} ·
          {winnerOf(userSeries) === null
            ? `Game ${String(Math.min(7, userSeries.games.length + 1))}`
            : 'Series complete'}
        </p>
        <p class="font-mono text-[10px] text-muted-foreground uppercase">
          Best of seven · First to {CAP_RUSH_SERIES_WINS}
        </p>
      </div>

      <div class="mt-4 grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        {#each [userSeries.highTeamId, userSeries.lowTeamId] as teamId, index (teamId)}
          {@const identity = identityOf(teamId)}
          {@const won = winnerOf(userSeries) === teamId}
          <div
            class="flex min-w-0 items-center gap-3 rounded-xl border p-3 {teamId === userTeamId
              ? 'border-primary/50 bg-primary/5'
              : 'border-line-soft bg-surface-1'} {index === 1 ? 'sm:order-3 sm:text-right' : ''}"
          >
            {#if identity && art}
              <TeamLogo
                manifest={art.manifest}
                franchiseId={identity.franchiseId}
                teamExternalId={identity.teamExternalId}
                alt=""
                className="h-8 w-8 {index === 1 ? 'sm:order-2' : ''}"
              />
            {:else}
              <span class="h-8 w-8 shrink-0 rounded-md bg-surface-3" aria-hidden="true"></span>
            {/if}
            <div class="min-w-0 flex-1">
              <p class="font-mono text-[9px] text-muted-foreground uppercase">
                Seed {seedOf(teamId)}
              </p>
              <p class="min-w-0 truncate text-sm font-bold" title={nameOf(teamId)}>
                {nameOf(teamId)}
              </p>
              {#if won}
                <p class="font-mono text-[9px] font-bold text-positive uppercase">Series won</p>
              {/if}
            </div>
            <div class="shrink-0 text-center">
              {#key capRushSeriesWins(userSeries, teamId)}
                <span
                  class="series-wins block font-display text-4xl font-extrabold leading-none tabular-nums {won
                    ? 'text-accent'
                    : 'text-foreground'}">{capRushSeriesWins(userSeries, teamId)}</span
                >
              {/key}
            </div>
          </div>
          {#if index === 0}
            <span
              class="hidden text-center font-mono text-[10px] text-muted-foreground uppercase sm:block sm:order-2"
              >vs</span
            >
          {/if}
        {/each}
      </div>

      {#if userSeries.games.length > 0}
        <ol class="mt-4 flex flex-col gap-1.5" aria-label="Accepted games in this series">
          {#each [...userSeries.games].reverse() as game, index (game.gameId)}
            {@const userHome = game.userSide === 'home'}
            {@const userPoints = userHome ? game.homePoints : game.awayPoints}
            {@const otherPoints = userHome ? game.awayPoints : game.homePoints}
            {@const userWon = game.winnerTeamId === userTeamId}
            <li
              class="game-row flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft bg-surface-1 px-3 py-2 {index ===
              0
                ? 'game-row-latest'
                : ''}"
            >
              <span class="font-mono text-[9px] font-bold text-muted-foreground uppercase"
                >Game {game.gameOrdinal}</span
              >
              <span class="font-mono text-[10px] text-muted-foreground uppercase">
                {userHome ? 'Home' : 'Away'}
              </span>
              <span class="ml-auto font-display text-lg font-extrabold tabular-nums">
                {userPoints}–{otherPoints}
              </span>
              <span
                class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {userWon
                  ? 'border-positive/40 bg-positive/10 text-positive'
                  : 'border-negative/40 bg-negative/10 text-negative'}"
                >{userWon ? 'Win' : 'Loss'}</span
              >
              {#if game.overtimePeriods > 0}
                <span class="font-mono text-[8px] text-muted-foreground uppercase"
                  >OT{game.overtimePeriods > 1 ? ` ${game.overtimePeriods}` : ''}</span
                >
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if standings !== null}
    <CapRushBracket {series} {standings} manifest={art?.manifest ?? null} />
    <CapRushStandings {standings} manifest={art?.manifest ?? null} />
  {:else if awaitingStandings}
    <div class="rounded-2xl border border-line-soft bg-card p-5 text-sm text-muted-foreground">
      <p class="font-display text-lg font-extrabold uppercase">Seeding the bracket</p>
      <p class="mt-1">
        The other thirty teams are finishing their remaining games. This can take a moment; accepted
        results are saved as they arrive.
      </p>
    </div>
  {/if}
</section>

<style>
  .seed-reveal {
    animation: seed-in 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .trophy-banner {
    animation: trophy-in 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .series-wins {
    animation: win-bump 280ms ease-out;
  }
  .game-row-latest {
    animation: score-in 320ms ease-out both;
  }
  .confetti {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
  }
  .confetti span {
    position: absolute;
    top: -10%;
    left: calc((var(--i) + 0.5) * 7%);
    width: 6px;
    height: 10px;
    border-radius: 1px;
    background: var(--color-accent);
    opacity: 0.8;
    animation: confetti-fall 1600ms ease-in both;
    animation-delay: calc(var(--i) * 35ms);
  }
  .confetti span:nth-child(3n) {
    background: var(--color-primary);
  }
  .confetti span:nth-child(4n) {
    background: var(--color-foreground);
  }
  @keyframes seed-in {
    from {
      transform: translateY(-4px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes trophy-in {
    from {
      transform: translateY(10px) scale(0.98);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes win-bump {
    0% {
      transform: scale(1.35);
      color: var(--color-accent);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes score-in {
    from {
      transform: translateY(4px);
      opacity: 0;
    }
    to {
      transform: none;
      opacity: 1;
    }
  }
  @keyframes confetti-fall {
    0% {
      transform: translateY(-20%) rotate(0deg);
      opacity: 0;
    }
    15% {
      opacity: 0.9;
    }
    100% {
      transform: translateY(780%) rotate(540deg);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .seed-reveal,
    .trophy-banner,
    .series-wins,
    .game-row-latest {
      animation: none;
    }
    .confetti {
      display: none;
    }
  }
</style>
