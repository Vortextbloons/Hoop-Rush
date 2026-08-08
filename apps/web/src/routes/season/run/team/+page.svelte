<script lang="ts">
  import { getContext } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import {
    SEASON_BLOCK_COUNT,
    seasonDigestHex,
    type SeasonGameSummary,
    type SeasonRotation,
  } from '@hoop-rush/data-contracts';
  import { minutePlanHorizonGames } from '@hoop-rush/engine';
  import InjuryTimeline from '$lib/components/season/InjuryTimeline.svelte';
  import RotationEditor from '$lib/components/season/RotationEditor.svelte';
  import SeasonPlayerStats from '$lib/components/season/SeasonPlayerStats.svelte';
  import SeasonRosterList from '$lib/components/season/SeasonRosterList.svelte';
  import UnitChemistry from '$lib/components/season/UnitChemistry.svelte';
  import {
    blockPhaseAllowsSubmit,
    buildSubmitBlockEnvelope,
  } from '$lib/season/season-block-submit';
  import { gamesToLockForBlock } from '$lib/season/season-lock-preview';
  import { createProjectionRunner } from '$lib/season/season-projection-runner';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { humanInjuryTimeline } from '$lib/season/season-health-view';
  import { humanSeasonPlayerStats } from '$lib/season/season-player-stats-view';

  /**
   * Season Run team tab (M2.3.5, M2.4, M2.5): the unified rotation
   * workspace for the human franchise — one ten-player list that IS the
   * rotation editor (starters, bench order, closing five, target minutes)
   * with fatigue bands and last-game minutes inline, the unit-chemistry
   * panel, the injury timeline, and the sticky action bar. The editor is
   * shell-owned and survives tab switches; there is no separate save — the
   * rotation locks when the block submits. Roster identity, fatigue, and
   * availability context that previously lived on a separate Roster tab
   * now render here.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  /** Team games remaining from the run cursor: the upcoming block's lock
   * plus every later block (blocks 0-7 lock 10 games, block 8 locks 2). */
  function seasonGamesRemaining(nextBlockIndex: number): number {
    let remaining = 0;
    for (let block = nextBlockIndex; block < SEASON_BLOCK_COUNT; block += 1) {
      remaining += gamesToLockForBlock(block);
    }
    return remaining;
  }

  const manifest = $derived(shell.manifest);
  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const effects = $derived(shell.snapshot?.effects ?? null);
  const health = $derived(shell.health);
  const failures = $derived(shell.editor?.validate() ?? []);
  const canSubmit = $derived(
    shell.snapshot !== null &&
      shell.editor !== null &&
      shell.nextBlockIndex !== null &&
      !shell.seasonComplete &&
      failures.length === 0 &&
      blockPhaseAllowsSubmit(shell.block.phase) &&
      shell.block.phase !== 'running',
  );

  /** playerVersionId -> summary Overall rating, for the editor rows/chips. */
  const overallByVersion = $derived.by(() => {
    const catalog = shell.catalog;
    if (catalog === null) return null;
    const map = new SvelteMap<string, number>();
    for (const candidate of catalog.candidates) {
      map.set(candidate.playerVersionId, candidate.summaryRatings.overallRating);
    }
    return map;
  });

  const roster = $derived(
    run !== null && humanFranchiseId !== null
      ? (run.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null)
      : null,
  );

  /** Optimize-with-projection inputs: ten load rows from catalog stamina/
   * durability and the recorded effects state, and the upcoming-block
   * horizon from the run cursor. */
  const optimizeLoad = $derived.by(() => {
    const catalog = shell.catalog;
    const editor = shell.editor;
    if (catalog === null || editor === null) return null;
    const candidateByVersion = new Map(
      catalog.candidates.map((candidate) => [candidate.playerVersionId, candidate]),
    );
    const loadByVersion = new Map(
      (shell.snapshot?.effects?.playerStates ?? []).map((state) => [state.playerVersionId, state]),
    );
    return [...editor.rotation.starters, ...editor.rotation.benchOrder].map((playerVersionId) => {
      const candidate = candidateByVersion.get(playerVersionId);
      const load = loadByVersion.get(playerVersionId);
      return {
        playerVersionId,
        staminaRating: candidate?.stamina.rating ?? 70,
        durability: candidate?.durability.rating ?? 70,
        fatigueBasisPoints: load?.fatigueBasisPoints ?? 0,
        recentLoadBasisPoints: load?.recentLoadBasisPoints ?? 0,
      };
    });
  });

  const optimizeHorizon = $derived(
    shell.nextBlockIndex === null
      ? 0
      : minutePlanHorizonGames(seasonGamesRemaining(shell.nextBlockIndex)),
  );

  const optimizeSeed = $derived(
    shell.snapshot === null || shell.nextBlockIndex === null
      ? null
      : seasonDigestHex(
          `${shell.snapshot.run.runId}\u0000optimize-rotation\u0000${String(shell.nextBlockIndex)}`,
        ),
  );

  let optimizing = $state(false);
  let optimizeError: string | null = $state(null);

  /** The RotationEditor `optimize` hook: the page owns runner invocation. */
  const optimize = $derived.by(() => {
    const editor = shell.editor;
    if (editor === null || optimizeLoad === null || optimizeHorizon <= 0 || optimizeSeed === null) {
      return null;
    }
    return {
      busy: optimizing,
      error: optimizeError,
      run: async (rotation: SeasonRotation) => {
        if (optimizing) throw new Error('an optimization is already running');
        optimizing = true;
        optimizeError = null;
        try {
          return await createProjectionRunner().optimizeRotation({
            roster: [...rotation.starters, ...rotation.benchOrder],
            structure: rotation,
            load: optimizeLoad,
            horizon: optimizeHorizon,
            seed: optimizeSeed,
          });
        } catch (error) {
          optimizeError = error instanceof Error ? error.message : String(error);
          throw error;
        } finally {
          optimizing = false;
        }
      },
    };
  });

  /** Accepted summaries of the last block (last-game minutes per player). */
  let summaries: SeasonGameSummary[] = $state([]);

  $effect(() => {
    const hub = shell.hub;
    const activeRunId = shell.snapshot?.run.runId ?? null;
    const accepted = shell.snapshot?.acceptedBlocks ?? [];
    if (hub === null || activeRunId === null || accepted.length === 0) {
      summaries = [];
      return;
    }
    const lastBlock = accepted[accepted.length - 1];
    if (lastBlock === undefined) {
      summaries = [];
      return;
    }
    void hub.loadBlockSummaries(activeRunId, lastBlock.blockIndex).then((rows) => {
      summaries = rows;
    });
  });

  /** M2.5: per-player injury history (health records + accepted summaries). */
  const injuryTimeline = $derived(
    run !== null && roster !== null && humanFranchiseId !== null && health !== null
      ? humanInjuryTimeline(health, roster, humanFranchiseId, summaries)
      : [],
  );

  /** Season stats view-model: roster joined to the folded aggregates. */
  const statsView = $derived.by(() => {
    if (roster === null || humanFranchiseId === null) return null;
    return humanSeasonPlayerStats({
      roster,
      summaries: shell.snapshot?.summaries ?? [],
      overallRatingOf: (playerVersionId) =>
        shell.catalog?.candidates.find((c) => c.playerVersionId === playerVersionId)?.summaryRatings
          .overallRating ?? null,
      playablePositions: (playerVersionId) =>
        shell.catalog?.candidates.find((c) => c.playerVersionId === playerVersionId)?.positions
          .playable ?? [],
    });
  });

  let submitting = $state(false);
  let submitError: string | null = $state(null);

  async function submitBlock() {
    if (!canSubmit || submitting) return;
    submitting = true;
    submitError = null;
    try {
      const result = await buildSubmitBlockEnvelope(shell);
      if (!result.ok) {
        submitError = result.error.message;
        return;
      }
      shell.hub?.startBlock(result.envelope);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head>
  <title>Season Run — Team — Hoop Rush</title>
</svelte:head>

<div
  class="flex min-w-0 flex-col gap-6 pt-6 pb-[calc(5.25rem+env(safe-area-inset-bottom))] md:pb-0"
>
  {#if shell.editor === null || manifest === null || roster === null}
    <p class="px-3 font-mono text-sm text-muted-foreground sm:px-0">
      Preparing the rotation workspace…
    </p>
  {:else}
    <section aria-labelledby="workspace-heading" class="flex min-w-0 flex-col gap-6 px-3 sm:px-0">
      <div>
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run · team</p>
        <h2
          id="workspace-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Rotation workspace
        </h2>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Ten player-season versions · role, minutes, fatigue, and availability resolve here · the
          rotation locks when the block submits
        </p>
      </div>

      <UnitChemistry {roster} {effects} {shell} />

      <RotationEditor
        editor={shell.editor}
        disabled={shell.block.phase === 'running'}
        faces={shell.facesByVersion}
        {manifest}
        {effects}
        {summaries}
        {overallByVersion}
        {optimize}
        onchange={() => {
          // The editor is shell-owned; reactive deriveds above already
          // mirror its state. Submission happens at block time.
        }}
      />

      <SeasonRosterList
        {roster}
        {manifest}
        {shell}
        roleOf={(playerVersionId) => {
          const row = shell.editor
            ?.rows()
            .find((r) => r.member.playerVersionId === playerVersionId);
          return { role: row?.role ?? '—', minutes: row?.minutes ?? '—' };
        }}
        {effects}
        {summaries}
      />

      {#if statsView !== null && manifest !== null}
        <SeasonPlayerStats view={statsView} {manifest} {shell} />
      {/if}

      {#if injuryTimeline.length > 0}
        <InjuryTimeline players={injuryTimeline} />
      {/if}
    </section>

    <!-- Sticky action bar: validation state + simulate (identical on every
         breakpoint; the block locks from here or from the Hub preview). -->
    <div
      class="sticky bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 mt-6 scroll-mb-24 px-3 sm:bottom-4 sm:px-0"
    >
      <div
        class="flex flex-col gap-3 rounded-none border border-border bg-surface-1 p-3 shadow-2xl shadow-black/40 backdrop-blur supports-[backdrop-filter]:bg-surface-1/95 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:rounded-xl"
      >
        <p class="min-w-0 text-sm" aria-live="polite">
          {#if failures.length === 0}
            <span class="font-semibold text-positive">Rotation valid</span>
            <span class="ml-2 hidden text-muted-foreground sm:inline">
              Locks when the next block submits.
            </span>
          {:else}
            <span class="font-semibold text-destructive">
              Rotation invalid — {failures.length} issue{failures.length === 1 ? '' : 's'}
            </span>
          {/if}
        </p>
        {#if submitError}
          <p role="alert" class="text-sm text-destructive">{submitError}</p>
        {/if}
        <button
          type="button"
          onclick={() => void submitBlock()}
          disabled={!canSubmit || submitting}
          class="inline-flex w-full min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
        >
          {shell.block.phase === 'running'
            ? 'Simulating block…'
            : submitting
              ? 'Preparing block…'
              : 'Lock & simulate block'}
        </button>
      </div>
    </div>
  {/if}
</div>
