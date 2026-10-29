<script lang="ts">
  import { CAP_RUSH_GAME_COUNT } from '@hoop-rush/data-contracts';
  import { Play, X } from '@lucide/svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import CapRushLineup from './CapRushLineup.svelte';
  import CapRushSeasonProgress from './CapRushSeasonProgress.svelte';
  import type { CapRushSeasonController } from './cap-rush-season-state.svelte.js';
  import type { CapRushArt } from './cap-rush-art.ts';

  let {
    controller,
    art = null,
    onPlay,
    onCancel,
    onReport,
    onNewRun,
  }: {
    controller: CapRushSeasonController;
    art?: CapRushArt | null;
    onPlay: () => void;
    onCancel: () => void;
    onReport: () => void;
    onNewRun: () => void;
  } = $props();

  const view = $derived(controller.draft);
  const season = $derived(view?.season ?? null);
  const played = $derived(season?.games.length ?? 0);
  const complete = $derived(season !== null && season.completedAt !== null);
</script>

<section class="mx-auto w-full max-w-5xl px-3 py-4 sm:px-6 sm:py-6" aria-label="Cap Rush season">
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
  {:else}
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.18em] text-primary uppercase">
          Cap Rush · Season
        </p>
        <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
          {#if complete}
            Season complete.
          {:else if played > 0}
            Building the record.
          {:else}
            Let the season tip off.
          {/if}
        </h1>
      </div>
      <span class="font-mono text-[10px] text-muted-foreground uppercase">
        {played} / {CAP_RUSH_GAME_COUNT}
      </span>
    </header>

    <div class="mt-4 flex flex-col gap-3">
      {#if view.draft.stage === 'locked'}
        <div class="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div class="flex flex-wrap items-center gap-2">
            {#if controller.busy}
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-negative hover:text-negative focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                disabled={controller.cancelling}
                onclick={onCancel}
              >
                <X size={15} aria-hidden="true" />
                {controller.cancelling ? 'Pausing…' : 'Pause season'}
              </button>
            {:else}
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                onclick={onPlay}
              >
                <Play size={15} aria-hidden="true" />
                {played > 0 ? 'Continue the season' : 'Play the 82-game season'}
              </button>
            {/if}
            <span class="text-[11px] text-muted-foreground">
              {#if controller.progress !== null}
                Simulating {controller.progress.completed} of {controller.progress.total} games in this
                batch…
              {:else}
                Your progress is saved as games finish.
              {/if}
            </span>
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

          {#if controller.notice !== null}
            <p class="mt-3 text-xs font-semibold text-muted-foreground" role="status">
              {controller.notice}
            </p>
          {/if}
        </div>
      {:else}
        <div class="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p class="text-sm font-semibold">
            {view.draft.stage === 'abandoned' ? 'This run was abandoned.' : 'Season complete.'}
          </p>
          {#if complete}
            <button
              type="button"
              class="mt-3 inline-flex min-h-11 items-center rounded-xl border border-primary/50 bg-primary/10 px-4 text-sm font-bold text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              onclick={onReport}>Open the final report</button
            >
          {/if}
        </div>
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
