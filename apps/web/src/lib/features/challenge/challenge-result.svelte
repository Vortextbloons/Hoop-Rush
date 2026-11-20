<script lang="ts">
  import { browser } from '$app/env';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import type {
    ChallengeRun,
    HoopRushManifest,
    PeakPlayerSeason,
    PlayersIndexEntry,
  } from '@hoop-rush/data-contracts';
  import type { SandboxHref } from '#lib/sandbox-url.js';
  import { errorMessageOf } from '#lib/errors.js';
  import { clearDataLoaderCaches, getManifest, getPlayersIndex } from '#lib/data.js';
  import { challengeRepository } from './challenge-repo';
  import { loadRunPlayersById } from './sandbox-lineup';
  import { arenaBlockComplete } from '#lib/arena-sound.js';
  import ChallengeReport from '#lib/components/ChallengeReport.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Button from '#lib/components/ui/Button.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  let {
    mode,
    eyebrow,
    modeLabelFor,
    onRunAgain,
    onRetrySameTeam = null,
    editTeamHrefFor = null,
  }: {
    mode: 'sandbox' | 'classic';
    eyebrow: string;
    modeLabelFor: (run: ChallengeRun | null) => string;
    onRunAgain: () => Promise<void>;
    onRetrySameTeam?:
      ((run: ChallengeRun, byId: Map<string, PeakPlayerSeason>) => Promise<void> | void) | null;
    editTeamHrefFor?: ((run: ChallengeRun) => SandboxHref | null) | null;
  } = $props();
  let manifest = $state.raw<HoopRushManifest | null>(null);
  let byId = $state<Map<string, PeakPlayerSeason> | null>(null);
  let indexById = $state.raw<Map<string, PlayersIndexEntry> | null>(null);
  let run = $state.raw<ChallengeRun | null>(null);
  let error = $state<string | null>(null);
  let running = $state(false);
  let loading = $state(true);
  let retryCount = $state(0);
  let manifestLoaded = false;
  let runLoaded = false;
  let finalePlayedFor: string | null = null;
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
          () => {},
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
            error = errorMessageOf(e);
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
  $effect(() => {
    const finished = run;
    if (!browser || !finished) return;
    if (finalePlayedFor === finished.runId) return;
    finalePlayedFor = finished.runId;
    try {
      const record = finished.aggregates.team;
      arenaBlockComplete({ wins: record.wins, losses: record.losses });
    } catch {}
  });
  function retryResult() {
    clearDataLoaderCaches();
    retryCount += 1;
  }
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
  function retrySameTeam() {
    const handler = onRetrySameTeam;
    if (!handler || !run || !byId || running) return;
    running = true;
    error = null;
    Promise.resolve(handler(run, byId))
      .catch((e: unknown) => {
        error = errorMessageOf(e);
      })
      .finally(() => {
        running = false;
      });
  }
</script>

<PageShell as="section" width="xl" padding="lg">
  <p class="ui-label">{eyebrow}</p>

  {#if error}
    <EmptyState class="mt-8" kind="error" title="Result unavailable" message={error}>
      {#snippet actions()}
        <Button size="sm" onclick={retryResult}>Try again</Button>
        <ActionLink href={resolve(`${mode}/history/`)} tone="primary">Challenge history</ActionLink>
      {/snippet}
    </EmptyState>
  {:else if loading || !run}
    <EmptyState
      class="mt-8"
      kind="loading"
      title="Loading result"
      message="Reading the completed run…"
    />
  {:else}
    <ChallengeReport
      {manifest}
      {run}
      {byId}
      {indexById}
      {modeLabel}
      {running}
      {onRunAgain}
      onRetrySameTeam={onRetrySameTeam ? retrySameTeam : null}
      {editTeamHref}
    />
  {/if}
</PageShell>
