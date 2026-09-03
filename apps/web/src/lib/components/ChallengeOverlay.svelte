<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { X } from '@lucide/svelte';
  import type { ChallengeRun, HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import type { RunnerPhase } from '$lib/challenge-runner';
  import GameStrip from '$lib/components/GameStrip.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';
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
  const franchise = $derived(
    manifest?.modernFranchiseSlots.find((e) => e.franchiseId === run.franchiseId) ?? null,
  );
  const latestOpponentSlot = $derived(
    latestOpponent && manifest
      ? (manifest.modernFranchiseSlots.find((e) => e.franchiseId === latestOpponent.teamId) ?? null)
      : null,
  );
  $effect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
</script>

<div
  class="fixed inset-0 z-50 overflow-x-hidden overflow-y-auto overscroll-none bg-background [scrollbar-gutter:stable]"
>
  <div class="mx-auto flex w-full max-w-4xl flex-col px-4 py-8 sm:px-6 sm:py-10">
    <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
      {modeLabel} · {franchiseLabel(run.franchiseId)}
    </p>
    <h1 class="font-display mt-2 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl">
      {#if phase === 'paused'}
        Paused
      {:else if phase === 'error'}
        Stopped
      {:else}
        Playing
      {/if}
    </h1>

    <div
      class="mt-6 grid grid-cols-[minmax(0,1fr)_9.5rem_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-line-strong bg-card p-4 shadow-[0_0_24px_hsl(13_100%_62%/0.12)] sm:grid-cols-[minmax(0,1fr)_12rem_minmax(0,1fr)] sm:p-6"
    >
      <div class="flex min-w-0 items-center gap-2 sm:gap-3">
        <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center sm:h-8 sm:w-8">
          {#if franchise && manifest}
            <TeamLogo
              {manifest}
              franchiseId={franchise.franchiseId}
              teamExternalId={franchise.teamExternalId}
              alt=""
              className="h-7 w-7 sm:h-8 sm:w-8"
            />
          {/if}
        </span>
        <div class="min-w-0">
          <p
            class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-base"
          >
            {run.homeDisplayName}
          </p>
          <p class="font-mono text-[10px] text-muted-foreground">
            {franchiseLabel(run.franchiseId)}
          </p>
        </div>
      </div>
      <div class="flex w-full flex-col items-center gap-1">
        <p
          class="font-mono flex w-full items-baseline justify-center gap-2 text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl"
        >
          <span
            class="inline-block w-[3ch] text-right {latest?.winner === 'home'
              ? 'text-primary'
              : 'text-muted-foreground'}"
          >
            {latest?.home.box.points ?? '–'}
          </span>
          <span class="text-muted-foreground" aria-hidden="true">–</span>
          <span
            class="inline-block w-[3ch] text-left {latest?.winner === 'away'
              ? 'text-primary'
              : 'text-muted-foreground'}"
          >
            {latest?.away.box.points ?? '–'}
          </span>
        </p>
        <p
          class="min-w-[11rem] rounded-full border border-border px-3 py-0.5 text-center font-mono text-[10px] tabular-nums uppercase"
        >
          Game {run.games.length} · {record?.wins ?? 0}–{record?.losses ?? 0}
        </p>
      </div>
      <div class="flex min-w-0 items-center justify-end gap-2 sm:gap-3">
        <div class="min-w-0 text-right">
          <p
            class="font-display truncate text-sm font-extrabold tracking-tight uppercase sm:text-base"
          >
            {latestOpponent?.displayName ?? 'Waiting for the first tip…'}
          </p>
          <p class="font-mono truncate text-[10px] text-muted-foreground">
            {latestOpponent?.seasonKey ?? 'Medium difficulty'}
          </p>
        </div>
        <span class="inline-flex h-8 w-8 shrink-0 items-center justify-center">
          {#if latestOpponent && latestOpponentSlot && manifest}
            <TeamLogo
              {manifest}
              franchiseId={latestOpponent.teamId}
              teamExternalId={latestOpponentSlot.teamExternalId}
              alt=""
              className="h-7 w-7 sm:h-8 sm:w-8"
            />
          {/if}
        </span>
      </div>
    </div>

    <div class="mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
      <GameStrip {run} games={run.games} />
      <div class="mt-3 flex justify-end font-mono text-[10px] tabular-nums text-muted-foreground">
        {run.games.length}/82
      </div>
    </div>

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
          href={resolve(draftHref as any)}
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
          href={resolve((resultHref ?? draftHref) as any)}
          class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
        >
          View progress so far
        </a>
      {/if}
      {#if phase === 'error' && error}
        <p class="w-full text-sm text-destructive">Couldn’t finish the run. Try again.</p>
      {/if}
    </div>
  </div>
</div>
