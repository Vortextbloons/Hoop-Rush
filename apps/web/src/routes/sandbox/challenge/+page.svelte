<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { X } from '@lucide/svelte';
  import type {
    ChallengeRun,
    EraSimulationProfile,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import type { RouteId } from '$app/types';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { getEraSimulationProfile, getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { ChallengeRunner, type RunnerPhase } from '$lib/challenge-runner';
  import GameStrip from '$lib/components/GameStrip.svelte';
  import TeamLogo from '$lib/components/TeamLogo.svelte';

  /**
   * Challenge progress (spec/08): a full-screen dialog driven by the paced
   * runner. The 82-cell strip fills left to right; the currently revealed
   * opponent, game number, score, and live record sit directly above it.
   * Assistive technology hears bounded progress announcements, never one per
   * game. Cancel pauses at the last persisted prefix; reload resumes.
   */

  let manifest = $state.raw<HoopRushManifest | null>(null);
  let profile = $state.raw<EraSimulationProfile | null>(null);
  let run = $state.raw<ChallengeRun | null>(null);
  let loadError = $state<string | null>(null);

  let phase = $state<RunnerPhase>('idle');
  let runnerError = $state<string | null>(null);
  let announcedCount = 0;

  const ANNOUNCEMENT_EVERY = 10;

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
      },
      () => {
        if (!cancelled) loadError = 'The manifest is unavailable.';
      },
    );
    challengeRepository.loadActiveRun().then(
      (record) => {
        if (cancelled) return;
        const active = record?.run;
        if (!active) {
          loadError = 'No active challenge. Start one from the draft.';
          return;
        }
        if (active.status === 'finished') {
          void goto(resolve(`/sandbox/result?runId=${encodeURIComponent(active.runId)}`));
          return;
        }
        if (active.status !== 'active') {
          loadError = 'This challenge is no longer active.';
          return;
        }
        run = active;
        getManifest().then(
          (m) => {
            if (cancelled) return;
            const entry = m.eraSimulationProfiles.find((p) => p.eraId === active.eraId);
            if (!entry) {
              loadError = 'The decade simulation profile is unavailable.';
              return;
            }
            getEraSimulationProfile(entry).then(
              (p) => {
                if (!cancelled) {
                  profile = p;
                  session = { run: active, profile: p };
                }
              },
              () => {
                if (!cancelled) loadError = 'The decade simulation profile is unavailable.';
              },
            );
          },
          () => {
            if (!cancelled) loadError = 'The manifest is unavailable.';
          },
        );
      },
      (e: unknown) => {
        if (!cancelled) loadError = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
    };
  });

  // Worker + persistence boundary: one runner per loaded session. The runner
  // is intentionally NON-reactive (a plain variable): the effect must not
  // re-run when it changes, or Svelte would reschedule the effect in a loop,
  // disposing and recreating the worker every cycle. The session snapshot is
  // set once by the load effect; display state (`run`) is separate so updates
  // never re-trigger this boundary.
  let runner: ChallengeRunner | null = null;
  let session = $state.raw<{ run: ChallengeRun; profile: EraSimulationProfile } | null>(null);
  $effect(() => {
    const active = session;
    if (!browser || !active || runner !== null) return;
    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const instance = new ChallengeRunner(challengeRepository, {
      onReveal(_result, nextRun) {
        run = nextRun;
        announcedCount += 1;
        if (announcedCount % ANNOUNCEMENT_EVERY === 0) {
          announceProgress(nextRun);
        }
      },
      onFinished() {
        void goto(resolve(`/sandbox/result?runId=${encodeURIComponent(active.run.runId)}`));
      },
      onPaused() {
        phase = 'paused';
      },
      onError(message) {
        phase = 'error';
        runnerError = message;
      },
    });
    runner = instance;
    phase = 'running';
    instance.start(active.run, active.profile, { reducedMotion });
    return () => {
      instance.dispose();
      if (runner === instance) runner = null;
    };
  });

  /** Bounded aria-live announcements instead of one per game. */
  function announceProgress(current: ChallengeRun): void {
    const record = current.aggregates.team;
    const live = document.getElementById('challenge-announcer');
    if (!live) return;
    live.textContent = `Game ${current.games.length} of 82: record ${record.wins}-${record.losses}.`;
  }

  const record = $derived(run?.aggregates.team);
  const latest = $derived(run?.games.at(-1) ?? null);
  const latestOpponent = $derived.by(() => {
    if (!latest || !run) return null;
    const entry = run.bracket.schedule[latest.gameNumber - 1];
    return run.bracket.opponents.find((o) => o.opponentId === entry?.opponentId) ?? null;
  });

  const franchise = $derived(
    manifest?.franchiseLineage.find((e) => e.franchiseId === run?.franchiseId) ?? null,
  );

  function cancel() {
    runner?.cancel();
  }

  function resume() {
    if (!runner || !run || !profile) return;
    runnerError = null;
    runner.start(run, profile, {
      reducedMotion:
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }

  const draftHref = resolve('/sandbox');
  const resultHref = $derived(
    run ? (`/sandbox/result?runId=${encodeURIComponent(run.runId)}` as RouteId) : null,
  );
</script>

<svelte:head>
  <title>Challenge in progress — Sandbox — Hoop Rush</title>
</svelte:head>

<p id="challenge-announcer" class="sr-only" aria-live="polite"></p>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  {#if loadError}
    <div class="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-semibold">Challenge unavailable</p>
      <p class="mt-1 text-muted-foreground">{loadError}</p>
      <a
        href={draftHref}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Back to the draft
      </a>
    </div>
  {:else if !run}
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Loading challenge…
      </p>
    </div>
  {:else}
    <!-- Full-screen presentation overlay -->
    <div
      class="fixed inset-0 z-50 overflow-y-auto bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90"
    >
      <div
        class="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center px-4 py-8 sm:px-6"
      >
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Sandbox · {franchiseAbbreviation(run.franchiseId)} · {run.eraId}
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
                {franchiseAbbreviation(run.franchiseId)} · {run.eraId}
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
            <p
              class="rounded-full border border-border px-3 py-0.5 font-mono text-[10px] uppercase"
            >
              Game {run.games.length}{run.games.length === 82 ? ' · final' : ''} · {record?.wins ??
                0}-
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
              onclick={cancel}
              class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-line-strong outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X class="h-4 w-4" />
              Cancel
            </button>
          {:else if phase === 'paused'}
            <button
              type="button"
              onclick={resume}
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Continue
            </button>
            <a
              href={draftHref}
              class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              Leave the challenge
            </a>
          {:else if phase === 'error' && runnerError}
            <button
              type="button"
              onclick={resume}
              class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
            <a
              href={resolve((resultHref ?? '/sandbox') as RouteId)}
              class="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              View progress so far
            </a>
          {/if}
          {#if phase === 'error' && runnerError}
            <p class="w-full text-sm text-destructive">{runnerError}</p>
          {/if}
        </div>

        <p class="mt-4 font-mono text-[10px] text-muted-foreground">
          seed {run.runSeed} · engine {run.versions.engineVersion} · bracket {run.versions
            .bracketVersion}
          · schedule {run.versions.scheduleVersion}
        </p>
      </div>
    </div>
  {/if}
</section>
