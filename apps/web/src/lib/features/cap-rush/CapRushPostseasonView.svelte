<script lang="ts">
  import {
    CAP_RUSH_SERIES_WINS,
    capRushConferenceStandingsEntries,
    capRushConferenceRoundName,
    capRushRoundName,
    isConferencePostseason,
    isConferenceStandings,
    type CapRushBoxScore as CapRushBoxScoreData,
    type CapRushConferenceStandings,
    type CapRushPlayoffSeries,
    type CapRushPostseasonStandings,
    type CapRushStoredPlayoffGame,
  } from '@hoop-rush/data-contracts';
  import { Play, SkipForward, Trophy, X } from '@lucide/svelte';
  import type { CapRushDraftView } from '@hoop-rush/application/cap-rush';
  import { capRushBoxOf } from '@hoop-rush/engine';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import type { CapRushSeasonController } from './cap-rush-season-state.svelte.js';
  import CapRushBracket from './CapRushBracket.svelte';
  import CapRushBoxScore from './CapRushBoxScore.svelte';
  import CapRushStandings from './CapRushStandings.svelte';
  import CapRushTeamDetail from './CapRushTeamDetail.svelte';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatAverage, initialsOf, recordLabel } from './cap-rush-presentation.ts';

  let {
    controller,
    view,
    art = null,
    onReport,
  }: {
    controller: CapRushSeasonController;
    view: CapRushDraftView;
    art?: CapRushArt | null;
    onReport: () => void;
  } = $props();

  const postseason = $derived(view.postseason);
  const conferencePostseason = $derived(
    postseason !== null && isConferencePostseason(postseason) ? postseason : null,
  );
  const standings = $derived(postseason?.standings ?? null);
  const series = $derived(postseason?.series ?? []);
  const userTeamId = $derived(view.draft.locked?.human.teamId ?? null);
  const entries = $derived.by(() => {
    if (standings === null) return [];
    return isConferenceStandings(standings)
      ? capRushConferenceStandingsEntries(standings as CapRushConferenceStandings)
      : (standings as CapRushPostseasonStandings).entries;
  });
  const userEntry = $derived(
    userTeamId === null ? null : (entries.find((entry) => entry.teamId === userTeamId) ?? null),
  );
  const userConference = $derived(
    userEntry !== null && 'conference' in userEntry
      ? (userEntry as { conference: 'east' | 'west' }).conference
      : null,
  );
  const latestRound = $derived(
    series.length === 0 ? 1 : Math.max(...series.map((entry) => entry.round)),
  );
  const userSeries = $derived(
    userTeamId === null
      ? null
      : (series.find(
          (entry) =>
            entry.round === latestRound &&
            (entry.highTeamId === userTeamId || entry.lowTeamId === userTeamId),
        ) ?? null),
  );
  const storedByGame = $derived(
    new Map(controller.playoffGames.map((game) => [game.gameId, game])),
  );
  const seriesGames = $derived(userSeries === null ? [] : [...userSeries.games].slice().reverse());
  const championEntry = $derived(
    postseason?.championTeamId === null || postseason?.championTeamId === undefined
      ? null
      : (entries.find((entry) => entry.teamId === postseason.championTeamId) ?? null),
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
  const userSeriesActive = $derived(
    userSeries !== null &&
      seriesWins(userSeries, userSeries.highTeamId) < 4 &&
      seriesWins(userSeries, userSeries.lowTeamId) < 4,
  );

  let selectedTeamId = $state<string | null>(null);
  let selectedBox = $state<{ label: string; box: CapRushBoxScoreData } | null>(null);

  const roundName = $derived(
    conferencePostseason !== null ? capRushConferenceRoundName : capRushRoundName,
  );

  function seriesWins(entry: CapRushPlayoffSeries, teamId: string): number {
    return entry.games.filter((game) => game.winnerTeamId === teamId).length;
  }

  function nameOf(teamId: string): string {
    return entries.find((entry) => entry.teamId === teamId)?.displayName ?? teamId;
  }

  function seedOf(teamId: string): number {
    return entries.find((entry) => entry.teamId === teamId)?.seed ?? 0;
  }

  function identityOf(teamId: string) {
    return art === null ? null : art.teamFor(teamId);
  }

  function actionLabel(): string {
    if (awaitingStandings) return 'Complete league standings';
    if (finalsReady || postseason?.phase === 'complete') return 'Open the final report';
    if (postseason?.userOutcome.status === 'not-qualified') return 'Finish the bracket';
    if (postseason?.userOutcome.status === 'eliminated') return 'Finish the bracket';
    if (
      userSeries !== null &&
      seriesWins(userSeries, userSeries.highTeamId) < 4 &&
      seriesWins(userSeries, userSeries.lowTeamId) < 4
    ) {
      return 'Sim game';
    }
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
      return `Out in the ${roundName(postseason.userOutcome.round ?? 1).toLowerCase()}.`;
    }
    if (awaitingStandings) return 'The regular season is in the books.';
    if (latestRound === 4) return 'The NBA Finals.';
    if (latestRound === 1) return 'The first round is live.';
    return `${roundName(latestRound)} is live.`;
  }

  function statusMessage(): string {
    if (postseason === null) return 'Finish the regular season to reach the bracket.';
    if (postseason.phase === 'complete') {
      return `${championEntry?.displayName ?? 'The champion'} won the championship.`;
    }
    if (postseason.userOutcome.status === 'not-qualified') {
      return `You finished ${userEntry?.seed ?? '—'} in the ${userEntry && 'conference' in userEntry ? userEntry.conference : ''} conference at ${recordLabel(userEntry?.wins ?? 0, userEntry?.losses ?? 0)} and missed the top eight.`;
    }
    if (postseason.userOutcome.status === 'eliminated') {
      return `The ${roundName(postseason.userOutcome.round ?? 1)} ended your run. The rest of the bracket is finishing without you.`;
    }
    if (awaitingStandings) {
      return 'Every team has played 82 games. Accept the final conference tables to seed the bracket.';
    }
    if (userSeries === null) {
      return 'Your run is over. The remaining bracket will finish automatically.';
    }
    if (!userSeriesActive) {
      return 'Your series is decided. The rest of the round must finish before the next round opens.';
    }
    return 'One game at a time. Your locked lineup, apron effects and spin carry over.';
  }

  function openBox(game: CapRushStoredPlayoffGame): void {
    const box = game.summary.box;
    if (box === undefined) return;
    selectedBox = {
      label: `${roundName(game.summary.round)} · Game ${game.summary.gameOrdinal}`,
      box,
    };
  }

  function boxOfStored(game: CapRushStoredPlayoffGame): CapRushBoxScoreData | null {
    if (game.summary.box !== undefined) return game.summary.box;
    if (game.result === null) return null;
    return capRushBoxOf(game.result.home, game.result.away, game.result.overtimePeriods);
  }

  function openSeriesBox(game: CapRushPlayoffSeries['games'][number]): void {
    const stored = storedByGame.get(game.gameId);
    if (stored === undefined) {
      if (game.box !== undefined) {
        selectedBox = {
          label: `${roundName(game.round)} · Game ${game.gameOrdinal}`,
          box: game.box,
        };
      }
      return;
    }
    const box = boxOfStored(stored);
    if (box === null) return;
    selectedBox = {
      label: `${roundName(stored.summary.round)} · Game ${stored.summary.gameOrdinal}`,
      box,
    };
  }
</script>

<section class="cap-rush-broadcast flex flex-col gap-4" aria-label="Cap Rush postseason">
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
          class="seed-reveal rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-[10px] font-bold text-accent uppercase"
          >{conferencePostseason !== null && userConference !== null
            ? `${userConference} seed ${userEntry.seed}`
            : `Seed ${userEntry.seed}`} · {recordLabel(userEntry.wins, userEntry.losses)}</span
        >
      {:else if awaitingStandings}
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
            Four rounds. Four wins each. The championship is yours.
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
              class="font-display inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-surface-3 text-xl font-extrabold"
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
          onclick={() => controller.cancel()}
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
      {:else}
        <button
          type="button"
          class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          onclick={() =>
            void (awaitingStandings || !userSeriesActive
              ? controller.advancePostseason()
              : controller.playNextGame())}
        >
          <Play size={15} aria-hidden="true" />
          {actionLabel()}
        </button>
        {#if userSeriesActive}
          <button
            type="button"
            class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onclick={() => void controller.simSeries()}
          >
            <SkipForward size={15} aria-hidden="true" />
            Sim series
          </button>
        {/if}
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
    <section class="matchup-panel rounded-2xl p-4 sm:p-6" aria-label="Current series">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-accent uppercase">
          {roundName(userSeries.round)} ·
          {userSeriesActive
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
          {@const won = seriesWins(userSeries, teamId) >= CAP_RUSH_SERIES_WINS}
          <div
            class="flex min-w-0 items-center gap-3 rounded-xl border p-3 {teamId === userTeamId
              ? 'border-primary/50 bg-primary/10'
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
              <button
                type="button"
                class="block min-w-0 max-w-full truncate text-left text-sm font-bold outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring sm:text-right"
                title={nameOf(teamId)}
                onclick={() => (selectedTeamId = teamId)}
              >
                {nameOf(teamId)}
              </button>
              {#if won}
                <p class="font-mono text-[9px] font-bold text-positive uppercase">Series won</p>
              {/if}
            </div>
            <div class="shrink-0 text-center">
              {#key seriesWins(userSeries, teamId)}
                <span
                  class="series-wins font-display block text-4xl font-extrabold leading-none tabular-nums {won
                    ? 'text-accent'
                    : 'text-foreground'}">{seriesWins(userSeries, teamId)}</span
                >
              {/key}
            </div>
          </div>
          {#if index === 0}
            <span
              class="font-mono hidden text-center text-[10px] text-muted-foreground uppercase sm:order-2 sm:block"
              >vs</span
            >
          {/if}
        {/each}
      </div>

      {#if seriesGames.length > 0}
        <ol class="mt-4 flex flex-col gap-1.5" aria-label="Accepted games in this series">
          {#each seriesGames as game, index (game.gameId)}
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
              <button
                type="button"
                class="font-display ml-auto rounded text-lg font-extrabold tabular-nums outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                onclick={() => openSeriesBox(game)}
              >
                {userPoints}–{otherPoints}
              </button>
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
    <CapRushBracket
      {series}
      {standings}
      manifest={art?.manifest ?? null}
      {userTeamId}
      onTeamSelect={(teamId) => (selectedTeamId = teamId)}
    />
    <CapRushStandings
      {standings}
      manifest={art?.manifest ?? null}
      {userTeamId}
      onTeamSelect={(teamId) => (selectedTeamId = teamId)}
    />
  {:else if awaitingStandings}
    <div class="rounded-2xl border border-line-soft bg-card p-5 text-sm text-muted-foreground">
      <p class="font-display text-lg font-extrabold uppercase">Seeding the bracket</p>
      <p class="mt-1">
        The conference tables are finalising. Accepted results are saved as they arrive.
      </p>
    </div>
  {/if}
</section>

<DialogShell
  open={selectedTeamId !== null}
  onOpenChange={(open) => {
    if (!open) selectedTeamId = null;
  }}
  size="xl"
  layout="center"
  headerClass="mb-4"
>
  {#snippet header()}
    <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
      Team detail
    </p>
  {/snippet}
  {#if selectedTeamId !== null && view.draft.locked !== null && standings !== null}
    <CapRushTeamDetail
      teamId={selectedTeamId}
      locked={view.draft.locked}
      {standings}
      leagueGames={controller.leagueGames}
      {art}
      onGameSelect={(game) => {
        selectedTeamId = null;
        selectedBox = {
          label: `League game · Slot ${game.slot}`,
          box: game.box,
        };
      }}
    />
  {/if}
</DialogShell>

<DialogShell
  open={selectedBox !== null}
  onOpenChange={(open) => {
    if (!open) selectedBox = null;
  }}
  size="xl"
  layout="sheet"
  grabHandle={true}
>
  {#snippet header()}
    <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
      Box score
    </p>
    <p class="font-display text-lg font-extrabold tracking-tight uppercase">
      {selectedBox?.label ?? ''}
    </p>
  {/snippet}
  {#if selectedBox !== null}
    <CapRushBoxScore box={selectedBox.box} label={selectedBox.label} {userTeamId} />
  {/if}
</DialogShell>

<style>
  .cap-rush-broadcast {
    --cr-navy: #101b30;
    --cr-panel: #1d3352;
    --cr-slate: #52647c;
    --cr-ice: #f4f7fb;
    --cr-muted: #b7c5d8;
    --cr-gold: #e7bb55;
  }
  .matchup-panel {
    border: 1px solid color-mix(in srgb, var(--cr-slate) 55%, transparent);
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--cr-panel) 82%, transparent), transparent),
      var(--color-card);
    color: var(--cr-ice);
  }
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
    background: var(--cr-gold);
    opacity: 0.8;
    animation: confetti-fall 1600ms ease-in both;
    animation-delay: calc(var(--i) * 35ms);
  }
  .confetti span:nth-child(3n) {
    background: var(--color-primary);
  }
  .confetti span:nth-child(4n) {
    background: var(--cr-ice);
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
      color: var(--cr-gold);
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
