<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { X } from '@lucide/svelte';
  import type { ChallengeRun, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { BEST_OF_ATTEMPTS, evaluateLineupMatchup } from '@hoop-rush/engine';
  import type { RunnerPhase } from '$lib/challenge-runner';
  import GameStrip from '$lib/components/GameStrip.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  /**
   * Challenge progress overlay (spec/08): the full-screen presentation shared
   * by Sandbox and Classic. The 82-cell strip fills left to right; the
   * currently revealed opponent, game number, score, and live record sit
   * directly above it. The owning route drives the runner lifecycle and the
   * bounded announcements; this component only presents accepted run state
   * and issues the Cancel / Continue / Retry commands.
   */

  let {
    manifest,
    run,
    phase,
    error,
    modeLabel,
    draftHref,
    resultHref,
    onCancel,
    onResume,
  }: {
    manifest: HoopRushManifest | null;
    run: ChallengeRun;
    phase: RunnerPhase;
    error: string | null;
    modeLabel: string;
    draftHref: string;
    resultHref: string | null;
    onCancel: () => void;
    onResume: () => void;
  } = $props();

  function franchiseLabel(franchiseId: string | null): string {
    return franchiseId ? franchiseAbbreviation(franchiseId) : 'Mixed';
  }

  const record = $derived(run.aggregates.team);
  const latest = $derived(run.games.at(-1) ?? null);
  const latestOpponent = $derived.by(() => {
    if (!latest) return null;
    const entry = run.bracket.schedule[latest.gameNumber - 1];
    return run.bracket.opponents.find((o) => o.opponentId === entry?.opponentId) ?? null;
  });

  const upcomingOpponent = $derived.by(() => {
    const entry = run.bracket.schedule[run.games.length];
    return run.bracket.opponents.find((o) => o.opponentId === entry?.opponentId) ?? null;
  });

  const upcomingMatchup = $derived.by(() => {
    if (!upcomingOpponent || run.players.length !== 5) return null;
    return evaluateLineupMatchup(
      { teamId: 'user', displayName: run.homeDisplayName, players: run.players },
      {
        teamId: upcomingOpponent.teamId,
        displayName: upcomingOpponent.displayName,
        players: upcomingOpponent.players,
      },
    );
  });

  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === run.franchiseId) ?? null,
  );
</script>

<!-- Full-screen presentation overlay -->
<div
  class="fixed inset-0 z-50 overflow-y-auto bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90"
>
  <div class="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 py-8 sm:px-6">
    <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
      {modeLabel} · {franchiseLabel(run.franchiseId)} · {run.eraId}
    </p>
    <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
      {#if phase === 'paused'}
        Challenge paused
      {:else if phase === 'error'}
        Challenge stopped
      {:else}
        Playing the season
      {/if}
    </h1>

    <!-- Live scoreboard -->
    <div
      class="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-line-strong bg-card p-4 shadow-[0_0_24px_hsl(13_100%_62%/0.12)] sm:p-6"
    >
      <div class="flex min-w-0 items-center gap-2 sm:gap-3">
        {#if franchise && manifest}
          <TeamLogo
            {manifest}
            franchiseId={franchise.franchiseId}
            teamExternalId={franchise.teamExternalId}
            alt=""
            className="h-7 w-7 sm:h-8 sm:w-8"
          />
        {/if}
        <div class="min-w-0">
          <p
            class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-base"
          >
            {run.homeDisplayName}
          </p>
          <p class="font-mono text-[10px] text-muted-foreground">
            {franchiseLabel(run.franchiseId)} · {run.eraId}
          </p>
        </div>
      </div>
      <div class="flex flex-col items-center gap-1">
        <p class="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">
          <span class={latest?.winner === 'home' ? 'text-primary' : 'text-muted-foreground'}>
            {latest?.home.box.points ?? '–'}
          </span>
          <span class="mx-2 text-muted-foreground">–</span>
          <span class={latest?.winner === 'away' ? 'text-primary' : 'text-muted-foreground'}>
            {latest?.away.box.points ?? '–'}
          </span>
        </p>
        <p class="rounded-full border border-border px-3 py-0.5 font-mono text-[10px] uppercase">
          Game {run.games.length}{run.games.length === 82 ? ' · final' : ''} · {record?.wins ?? 0}-
          {record?.losses ?? 0}
        </p>
      </div>
      <div class="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
        {#if latestOpponent && manifest}
          <TeamLogo
            {manifest}
            franchiseId={latestOpponent.teamId}
            teamExternalId={franchise?.teamExternalId ?? ''}
            alt=""
            className="h-7 w-7 sm:h-8 sm:w-8"
          />
        {/if}
        <div class="min-w-0 text-right">
          <p
            class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-base"
          >
            {latestOpponent?.displayName ?? 'Waiting for the first tip…'}
          </p>
          <p class="font-mono text-[10px] text-muted-foreground">
            {latestOpponent?.seasonKey ?? 'Medium difficulty'}
          </p>
        </div>
      </div>
    </div>

    {#if upcomingOpponent && upcomingMatchup}
      <div class="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="font-mono text-[10px] tracking-[0.14em] text-primary uppercase">
            Next matchup · {upcomingOpponent.displayName}
          </p>
          <span class="font-mono text-xs font-bold"
            >MATCHUP {upcomingMatchup.matchupDelta > 0
              ? '+'
              : ''}{upcomingMatchup.matchupDelta}</span
          >
        </div>
        {#if upcomingMatchup.reasons[0]}
          <p class="mt-2 text-xs text-muted-foreground">
            <span class="font-semibold text-foreground">{upcomingMatchup.reasons[0].label}.</span>
            Measured {upcomingMatchup.reasons[0].measuredValue.toFixed(0)} vs
            {upcomingMatchup.reasons[0].comparisonValue.toFixed(0)}.
          </p>
        {/if}
      </div>
    {/if}

    <!-- The 82-cell strip -->
    <div class="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <GameStrip {run} games={run.games} />
      <div class="mt-3 flex flex-wrap items-center gap-4 font-mono text-[10px] uppercase">
        <span class="flex items-center gap-1.5 text-muted-foreground">
          <span class="h-2 w-2 rounded-sm bg-primary/80" aria-hidden="true"></span>
          Win
        </span>
        <span class="flex items-center gap-1.5 text-muted-foreground">
          <span class="h-2 w-2 rounded-sm bg-destructive/70" aria-hidden="true"></span>
          Loss
        </span>
        {#if run.firstLossGameNumber !== null && run.firstLossGameNumber <= run.games.length}
          <span class="flex items-center gap-1.5 text-muted-foreground">
            <span
              class="h-2 w-2 rounded-sm bg-destructive shadow-[0_0_0_2px_hsl(var(--destructive))]"
              aria-hidden="true"
            ></span>
            First loss
          </span>
        {/if}
        <span class="ml-auto text-muted-foreground">
          {run.games.length}/82 committed
        </span>
      </div>
    </div>

    <!-- Actions -->
    <div class="mt-6 flex flex-wrap items-center gap-3">
      {#if phase === 'running'}
        <button
          type="button"
          onclick={onCancel}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X class="h-4 w-4" />
          Cancel
        </button>
      {:else if phase === 'paused'}
        <button
          type="button"
          onclick={onResume}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Continue
        </button>
        <a
          href={resolve(draftHref as RouteId)}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          Leave the challenge
        </a>
      {:else if phase === 'error' && error}
        <button
          type="button"
          onclick={onResume}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Retry
        </button>
        <a
          href={resolve((resultHref ?? draftHref) as RouteId)}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          View progress so far
        </a>
      {/if}
      {#if phase === 'error' && error}
        <p class="w-full text-sm text-destructive">{error}</p>
      {/if}
    </div>

    <p class="mt-4 font-mono text-[10px] text-muted-foreground">
      seed {run.runSeed} · best of {BEST_OF_ATTEMPTS} · engine {run.versions.engineVersion}
      · bracket {run.versions.bracketVersion}
      · schedule {run.versions.scheduleVersion}
    </p>
  </div>
</div>
