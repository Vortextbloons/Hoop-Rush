<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type {
    ChallengeRun,
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import { variantLabel } from '$lib/draft-presentation';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { clearClassicDraftState } from '$lib/classic-draft';
  import { loadRunPlayersById } from '$lib/sandbox-lineup';
  import SeasonReport from '$lib/components/SeasonReport.svelte';
  import AsyncState from '$lib/components/AsyncState.svelte';

  /**
   * Classic challenge result: the shared SeasonReport record with classic
   * mode identity and the League MVP spotlight. The single Run again action
   * clears any draft state and returns to the Classic variant picker for a
   * fresh seed and five new rounds.
   */

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

  /** Resolves the run's player pools. */
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

  const modeLabel = $derived(
    run ? `Classic · ${variantLabel(run.variant ?? 'ratings')}` : 'Classic',
  );

  /** Fresh start: clears any draft state and returns to the variant picker. */
  async function runAgain() {
    if (running) return;
    running = true;
    try {
      await clearClassicDraftState();
      void goto(resolve('/classic'));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      running = false;
    }
  }
</script>

<svelte:head>
  <title>Challenge result — Classic — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Classic · Result</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    Season report
  </h1>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <AsyncState kind="error" title="Result unavailable" message={error} retry={retryResult} />
      <a
        href={resolve('/classic/history')}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Challenge history
      </a>
    </div>
  {:else if loading || !run}
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Loading result…
      </p>
    </div>
  {:else}
    <SeasonReport {manifest} {run} {byId} {indexById} {modeLabel} {running} onRunAgain={runAgain} />
  {/if}
</section>
