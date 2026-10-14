<script lang="ts">
  import { browser } from '$app/env';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import type { ChallengeRun, HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import type { RouteId } from '$app/types';
  import { clearDataLoaderCaches, getManifest } from '#lib/data.js';
  import {
    arenaBlockComplete,
    arenaError,
    arenaGameResult,
    arenaSimTick,
    arenaStreak,
  } from '#lib/arena-sound.js';
  import { loadRunPlayersById } from './sandbox-lineup';
  import { ChallengeRunPresenter } from './challenge-session.svelte';
  import ChallengeOverlay from './challenge-overlay.svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  let {
    mode,
    modeLabelFor,
  }: {
    mode: 'sandbox' | 'classic';
    modeLabelFor: (run: ChallengeRun | null) => string;
  } = $props();
  const presenter = new ChallengeRunPresenter();
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let manifestError = $state<string | null>(null);
  let byId = $state<Map<string, PeakPlayerSeason> | null>(null);
  let retryCount = $state(0);
  let announcedCount = 0;
  const ANNOUNCEMENT_EVERY = 10;
  let winStreak = 0;
  let soundGameNumber = 0;
  let soundRunId: string | null = null;
  let errorSoundFor: string | null = null;
  let finalePlayedFor: string | null = null;
  $effect(() => {
    if (!browser) return;
    presenter.init();
    return () => {
      presenter.dispose();
    };
  });
  $effect(() => {
    if (!browser) return;
    if (presenter.phase === 'idle' && presenter.run !== null) {
      presenter.start();
    }
  });
  $effect(() => {
    if (!browser) return;
    void retryCount;
    let cancelled = false;
    manifest = null;
    manifestError = null;
    getManifest().then(
      (loaded) => {
        if (!cancelled) manifest = loaded;
      },
      () => {
        if (!cancelled) manifestError = 'Data unavailable. Try again.';
      },
    );
    return () => {
      cancelled = true;
    };
  });
  $effect(() => {
    const current = presenter.run;
    if (!browser || !current) return;
    if (soundRunId !== current.runId) {
      soundRunId = current.runId;
      soundGameNumber = 0;
      winStreak = 0;
      announcedCount = 0;
    }
    while (soundGameNumber < current.games.length) {
      const result = current.games[soundGameNumber];
      soundGameNumber += 1;
      announcedCount += 1;
      if (result === undefined) continue;
      try {
        arenaSimTick();
      } catch {}
      try {
        const won = result.winner === 'home';
        winStreak = won ? winStreak + 1 : 0;
        if (won && (winStreak === 3 || (winStreak > 3 && winStreak % 5 === 0))) {
          arenaStreak(winStreak);
        } else if (soundGameNumber % ANNOUNCEMENT_EVERY === 0) {
          arenaGameResult(won);
        }
      } catch {}
      if (announcedCount % ANNOUNCEMENT_EVERY === 0) {
        announceProgress(current);
      }
    }
  });
  $effect(() => {
    if (!browser) return;
    if (presenter.phase !== 'error' || presenter.error === null) return;
    if (errorSoundFor === presenter.error) return;
    errorSoundFor = presenter.error;
    try {
      arenaError();
    } catch {}
  });
  $effect(() => {
    const current = presenter.run;
    if (!browser || presenter.phase !== 'finished' || !current) return;
    if (finalePlayedFor !== current.runId) {
      finalePlayedFor = current.runId;
      try {
        const record = current.aggregates.team;
        arenaBlockComplete({ wins: record.wins, losses: record.losses });
      } catch {}
    }
    void goto(resolve(resultHrefFor(current) as any));
  });
  $effect(() => {
    const current = presenter.run;
    const loaded = manifest;
    if (!browser || !current || !loaded) return;
    if (byId !== null) return;
    let cancelled = false;
    loadRunPlayersById(current, loaded).then(
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
  function retryChallenge() {
    clearDataLoaderCaches();
    byId = null;
    retryCount += 1;
    presenter.reload();
  }
  function announceProgress(current: ChallengeRun): void {
    const record = current.aggregates.team;
    const live = document.getElementById('challenge-announcer');
    if (!live) return;
    live.textContent = `Game ${current.games.length} of 82: record ${record.wins}-${record.losses}.`;
  }
  function resultHrefFor(current: ChallengeRun): RouteId {
    const runId = encodeURIComponent(current.runId);
    return mode === 'sandbox'
      ? (`/sandbox/result?runId=${runId}` as any)
      : (`/classic/result?runId=${runId}` as any);
  }
  const draftPath = $derived((mode === 'sandbox' ? '/sandbox' : '/classic') as any);
  const modeLabel = $derived(modeLabelFor(presenter.run));
  const resultHref = $derived(presenter.run ? resultHrefFor(presenter.run) : null);
  const loadError = $derived(manifestError ?? presenter.loadError);
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
        href={resolve(draftPath as any)}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Back to the draft
      </a>
    </div>
  {:else if !presenter.run}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading season…" message="Getting your run ready." />
    </div>
  {:else if presenter.phase === 'starting' || presenter.phase === 'idle'}
    <div class="mt-8">
      <AsyncState kind="loading" title="Warming up…" message="Simulating games." />
    </div>
  {:else}
    <ChallengeOverlay
      {manifest}
      run={presenter.run}
      phase={presenter.phase}
      error={presenter.error}
      {modeLabel}
      draftHref={draftPath}
      {resultHref}
      onCancel={() => presenter.cancel()}
      onResume={() => presenter.resume()}
    />
  {/if}
</section>
