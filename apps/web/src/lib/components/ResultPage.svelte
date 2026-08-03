<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type {
    ChallengeRun,
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import type { SandboxHref } from '$lib/sandbox-url';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { loadRunPlayersById } from '$lib/sandbox-lineup';
  import SeasonReport from './SeasonReport.svelte';
  import AsyncState from './AsyncState.svelte';

  /**
   * Challenge result (spec/08): final record and 82-0 outcome with the League
   * MVP spotlight, the full game strip, aggregate facts, and the user's
   * five-player season table, shared by the Sandbox and Classic result
   * routes. This component owns loading the completed run, the manifest, and
   * the headshot indexes; the route owns the mode-specific Run again action.
   */

  let {
    mode,
    eyebrow,
    modeLabelFor,
    onRunAgain,
    onRetrySameTeam = null,
    editTeamHrefFor = null,
  }: {
    mode: 'sandbox' | 'classic';
    /** Small uppercase label above the heading, e.g. "Sandbox · Result". */
    eyebrow: string;
    modeLabelFor: (run: ChallengeRun | null) => string;
    onRunAgain: () => Promise<void>;
    onRetrySameTeam?:
      ((run: ChallengeRun, byId: Map<string, PeakPlayerSeason>) => Promise<void> | void) | null;
    editTeamHrefFor?: ((run: ChallengeRun) => SandboxHref | null) | null;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  /** playerId → peak season across the run's loaded pools (slot provenance). */
  let byId = $state<Map<string, PeakPlayerSeason> | null>(null);
  /** playerId → global players-index entry, used for MVP headshots. */
  let indexById = $state.raw<Map<string, PlayersIndexEntry> | null>(null);
  let run = $state.raw<ChallengeRun | null>(null);
  let error = $state<string | null>(null);
  let running = $state(false);
  let loading = $state(true);
  let retryCount = $state(0);
  let manifestLoaded = false;
  let runLoaded = false;

  function markLoaded() {
    if (manifestLoaded && runLoaded) loading = false;
  }

  const { url } = $derived(page);

  const modeLabel = $derived(modeLabelFor(run));
  const editTeamHref = $derived<SandboxHref | null>(
    run && editTeamHrefFor ? editTeamHrefFor(run) : null,
  );

  $effect(() => {
    if (!browser) return;
    void retryCount;
    let cancelled = false;
    manifestLoaded = false;
    runLoaded = false;
    loading = true;
    error = null;
    manifest = null;
    run = null;
    byId = null;
    const runId = new URL(url.toString()).searchParams.get('runId');
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
        manifestLoaded = true;
        markLoaded();
        getPlayersIndex().then(
          (ix) => {
            if (!cancelled) {
              indexById = new Map(ix.players.map((p) => [p.playerId, p]));
            }
          },
          () => {
            // Headshots are best-effort; the report renders without them.
          },
        );
      },
      () => {
        if (!cancelled) {
          error = 'The manifest is unavailable.';
          loading = false;
        }
      },
    );
    const loadRun = (id: string | null) => {
      const promise = id
        ? challengeRepository.loadCompletedRun(id)
        : challengeRepository.listCompletedRuns().then((rows) => {
            const latest = rows[0];
            return latest ? challengeRepository.loadCompletedRun(latest.runId) : null;
          });
      promise.then(
        (record) => {
          if (cancelled) return;
          if (!record) {
            error = 'No completed challenge found. Run one first.';
            loading = false;
            return;
          }
          run = record.run;
          runLoaded = true;
          markLoaded();
        },
        (e: unknown) => {
          if (!cancelled) {
            error = e instanceof Error ? e.message : String(e);
            loading = false;
          }
        },
      );
    };
    loadRun(runId);
    return () => {
      cancelled = true;
    };
  });

  function retryResult() {
    clearDataLoaderCaches();
    retryCount += 1;
  }

  /** Resolves the run's player pools for lineup headshots. */
  $effect(() => {
    const currentRun = run;
    const m = manifest;
    if (!browser || !currentRun || !m) return;
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

  /** Wraps the route's same-team rerun with the shared run/byId/error state. */
  const retrySameTeam = $derived(() => {
    const handler = onRetrySameTeam;
    if (!handler) return null;
    return () => {
      if (!run || !byId || running) return;
      running = true;
      error = null;
      Promise.resolve(handler(run, byId))
        .catch((e: unknown) => {
          error = e instanceof Error ? e.message : String(e);
        })
        .finally(() => {
          running = false;
        });
    };
  });
</script>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">{eyebrow}</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    Season report
  </h1>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <AsyncState kind="error" title="Result unavailable" message={error} retry={retryResult} />
      <a
        href={resolve(`/${mode}/history`)}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Challenge history
      </a>
    </div>
  {:else if loading || !run}
    <div class="mt-8">
      <AsyncState kind="loading" title="Loading result" message="Reading the completed run…" />
    </div>
  {:else}
    <SeasonReport
      {manifest}
      {run}
      {byId}
      {indexById}
      {modeLabel}
      {running}
      {onRunAgain}
      onRetrySameTeam={retrySameTeam}
      {editTeamHref}
    />
  {/if}
</section>
