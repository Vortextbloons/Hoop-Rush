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
  import TeamRosterPanel from '$lib/components/season/TeamRosterPanel.svelte';
  import UnitChemistry from '$lib/components/season/UnitChemistry.svelte';
  import {
    blockPhaseAllowsSubmit,
    buildSubmitBlockEnvelope,
  } from '$lib/season/season-block-submit';
  import { gamesToLockForBlock } from '$lib/season/season-lock-preview';
  import { createProjectionRunner } from '$lib/season/season-projection-runner';
  import {
    buildLeagueProjectionBaselines,
    normalizeTeamProjection,
    rawSeasonTeamRatings,
    seasonLeagueTeamProjections,
  } from '$lib/season/season-team-detail-view';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { humanInjuryTimeline } from '$lib/season/season-health-view';
  import { humanSeasonPlayerStats } from '$lib/season/season-player-stats-view';
  import {
    durabilityRatingOfSlice,
    overallRatingOfSlice,
    playablePositionsOfSlice,
    staminaRatingOfSlice,
    summaryRatingsOfSlice,
  } from '$lib/season/season-player-slice';

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

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

  const overallByVersion = $derived.by(() => {
    const slice = shell.playerSlice;
    if (shell.playerSliceReady && slice.size === 0) return new SvelteMap<string, number>();
    const map = new SvelteMap<string, number>();
    for (const entry of slice.values()) {
      map.set(entry.playerVersionId, entry.summaryRatings.overallRating);
    }
    return map;
  });

  const roster = $derived(
    run !== null && humanFranchiseId !== null
      ? (run.rosters.find((r) => r.franchiseId === humanFranchiseId) ?? null)
      : null,
  );

  const optimizeLoad = $derived.by(() => {
    const slice = shell.playerSlice;
    const editor = shell.editor;
    if (!shell.playerSliceReady || editor === null) return null;
    const loadByVersion = new SvelteMap(
      (shell.snapshot?.effects?.playerStates ?? []).map((state) => [state.playerVersionId, state]),
    );
    return [...editor.rotation.starters, ...editor.rotation.benchOrder].map((playerVersionId) => {
      const load = loadByVersion.get(playerVersionId);
      return {
        playerVersionId,
        staminaRating: staminaRatingOfSlice(slice, playerVersionId) ?? 70,
        durability: durabilityRatingOfSlice(slice, playerVersionId) ?? 70,
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

  let summaries: SeasonGameSummary[] = $state([]);

  let rotationRevision = $state(0);

  const ratingsOf = (playerVersionId: string) =>
    summaryRatingsOfSlice(shell.playerSlice, playerVersionId);

  const leagueProjectionBaselines = $derived.by(() => {
    const run = shell.run;
    if (run === null || !shell.playerSliceReady) return null;
    return buildLeagueProjectionBaselines({
      rosters: run.rosters,
      rotations: run.rotations,
      summaryRatingsOf: ratingsOf,
    });
  });

  const lockedTeamProjection = $derived.by(() => {
    const run = shell.run;
    const humanId = shell.humanFranchiseId;
    const baselines = leagueProjectionBaselines;
    if (run === null || humanId === null || baselines === null) return null;
    const lockedRoster = run.rosters.find((entry) => entry.franchiseId === humanId);
    const lockedRotation = run.rotations.find((entry) => entry.franchiseId === humanId);
    if (lockedRoster === undefined || lockedRotation === undefined) return null;
    const raw = rawSeasonTeamRatings({
      roster: lockedRoster,
      rotation: lockedRotation,
      summaryRatingsOf: ratingsOf,
    });
    return raw === null ? null : normalizeTeamProjection(raw, baselines);
  });

  const teamProjection = $derived.by(() => {
    void rotationRevision;
    const run = shell.run;
    const humanId = shell.humanFranchiseId;
    const editor = shell.editor;
    if (run === null || humanId === null || editor === null || !shell.playerSliceReady) {
      return null;
    }
    return (
      seasonLeagueTeamProjections({
        rosters: run.rosters,
        rotations: run.rotations,
        summaryRatingsOf: ratingsOf,
        rotationOverrides: new Map([[humanId, editor.rotation]]),
      }).get(humanId) ?? null
    );
  });

  function projectionDelta(pending: number, locked: number | undefined): number | null {
    if (locked === undefined || pending === locked) return null;
    return pending - locked;
  }

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

  const injuryTimeline = $derived(
    run !== null && roster !== null && humanFranchiseId !== null && health !== null
      ? humanInjuryTimeline(health, roster, humanFranchiseId, summaries)
      : [],
  );

  const statsView = $derived.by(() => {
    if (roster === null || humanFranchiseId === null) return null;
    const slice = shell.playerSlice;
    return humanSeasonPlayerStats({
      roster,
      summaries: shell.snapshot?.summaries ?? [],
      overallRatingOf: (playerVersionId) => overallRatingOfSlice(slice, playerVersionId),
      playablePositions: (playerVersionId) => playablePositionsOfSlice(slice, playerVersionId),
    });
  });

  const roleByVersion = $derived.by(() => {
    void rotationRevision;
    const editor = shell.editor;
    if (editor === null) return null;
    const map = new SvelteMap<string, { role: string; minutes: number | string }>();
    for (const row of editor.rows()) {
      map.set(row.member.playerVersionId, {
        role: row.role,
        minutes: editor.isActive(row.member.playerVersionId) ? row.minutes : '—',
      });
    }
    return map;
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
          Ten active players · role, minutes, fatigue, and availability resolve here · inactive
          roster depth can be promoted to the rotation · the rotation locks when the block submits
        </p>
      </div>

      {#if teamProjection !== null}
        {@const overallDelta = projectionDelta(
          teamProjection.overall,
          lockedTeamProjection?.overall,
        )}
        {@const offenseDelta = projectionDelta(
          teamProjection.offense,
          lockedTeamProjection?.offense,
        )}
        {@const defenseDelta = projectionDelta(
          teamProjection.defense,
          lockedTeamProjection?.defense,
        )}
        <dl
          class="grid grid-cols-3 gap-2"
          data-season-team-projection
          aria-label="Team ratings from the pending rotation's player ratings"
        >
          <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
            <dt
              class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Overall
            </dt>
            <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
              {teamProjection.overall}
              {#if overallDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {overallDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {overallDelta > 0 ? '+' : ''}{overallDelta}
                </span>
              {/if}
            </dd>
          </div>
          <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
            <dt
              class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Offense
            </dt>
            <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
              {teamProjection.offense}
              {#if offenseDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {offenseDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {offenseDelta > 0 ? '+' : ''}{offenseDelta}
                </span>
              {/if}
            </dd>
          </div>
          <div class="rounded-xl bg-surface-1 px-3 py-3 text-center">
            <dt
              class="font-mono text-[9px] font-bold tracking-[0.14em] text-muted-foreground uppercase"
            >
              Defense
            </dt>
            <dd class="font-display mt-1 text-2xl leading-none font-extrabold tracking-tight">
              {teamProjection.defense}
              {#if defenseDelta !== null}
                <span
                  class="ml-1 font-mono text-[11px] font-bold {defenseDelta > 0
                    ? 'text-positive'
                    : 'text-destructive'}"
                >
                  {defenseDelta > 0 ? '+' : ''}{defenseDelta}
                </span>
              {/if}
            </dd>
          </div>
        </dl>
        <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
          1–100 vs the league · star-heavy minute weighting
          {#if overallDelta !== null || offenseDelta !== null || defenseDelta !== null}
            · deltas vs last locked rotation
          {/if}
        </p>
      {/if}

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
          rotationRevision += 1;
        }}
      />

      {#if statsView !== null}
        <TeamRosterPanel
          {roster}
          {manifest}
          {shell}
          roleOf={(playerVersionId) =>
            roleByVersion?.get(playerVersionId) ?? { role: '—', minutes: '—' }}
          {effects}
          {summaries}
          {statsView}
        />
      {/if}

      {#if injuryTimeline.length > 0}
        <InjuryTimeline players={injuryTimeline} />
      {/if}
    </section>

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
