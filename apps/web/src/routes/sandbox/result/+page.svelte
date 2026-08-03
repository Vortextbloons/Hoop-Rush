<script lang="ts">
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type { ChallengeRun, HoopRushManifest, PeakPlayerSeason } from '@hoop-rush/data-contracts';
  import { getManifest } from '$lib/data';
  import { challengeRepository } from '$lib/challenge-repo';
  import { loadRunPlayersById } from '$lib/sandbox-lineup';
  import SeasonReport from '$lib/components/SeasonReport.svelte';

  /**
   * Challenge result (spec/08): final record and 82-0 outcome with the League
   * MVP spotlight, the full game strip, aggregate facts, and the user's
   * five-player season table. The shared SeasonReport presents the report;
   * this route owns loading and the single Run again action, which returns
   * to a completely cleared sandbox draft.
   */

  let manifest = $state.raw<HoopRushManifest | null>(null);
  /** playerId → peak season across the run's loaded pools (slot provenance). */
  let byId = $state<Map<string, PeakPlayerSeason> | null>(null);
  let run = $state.raw<ChallengeRun | null>(null);
  let error = $state<string | null>(null);
  let running = $state(false);

  const { url } = $derived(page);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    const runId = new URL(url.toString()).searchParams.get('runId');
    getManifest().then(
      (m) => {
        if (cancelled) return;
        manifest = m;
      },
      () => {
        if (!cancelled) error = 'The manifest is unavailable.';
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
            return;
          }
          run = record.run;
        },
        (e: unknown) => {
          if (!cancelled) error = e instanceof Error ? e.message : String(e);
        },
      );
    };
    loadRun(runId);
    return () => {
      cancelled = true;
    };
  });

  /** Resolves the run's single franchise-era player pool. */
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

  /** Fresh start: back to a completely cleared sandbox draft. */
  async function runAgain() {
    if (running) return;
    running = true;
    try {
      void goto(resolve('/sandbox'));
    } finally {
      running = false;
    }
  }
</script>

<svelte:head>
  <title>Challenge result — Sandbox — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Sandbox · Result</p>
  <h1
    class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl md:text-5xl"
  >
    Season report
  </h1>

  {#if error}
    <div class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <p class="font-semibold">Result unavailable</p>
      <p class="mt-1 text-muted-foreground">{error}</p>
      <a
        href={resolve('/sandbox/history')}
        class="mt-3 inline-flex rounded-lg bg-primary px-4 py-2 font-semibold text-primary-foreground"
      >
        Challenge history
      </a>
    </div>
  {:else if !run}
    <div class="mt-8 grid place-items-center rounded-xl border border-border bg-card p-16">
      <div
        class="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
      ></div>
      <p class="mt-4 font-mono text-xs tracking-[0.16em] text-muted-foreground uppercase">
        Loading result…
      </p>
    </div>
  {:else}
    <SeasonReport
      {manifest}
      {run}
      {byId}
      modeLabel="Sandbox · Result"
      {running}
      onRunAgain={runAgain}
    />
  {/if}
</section>
