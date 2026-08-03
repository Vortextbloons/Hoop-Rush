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
  import { loadRunPlayersById } from '$lib/sandbox-lineup';
  import ChallengeOverlay from './ChallengeOverlay.svelte';
  import AsyncState from './AsyncState.svelte';

  /**
   * Challenge progress (spec/08): the full-screen dialog driven by the paced
   * runner, shared by the Sandbox and Classic challenge routes. The 82-cell
   * strip fills left to right; the currently revealed opponent, game number,
   * score, and live record sit directly above it. Assistive technology hears
   * bounded progress announcements, never one per game. Cancel pauses at the
   * last persisted prefix; reload resumes.
   */

  let {
    mode,
    modeLabelFor,
  }: {
    mode: 'sandbox' | 'classic';
    modeLabelFor: (run: ChallengeRun | null) => string;
  } = $props();

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
          void goto(resolve(resultHrefFor(active)));
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
        void goto(resolve(resultHrefFor(active.run)));
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

  function resultHrefFor(current: ChallengeRun): RouteId {
    const runId = encodeURIComponent(current.runId);
    return mode === 'sandbox'
      ? (`/sandbox/result?runId=${runId}` as RouteId)
      : (`/classic/result?runId=${runId}` as RouteId);
  }

  const draftPath = $derived((mode === 'sandbox' ? '/sandbox' : '/classic') as RouteId);
  const modeLabel = $derived(modeLabelFor(run));
  const resultHref = $derived(run ? resultHrefFor(run) : null);
</script>

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
      <a
        href={resolve(draftPath)}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Back to the draft
      </a>
    </div>
  {:else if !run}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading challenge" message="Restoring the active run…" />
    </div>
  {:else}
    <ChallengeOverlay
      {manifest}
      {run}
      {phase}
      error={runnerError}
      {modeLabel}
      draftHref={draftPath}
      {resultHref}
      onCancel={cancel}
      onResume={resume}
    />
  {/if}
</section>
