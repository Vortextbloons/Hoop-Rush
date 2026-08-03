<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type {
    ChallengeRun,
    EraSimulationProfile,
    HoopRushManifest,
    PeakPlayerSeason,
  } from '@hoop-rush/data-contracts';
  import type { RouteId } from '$app/types';
import { clearDataLoaderCaches, getEraSimulationProfile, getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { ChallengeRunner, type RunnerPhase } from '$lib/challenge-runner';
  import ChallengeOverlay from '$lib/components/ChallengeOverlay.svelte';
import { loadRunPlayersById } from '$lib/sandbox-lineup';
import AsyncState from '$lib/components/AsyncState.svelte';

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
  /** playerId → peak season for lineup headshots. */
  let byId = $state<Map<string, PeakPlayerSeason> | null>(null);

  let phase = $state<RunnerPhase>('idle');
  let runnerError = $state<string | null>(null);
  let retryCount = $state(0);
  let announcedCount = 0;

  const ANNOUNCEMENT_EVERY = 10;

  $effect(() => {
    if (!browser) return;
    void retryCount;
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

  function retryChallenge() {
    clearDataLoaderCaches();
    manifest = null;
    profile = null;
    run = null;
    byId = null;
    loadError = null;
    runnerError = null;
    phase = 'idle';
    retryCount += 1;
  }

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

  $effect(() => {
    const currentRun = run;
    const m = manifest;
    if (!browser || !currentRun || !m) return;
    // `run` reassigns on every paced reveal; the pool map is already built, so
    // bail out early instead of re-resolving pools per reveal.
    if (byId !== null) return;
    let cancelled = false;
    loadRunPlayersById(currentRun, m).then(
      (map) => {
        if (!cancelled) byId = map;
      },
      () => {
        if (!cancelled) byId = new Map();
      },
    );
    return () => {
      cancelled = true;
    };
  });

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
      <AsyncState
        kind="error"
        title="Challenge unavailable"
        message={loadError}
        retry={retryChallenge}
      />
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
    <AsyncState kind="loading" title="Loading challenge" message="Restoring the active run…" />
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Loading challenge…
      </p>
    </div>
  {:else}
    <ChallengeOverlay
      {manifest}
      {run}
      {phase}
      error={runnerError}
      modeLabel="Sandbox"
      draftHref="/sandbox"
      {resultHref}
      onCancel={cancel}
      onResume={resume}
    />
  {/if}
</section>
