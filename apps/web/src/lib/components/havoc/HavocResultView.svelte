<script lang="ts">
  import { resolve } from '$app/paths';
  import { HAVOC_GAME_COUNT } from '@hoop-rush/data-contracts';
  import type { HavocResultState } from '$lib/havoc/havoc-result-state.svelte';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocMvpCard from './HavocMvpCard.svelte';
  import {
    havocComparisonStatusLabel,
    havocObjectiveStatusOf,
    havocRecordLabel,
  } from './havoc-presentation';

  let { state }: { state: HavocResultState } = $props();

  const run = $derived(state.run);
  const objective = $derived(run === null ? null : havocObjectiveStatusOf(run));
  const havocComplete = $derived((run?.havocCursor ?? 0) >= HAVOC_GAME_COUNT);
  const normalCompleted = $derived(
    state.progress?.variant === 'normal'
      ? state.progress.gamesCompleted
      : state.normalGamesCompleted,
  );
  const progressPercent = $derived(
    Math.round((Math.min(HAVOC_GAME_COUNT, normalCompleted) / HAVOC_GAME_COUNT) * 100),
  );
  const pendingLabel = $derived(
    run !== null && run.normalCursor >= HAVOC_GAME_COUNT
      ? 'Finish comparison'
      : run?.comparisonStatus === 'running'
        ? 'Resume normal season'
        : 'Run normal season',
  );
</script>

<section class="mx-auto w-full max-w-6xl px-3 py-6 sm:px-6 sm:py-10" data-havoc-result>
  {#if state.loading}
    <p class="font-mono text-sm text-muted-foreground" aria-live="polite">
      Loading the season result…
    </p>
  {:else if run === null}
    <div class="mx-auto w-full max-w-xl rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        No active Havoc run
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        Season results appear here once a run reaches game 82.
      </p>
      <a
        href={resolve('/havoc')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Go to Havoc setup
      </a>
    </div>
  {:else if run.phase === 'draft'}
    <div class="mx-auto w-full max-w-xl rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Finish the draft first
      </h1>
      <a
        href={resolve('/havoc')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Continue draft
      </a>
    </div>
  {:else if !havocComplete}
    <div class="mx-auto w-full max-w-xl rounded-xl bg-surface-1 p-6">
      <h1 class="font-display text-xl font-extrabold tracking-tight uppercase">
        Season in progress
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        {run.havocCursor} of {HAVOC_GAME_COUNT} games played. The comparison unlocks after game 82.
      </p>
      <a
        href={resolve('/havoc/run')}
        class="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
      >
        Back to the hub
      </a>
    </div>
  {:else}
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div class="min-w-0">
        <p class="font-mono text-[10px] font-bold tracking-[0.16em] text-primary uppercase">
          Hoop Havoc · Season complete
        </p>
        <h1 class="font-display mt-1 text-4xl font-extrabold tracking-tight uppercase">
          {havocRecordLabel(run.havocWins, run.havocLosses)}
        </h1>
        {#if objective !== null}
          <p class="mt-1 text-sm font-semibold" data-havoc-result-objective>
            {objective.label} — {objective.detail}
          </p>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <a
          href={run === null
            ? resolve('/havoc/history')
            : resolve('/havoc/history/[runId]', { runId: run.runId })}
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Full report
        </a>
        <a
          href={resolve('/havoc/run')}
          class="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back to hub
        </a>
      </div>
    </header>

    {#if state.report !== null}
      <dl class="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div class="rounded-xl bg-surface-1 p-3">
          <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            Points for
          </dt>
          <dd class="font-mono text-lg font-bold">{state.report.havoc.pointsFor}</dd>
        </div>
        <div class="rounded-xl bg-surface-1 p-3">
          <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            Points against
          </dt>
          <dd class="font-mono text-lg font-bold">{state.report.havoc.pointsAgainst}</dd>
        </div>
        <div class="rounded-xl bg-surface-1 p-3">
          <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            Differential
          </dt>
          <dd class="font-mono text-lg font-bold">{state.report.havoc.differential}</dd>
        </div>
        <div class="rounded-xl bg-surface-1 p-3">
          <dt class="font-mono text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
            Direct mutation points
          </dt>
          <dd class="font-mono text-lg font-bold" data-havoc-direct-mutation-points>
            {state.report.directMutationPoints}
          </dd>
        </div>
      </dl>
    {/if}

    {#if run.comparisonStatus === 'unsupported'}
      <section
        class="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-4"
        data-havoc-comparison-unsupported
      >
        <h2 class="font-display text-base font-extrabold tracking-tight uppercase">
          Normal comparison unsupported
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          This run was recorded with engine, rule, or data versions that cannot be replayed
          faithfully. The Havoc results stand; the baseline season is not simulated under different
          rules.
        </p>
      </section>
    {:else if state.comparisonComplete && state.comparison !== null}
      <div class="mt-4 flex flex-col gap-4">
        <HavocMvpCard comparison={state.comparison} />
        <HavocComparisonView comparison={state.comparison} />
      </div>
    {:else}
      <section
        aria-labelledby="havoc-comparison-pending"
        class="mt-4 rounded-xl bg-surface-1 p-4 sm:p-5"
        data-havoc-comparison-pending
      >
        <div class="flex flex-wrap items-end justify-between gap-3">
          <div class="min-w-0">
            <h2
              id="havoc-comparison-pending"
              class="font-display text-lg font-extrabold tracking-tight uppercase"
            >
              Normal season · hidden until complete
            </h2>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              The same 82 opponents and seeds are replayed without mutations. Baseline scores,
              records, and the chart are revealed together when the normal season finishes — never
              early.
            </p>
            <p class="mt-1 font-mono text-xs text-muted-foreground" data-havoc-comparison-progress>
              {normalCompleted} / {HAVOC_GAME_COUNT} normal games · status:
              {havocComparisonStatusLabel(run.comparisonStatus)}
            </p>
          </div>
          <span class="font-mono text-xs text-muted-foreground">{progressPercent}%</span>
        </div>
        <div
          class="mt-3 h-2 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-label="Normal season progress"
          aria-valuemin="0"
          aria-valuemax={HAVOC_GAME_COUNT}
          aria-valuenow={Math.min(HAVOC_GAME_COUNT, normalCompleted)}
        >
          <div
            class="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style="width: {progressPercent}%"
          ></div>
        </div>
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            data-havoc-run-normal
            onclick={() => void state.runNormalSeason()}
            disabled={state.busy}
            class="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 py-3 text-xs font-extrabold tracking-wide text-primary-foreground uppercase outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state.busy ? 'Simulating…' : pendingLabel}
          </button>
          {#if state.busy}
            <button
              type="button"
              data-havoc-cancel-comparison
              onclick={() => void state.cancelComparison()}
              disabled={state.cancelling}
              class="inline-flex min-h-11 items-center justify-center rounded-lg border border-destructive/50 px-4 py-2 text-xs font-semibold text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
            >
              {state.cancelling ? 'Stopping…' : 'Cancel at game boundary'}
            </button>
          {/if}
        </div>
        {#if state.notice !== null}
          <p role="status" class="mt-3 rounded-lg bg-surface-2 p-3 text-xs">{state.notice}</p>
        {/if}
      </section>
    {/if}

    {#if state.error !== null}
      <p
        role="alert"
        class="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs"
      >
        {state.error}
      </p>
    {/if}
  {/if}
</section>
