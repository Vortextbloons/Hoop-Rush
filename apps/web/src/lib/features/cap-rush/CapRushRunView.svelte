<script lang="ts">
  import {
    CAP_RUSH_GAME_COUNT,
    type CapRushBoxScore as CapRushBoxScoreData,
  } from '@hoop-rush/data-contracts';
  import { Play, SkipForward, X } from '@lucide/svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import DialogShell from '#lib/components/DialogShell.svelte';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import { capRushBoxOf } from '@hoop-rush/engine';
  import CapRushBoxScore from './CapRushBoxScore.svelte';
  import CapRushLineup from './CapRushLineup.svelte';
  import CapRushPostseasonView from './CapRushPostseasonView.svelte';
  import CapRushSeasonProgress from './CapRushSeasonProgress.svelte';
  import type { CapRushSeasonController } from './cap-rush-season-state.svelte.js';
  import type { CapRushArt } from './cap-rush-art.ts';
  import { formatMillions, recordLabel, variantLabel } from './cap-rush-presentation.ts';

  let {
    controller,
    art = null,
    onReport,
    onNewRun,
  }: {
    controller: CapRushSeasonController;
    art?: CapRushArt | null;
    onReport: () => void;
    onNewRun: () => void;
  } = $props();

  const view = $derived(controller.draft);
  const season = $derived(view?.season ?? null);
  const played = $derived(season?.games.length ?? 0);
  const postseason = $derived(view?.postseason ?? null);
  const inPostseason = $derived(view?.draft.stage === 'postseason' || postseason !== null);
  const complete = $derived(season !== null && season.completedAt !== null);
  const locked = $derived(view?.draft.locked ?? null);
  const franchise = $derived(view?.franchise ?? null);
  const identity = $derived(
    franchise === null || art === null ? null : art.teamFor(franchise.franchiseId),
  );
  const nextEntry = $derived(locked === null ? null : (locked.schedule[played] ?? null));
  const nextOpponent = $derived.by(() => {
    if (locked === null || nextEntry === null) return null;
    return (
      locked.opponents.find((entry) => entry.team.teamId === nextEntry.opponentId)?.team ?? null
    );
  });
  const nextIdentity = $derived(
    nextOpponent === null || art === null ? null : art.teamFor(nextOpponent.teamId),
  );
  const recent = $derived([...controller.games].reverse().slice(0, 5));
  const leagueProgress = $derived(
    season === null || season.leagueGamesTotal === 0
      ? null
      : {
          completed: season.leagueGamesAccepted,
          total: season.leagueGamesTotal,
        },
  );
  let selectedBox = $state<{ label: string; box: CapRushBoxScoreData } | null>(null);

  function openRegularSeasonBox(gameNumber: number): void {
    const stored = controller.games.find((game) => game.gameNumber === gameNumber);
    if (stored === undefined) return;
    selectedBox = {
      label: `Regular season · Game ${gameNumber}`,
      box: capRushBoxOf(stored.result.home, stored.result.away, stored.result.overtimePeriods),
    };
  }
</script>

<section
  class="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6"
  aria-label={inPostseason ? 'Cap Rush postseason' : 'Cap Rush season'}
>
  {#if controller.loading}
    <div class="flex flex-col gap-2">
      <div
        class="h-3 w-40 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
      ></div>
      <div
        class="h-3 w-64 animate-pulse rounded-full bg-surface-2 motion-reduce:animate-none"
      ></div>
    </div>
  {:else if view === null}
    <AsyncState
      kind={controller.error === null ? 'empty' : 'error'}
      title={controller.unsupported
        ? 'This run needs an update'
        : controller.error === null
          ? 'No active Cap Rush run'
          : 'Run unavailable'}
      message={controller.error ?? 'Start a draft to begin an 82-game season.'}
    >
      {#snippet actions()}
        <button
          type="button"
          class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          onclick={onNewRun}
          >{controller.unsupported ? 'Go to draft recovery' : 'Start a Cap Rush run'}</button
        >
      {/snippet}
    </AsyncState>
  {:else if season === null}
    <AsyncState
      kind="empty"
      title="This run is still drafting"
      message="Lock your five to open the season."
    >
      {#snippet actions()}
        <button
          type="button"
          class="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-4 text-sm font-semibold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
          onclick={onNewRun}>Back to the draft</button
        >
      {/snippet}
    </AsyncState>
  {:else if inPostseason && view.postseason !== null}
    <CapRushPostseasonView {controller} {view} {art} {onReport} />
  {:else}
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        {#if identity && art}
          <TeamLogo
            manifest={art.manifest}
            franchiseId={identity.franchiseId}
            teamExternalId={identity.teamExternalId}
            alt=""
            className="h-12 w-12"
          />
        {/if}
        <div class="min-w-0">
          <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
            Cap Rush · {variantLabel(view.draft.variant)}
          </p>
          <h1
            class="font-display mt-1 truncate text-3xl font-extrabold tracking-tight uppercase sm:text-4xl"
          >
            {franchise?.displayName ?? 'Your five'}
          </h1>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="rounded-lg border border-line-soft bg-surface-1 px-3 py-1.5 font-mono text-[10px] uppercase"
          >{recordLabel(season.aggregate.wins, season.aggregate.losses)}</span
        >
        <span
          class="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-[10px] text-accent uppercase"
          >{formatMillions(view.payrollDollars)} payroll</span
        >
      </div>
    </header>

    <div class="mt-4 flex flex-col gap-3">
      {#if view.draft.stage === 'locked' && !complete}
        <section
          class="rounded-2xl border border-primary/30 bg-card p-4 sm:p-5"
          aria-label="Next matchup and simulation controls"
        >
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-primary uppercase">
                Game {played + 1} of {CAP_RUSH_GAME_COUNT} ·
                {nextEntry?.humanHome ? 'Home' : 'Away'}
              </p>
              <div class="mt-2 flex items-center gap-3">
                {#if nextIdentity && art}
                  <TeamLogo
                    manifest={art.manifest}
                    franchiseId={nextIdentity.franchiseId}
                    teamExternalId={nextIdentity.teamExternalId}
                    alt=""
                    className="h-9 w-9"
                  />
                {/if}
                <div class="min-w-0">
                  <p class="font-display truncate text-xl font-extrabold uppercase">
                    {nextEntry?.humanHome ? 'vs' : '@'}
                    {nextOpponent?.displayName ?? 'Opponent'}
                  </p>
                  <p class="font-mono text-[10px] text-muted-foreground uppercase">
                    Record {recordLabel(season.aggregate.wins, season.aggregate.losses)}
                  </p>
                </div>
              </div>
            </div>
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
              {:else}
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => void controller.playNextGame()}
                >
                  <Play size={15} aria-hidden="true" />
                  Sim game
                </button>
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-primary hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => void controller.playSeason()}
                >
                  <SkipForward size={15} aria-hidden="true" />
                  Finish the season
                </button>
              {/if}
            </div>
          </div>

          {#if controller.progress !== null}
            <div
              class="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-label="Season simulation progress"
              aria-valuemin={0}
              aria-valuemax={controller.progress.total}
              aria-valuenow={controller.progress.completed}
            >
              <span
                class="block h-full rounded-full bg-primary motion-reduce:transition-none"
                style:width={`${(controller.progress.completed / controller.progress.total) * 100}%`}
              ></span>
            </div>
          {/if}

          {#if leagueProgress !== null}
            <div class="mt-3">
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-mono text-[9px] tracking-[0.1em] text-muted-foreground uppercase"
                  >League results accepted</span
                >
                <span class="font-mono text-[10px] tabular-nums"
                  >{leagueProgress.completed}/{leagueProgress.total}</span
                >
              </div>
              <div
                class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-3"
                role="progressbar"
                aria-label="Background league progress"
                aria-valuemin={0}
                aria-valuemax={leagueProgress.total}
                aria-valuenow={leagueProgress.completed}
              >
                <span
                  class="block h-full rounded-full bg-accent motion-reduce:transition-none"
                  style:width={`${(leagueProgress.completed / leagueProgress.total) * 100}%`}
                ></span>
              </div>
            </div>
          {/if}

          {#if controller.notice !== null}
            <p class="mt-3 text-xs font-semibold text-muted-foreground" role="status">
              {controller.notice}
            </p>
          {/if}
        </section>
      {:else if complete}
        <section
          class="rounded-2xl border border-primary/30 bg-card p-4 sm:p-5"
          aria-label="Season complete"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-primary uppercase">
                Regular season complete
              </p>
              <p class="font-display mt-1 text-2xl font-extrabold uppercase">
                {recordLabel(season.aggregate.wins, season.aggregate.losses)}
                {#if season.aggregate.perfectSeason}
                  · 82–0{/if}
              </p>
            </div>
            <button
              type="button"
              class="inline-flex min-h-11 items-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              onclick={onReport}>Open the final report</button
            >
          </div>
        </section>
      {:else}
        <div class="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p class="text-sm font-semibold">
            {view.draft.stage === 'abandoned' ? 'This run was abandoned.' : 'Season complete.'}
          </p>
        </div>
      {/if}

      {#if recent.length > 0}
        <section
          class="rounded-2xl border border-border bg-card p-4 sm:p-5"
          aria-label="Recent results"
        >
          <div class="flex items-baseline justify-between gap-2">
            <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-primary uppercase">
              Recent results
            </p>
            <span class="font-mono text-[9px] text-muted-foreground uppercase">accepted games</span>
          </div>
          <ol class="mt-3 flex flex-col gap-1">
            {#each recent as game (game.gameNumber)}
              {@const won = game.summary.won}
              <li>
                <button
                  type="button"
                  class="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line-soft px-3 py-2 text-left outline-none hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
                  onclick={() => openRegularSeasonBox(game.gameNumber)}
                >
                  <span class="font-mono text-[9px] text-muted-foreground uppercase"
                    >G{game.gameNumber}</span
                  >
                  <span class="font-mono text-[9px] text-muted-foreground uppercase"
                    >{game.summary.humanHome ? 'vs' : '@'}</span
                  >
                  <span class="min-w-0 flex-1 truncate text-[11px] font-semibold">
                    {locked?.opponents.find(
                      (entry) => entry.team.teamId === game.summary.opponentId,
                    )?.team.displayName ?? game.summary.opponentId}
                  </span>
                  <span class="font-display text-base font-extrabold tabular-nums">
                    {game.summary.humanPoints}–{game.summary.opponentPoints}
                  </span>
                  <span
                    class="rounded-full border px-2 py-0.5 font-mono text-[8px] font-bold uppercase {won
                      ? 'border-positive/40 bg-positive/10 text-positive'
                      : 'border-negative/40 bg-negative/10 text-negative'}">{won ? 'W' : 'L'}</span
                  >
                </button>
              </li>
            {/each}
          </ol>
        </section>
      {/if}

      <CapRushSeasonProgress draft={view.draft} {season} storedGames={controller.games} {art} />
      <CapRushLineup slots={view.slots} {art} />

      {#if controller.error !== null}
        <div
          role="alert"
          class="rounded-xl border border-negative/40 bg-negative/10 p-4 text-sm text-negative"
        >
          {controller.error}
          {#if controller.unsupported}
            <p class="mt-2 text-[11px] text-muted-foreground">
              This run was created with different engine, bracket or data versions and cannot be
              resumed.
            </p>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

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
    <CapRushBoxScore
      box={selectedBox.box}
      label={selectedBox.label}
      userTeamId={locked?.human.teamId ?? null}
    />
  {/if}
</DialogShell>
