<script lang="ts">
  import { browser } from '$app/environment';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { SvelteMap } from 'svelte/reactivity';
  import type {
    HoopRushManifest,
    SeasonDraftCatalog,
    SeasonHomeCourtProfile,
    SeasonRotation,
    SeasonSubmitBlockCommand,
  } from '@hoop-rush/data-contracts';
  import {
    SEASON_BLOCK_VERSION,
    SEASON_RUN_SCHEMA_VERSION,
    franchiseAbbreviation,
  } from '@hoop-rush/data-contracts';
  import { blockRoundRange } from '@hoop-rush/data-contracts';
  import BlockProgress from '$lib/components/season/BlockProgress.svelte';
  import LockPreview from '$lib/components/season/LockPreview.svelte';
  import LeadersTable from '$lib/components/season/LeadersTable.svelte';
  import RotationEditor from '$lib/components/season/RotationEditor.svelte';
  import StandingsTable from '$lib/components/season/StandingsTable.svelte';
  import {
    loadSeasonDraftCatalog,
    loadSeasonHomeCourtProfile,
    loadSeasonLeague,
    loadSeasonSchedule,
    seasonArtifactUrls,
  } from '$lib/season/season-assets';
  import { getManifest } from '$lib/data';
  import {
    SeasonHubState,
    type BlockRunState,
    type SubmitBlockEnvelope,
  } from '$lib/season/season-hub-state';
  import type { SeasonRunSnapshot } from '@hoop-rush/persistence';
  import { getSeasonBlockRunner, getSeasonRunRepository } from '$lib/season/season-repo';
  import { newSeasonId } from '$lib/season/season-ids';
  import {
    buildLockPreview,
    pendingRotationSetDigest,
    type LockPreview as LockPreviewData,
  } from '$lib/season/season-lock-preview';
  import {
    createRotationEditor,
    RotationEditor as RotationEditorClass,
  } from '$lib/season/season-rotation-editor';
  import {
    foldSeasonAggregates,
    franchiseStreak,
    humanScheduleRows,
    leaderTables,
    ordinal,
    provisionalRanking,
    recordLabel,
  } from '$lib/season/season-presentation';
  import type { SeasonBlockStartInput } from '$lib/season/season-block-runner';

  /**
   * Season Run league hub (spec/2.0/02, spec/2.0/11 block lock preview, M2.3):
   * human record + provisional position, next block and opponents, standings,
   * schedule/results, team summaries, league leaders, the rotation editor with
   * its "What changed?" lock preview, and the block runner progress. Accepted
   * state always comes from the repository snapshot; the runner only streams
   * progress and completes.
   */

  let manifest = $state<HoopRushManifest | null>(null);
  let catalog = $state<SeasonDraftCatalog | null>(null);
  let homeCourt = $state<SeasonHomeCourtProfile | null>(null);
  let artifactUrls = $state<Awaited<ReturnType<typeof seasonArtifactUrls>> | null>(null);
  let loadError: string | null = $state(null);
  let hub = $state.raw<SeasonHubState | null>(null);
  let editor = $state<RotationEditorClass | null>(null);
  let editorKey = $state<string | null>(null);
  let submitError: string | null = $state(null);
  /** Reactive mirrors of the hub's plain fields (updated by subscription). */
  let snapshot = $state<SeasonRunSnapshot | null>(null);
  let block = $state<BlockRunState | null>(null);

  $effect(() => {
    if (!browser) return;
    let cancelled = false;
    Promise.all([
      getManifest(),
      loadSeasonLeague(),
      loadSeasonDraftCatalog(),
      loadSeasonHomeCourtProfile(),
      loadSeasonSchedule(),
      seasonArtifactUrls(),
    ]).then(
      async ([m, , cat, home, seasonSchedule, urls]) => {
        if (cancelled) return;
        manifest = m;
        catalog = cat;
        homeCourt = home;
        artifactUrls = urls;
        try {
          const [repo, runner] = await Promise.all([
            getSeasonRunRepository(seasonSchedule),
            getSeasonBlockRunner(),
          ]);
          if (cancelled) return;
          hub = new SeasonHubState(repo, runner);
          hub.subscribe(() => {
            snapshot = hub!.snapshot;
            block = hub!.block;
          });
          await hub.refresh();
        } catch (error) {
          if (!cancelled) {
            loadError = error instanceof Error ? error.message : String(error);
          }
        }
      },
      (error: unknown) => {
        if (!cancelled) loadError = error instanceof Error ? error.message : String(error);
      },
    );
    return () => {
      cancelled = true;
      hub?.destroy();
      hub = null;
    };
  });

  const run = $derived(snapshot?.run ?? null);
  const humanTeam = $derived(
    run ? (run.league.teams.find((team) => team.control === 'human') ?? null) : null,
  );
  const humanFranchiseId = $derived(humanTeam?.franchiseId ?? null);

  const humanRow = $derived(
    run && humanFranchiseId
      ? (run.standings.rows.find((row) => row.franchiseId === humanFranchiseId) ?? null)
      : null,
  );
  const provisionalPosition = $derived.by(() => {
    if (!run || !humanFranchiseId) return null;
    const entry = provisionalRanking(run.standings, run.league).find(
      (e) => e.row.franchiseId === humanFranchiseId,
    );
    return entry?.rank ?? null;
  });

  const nextBlockIndex = $derived(snapshot ? snapshot.acceptedBlocks.length : null);
  const seasonComplete = $derived(nextBlockIndex !== null && nextBlockIndex >= 9);
  const roundRange = $derived(
    nextBlockIndex !== null && !seasonComplete ? blockRoundRange(nextBlockIndex) : null,
  );
  const blockLabel = $derived(
    roundRange
      ? `Block ${String(nextBlockIndex! + 1)} of 9 · rounds ${String(roundRange.fromRound)}–${String(roundRange.toRound)}`
      : '',
  );

  const playerNames = $derived.by(() => {
    const map = new SvelteMap<string, string>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });
  const playerName = (playerVersionId: string): string =>
    playerNames.get(playerVersionId) ?? playerVersionId;
  const franchiseName = (franchiseId: string): string =>
    manifest?.modernFranchiseSlots.find((slot) => slot.franchiseId === franchiseId)?.displayName ??
    franchiseId;

  /** Builds the human rotation editor once the snapshot + catalog are ready. */
  $effect(() => {
    const s = snapshot;
    const cat = catalog;
    if (!s || !cat) return;
    const human = s.run.league.teams.find((team) => team.control === 'human');
    if (!human) return;
    const humanRotation = s.run.rotations.find(
      (rotation) => rotation.franchiseId === human.franchiseId,
    );
    if (!humanRotation) return;
    const key = `${s.run.runId}:${humanRotation.starters.join(',')}:${humanRotation.closingFive.join(',')}`;
    if (editorKey === key && editor) return;
    editorKey = key;
    const roster = s.run.rosters.find((r) => r.franchiseId === human.franchiseId);
    const members = (roster?.players ?? []).map((entry) => {
      const candidate = cat.candidates.find((c) => c.playerVersionId === entry.playerVersionId);
      const playable: readonly ('PG' | 'SG' | 'SF' | 'PF' | 'C')[] =
        candidate?.positions.playable ?? [];
      return {
        playerVersionId: entry.playerVersionId,
        displayName: entry.displayName,
        playable,
      };
    });
    editor = createRotationEditor(humanRotation, members);
  });

  const pendingRotation = $derived(editor?.rotation ?? null);
  const pendingSetDigest = $derived.by(() => {
    if (!snapshot || !pendingRotation) return null;
    return pendingRotationSetDigest(snapshot.run.rotations, pendingRotation);
  });

  const lastLockedDigest = $derived(
    snapshot && snapshot.acceptedBlocks.length > 0
      ? (snapshot.acceptedBlocks[snapshot.acceptedBlocks.length - 1]?.rotationDigest ?? null)
      : null,
  );

  const preview: LockPreviewData | null = $derived.by(() => {
    if (
      !run ||
      !humanFranchiseId ||
      !pendingRotation ||
      pendingSetDigest === null ||
      nextBlockIndex === null ||
      seasonComplete
    ) {
      return null;
    }
    const baseline =
      run.rotations.find((rotation) => rotation.franchiseId === humanFranchiseId) ??
      pendingRotation;
    return buildLockPreview({
      pendingHumanRotation: pendingRotation,
      baselineHumanRotation: baseline,
      pendingSetDigest,
      lastLockedDigest,
      blockIndex: nextBlockIndex,
      names: playerNames,
      games: run.games,
      humanFranchiseId,
    });
  });

  const rotationFailures = $derived(editor?.validate() ?? []);
  const canSubmit = $derived(
    !!snapshot &&
      !!pendingRotation &&
      pendingSetDigest !== null &&
      !seasonComplete &&
      rotationFailures.length === 0 &&
      (block?.phase === 'idle' ||
        block?.phase === 'complete' ||
        block?.phase === 'cancelled' ||
        block?.phase === 'failed'),
  );

  const aggregates = $derived.by(() => {
    if (!snapshot) return null;
    return foldSeasonAggregates(snapshot.summaries);
  });
  const leaders = $derived(aggregates ? leaderTables(aggregates.players, aggregates.teams) : null);

  const scheduleRows = $derived(
    run && humanFranchiseId ? humanScheduleRows(run.games, humanFranchiseId) : [],
  );

  const streakOf = (franchiseId: string): { kind: 'wins' | 'losses'; length: number } | null =>
    snapshot ? franchiseStreak(snapshot.summaries, franchiseId) : null;

  const humanStreak = $derived(humanFranchiseId ? streakOf(humanFranchiseId) : null);

  /** Builds the typed submit command + runner start input (frozen contracts). */
  function buildEnvelope(): SubmitBlockEnvelope | null {
    if (!snapshot || !pendingRotation || pendingSetDigest === null || !homeCourt || !artifactUrls) {
      return null;
    }
    const blockIndex = snapshot.acceptedBlocks.length;
    if (blockIndex > 8) return null;
    const commandId = newSeasonId('blk');
    const command: SeasonSubmitBlockCommand = {
      schemaVersion: SEASON_RUN_SCHEMA_VERSION,
      blockVersion: SEASON_BLOCK_VERSION,
      command: 'submit-season-block',
      commandId,
      runId: snapshot.run.runId,
      expectedRevision: blockIndex,
      blockIndex,
      rotationDigest: pendingSetDigest,
    };
    const rotations: SeasonRotation[] = snapshot.run.rotations.map((rotation) =>
      rotation.franchiseId === pendingRotation.franchiseId ? pendingRotation : rotation,
    );
    const start: SeasonBlockStartInput = {
      run: snapshot.run,
      rotations,
      blockIndex,
      expectedRevision: blockIndex,
      rotationDigest: pendingSetDigest,
      commandId,
      humanFranchiseId,
      homeCourt,
      catalogUrl: artifactUrls.catalogUrl,
      catalogHash: artifactUrls.catalogHash,
      profileUrl: artifactUrls.profileUrl,
      profileHash: artifactUrls.profileHash,
    };
    return { command, start };
  }

  function submitBlock() {
    submitError = null;
    if (!canSubmit || !hub) return;
    const envelope = buildEnvelope();
    if (!envelope) {
      submitError = 'The block cannot be submitted right now.';
      return;
    }
    hub.startBlock(envelope);
  }
</script>

<svelte:head>
  <title>Season Run — league — Hoop Rush</title>
</svelte:head>

<section class="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
  <div class="flex items-end justify-between gap-4">
    <div>
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run · league</p>
      {#if humanTeam}
        <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
          {franchiseName(humanTeam.franchiseId)}
        </h1>
      {:else}
        <h1 class="font-display mt-2 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
          League hub
        </h1>
      {/if}
    </div>
    <a
      href={resolve('/')}
      class="font-mono text-xs text-muted-foreground underline-offset-4 hover:underline"
    >
      Back
    </a>
  </div>

  {#if loadError}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      Failed to load the season: {loadError}
    </p>
  {:else if !snapshot}
    <div class="mt-10 flex flex-col gap-4">
      <p class="font-mono text-sm text-muted-foreground">Loading the active run…</p>
      <a
        href={resolve('/season')}
        class="inline-flex w-fit items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong"
      >
        Start a Season Run
      </a>
    </div>
  {:else if !humanTeam}
    <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
      The active run has no human-controlled franchise.
    </p>
  {:else}
    <div class="mt-8 flex flex-col gap-8 pb-32">
      <!-- Record + provisional position + next block -->
      <section aria-labelledby="hub-record-heading" class="grid gap-4 md:grid-cols-3">
        <div class="rounded-xl bg-surface-1 p-5">
          <h2
            id="hub-record-heading"
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Record
          </h2>
          <p class="mt-1 text-4xl font-extrabold tracking-tight">
            {humanRow ? recordLabel(humanRow.wins, humanRow.losses) : '0–0'}
          </p>
          <p class="mt-1 font-mono text-[10px] text-muted-foreground">
            {humanRow?.gamesPlayed ?? 0} games played
            {#if humanStreak && humanStreak.length >= 2}
              · {humanStreak.kind === 'wins' ? 'winning' : 'losing'} streak of {humanStreak.length}
            {/if}
          </p>
        </div>
        <div class="rounded-xl bg-surface-1 p-5">
          <h2
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Conference position
          </h2>
          <p class="mt-1 text-4xl font-extrabold tracking-tight">
            {provisionalPosition !== null ? ordinal(provisionalPosition) : '—'}
            <span class="text-lg text-muted-foreground">
              of 15 · {humanTeam.conference === 'east' ? 'East' : 'West'}
            </span>
          </p>
          <p class="mt-1 font-mono text-[10px] text-muted-foreground">
            Provisional: wins, point differential, franchise id — not the M2.6 tiebreak.
          </p>
        </div>
        <div class="rounded-xl bg-surface-1 p-5">
          <h2
            class="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
          >
            Next block
          </h2>
          {#if seasonComplete}
            <p class="mt-1 text-2xl font-extrabold">Regular season complete</p>
            <p class="mt-1 font-mono text-[10px] text-muted-foreground">
              {recordLabel(humanRow?.wins ?? 0, humanRow?.losses ?? 0)} final · all 82 rounds accepted.
            </p>
          {:else if blockLabel}
            <p class="mt-1 text-2xl font-extrabold">{blockLabel}</p>
            <p class="mt-1 font-mono text-[10px] text-muted-foreground">
              {snapshot.acceptedBlocks.length} of 9 checkpoints accepted.
            </p>
          {:else}
            <p class="mt-1 text-2xl font-extrabold">Loading…</p>
          {/if}
        </div>
      </section>

      {#if block && (block.phase === 'running' || block.phase === 'complete' || block.phase === 'cancelled' || block.phase === 'failed')}
        <BlockProgress
          {block}
          label={blockLabel}
          onCancel={() => hub?.cancel()}
          onRetry={() => hub?.retry()}
        />
      {/if}

      {#if !seasonComplete}
        <!-- Rotation editor + what-changed preview + submit -->
        <section aria-labelledby="hub-rotation-heading" class="flex flex-col gap-6">
          <h2 id="hub-rotation-heading" class="sr-only">Rotation and block lock</h2>
          {#if editor && pendingRotation}
            <RotationEditor
              {editor}
              disabled={block?.phase === 'running'}
              onchange={() => {
                submitError = null;
              }}
            />
          {:else}
            <p class="font-mono text-sm text-muted-foreground">Preparing the rotation editor…</p>
          {/if}

          {#if preview}
            <LockPreview {preview} {franchiseName} />
          {/if}

          <div class="flex flex-col gap-3">
            {#if rotationFailures.length > 0}
              <p
                role="alert"
                class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                The rotation is invalid — fix the highlighted issues before submitting.
              </p>
            {/if}
            {#if submitError}
              <p
                role="alert"
                class="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                {submitError}
              </p>
            {/if}
            <button
              type="button"
              onclick={submitBlock}
              disabled={!canSubmit}
              class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {block?.phase === 'running'
                ? 'Simulating block…'
                : 'Lock rotation and simulate block'}
            </button>
            <p class="font-mono text-[10px] text-muted-foreground">
              Rejections are typed: stale cursor, duplicate command, invalid rotations, non-boundary
              block, or run mismatch. Nothing is persisted until the checkpoint passes validation.
            </p>
          </div>
        </section>
      {/if}

      <!-- Standings -->
      <section aria-labelledby="hub-standings-heading">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="hub-standings-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            Standings
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            After {snapshot.acceptedBlocks.length * 10 > 82
              ? 82
              : snapshot.acceptedBlocks.length * 10}
            team games{snapshot.acceptedBlocks.length === 9 ? ' (final)' : ''}
          </span>
        </div>
        <div class="mt-3">
          <StandingsTable
            standings={run!.standings}
            league={run!.league}
            {humanFranchiseId}
            {franchiseName}
            {streakOf}
          />
        </div>
      </section>

      <!-- Schedule / results -->
      <section aria-labelledby="hub-schedule-heading" class="rounded-xl bg-surface-1">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <h2
            id="hub-schedule-heading"
            class="font-display text-base font-extrabold uppercase tracking-tight"
          >
            Schedule & results
          </h2>
          <span class="font-mono text-[10px] text-muted-foreground">
            {scheduleRows.filter((row) => row.game.status !== 'scheduled').length} of 82 played
          </span>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[40rem] text-sm">
            <thead>
              <tr
                class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                <th scope="col" class="px-4 py-2 text-left font-medium">R</th>
                <th scope="col" class="px-4 py-2 text-left font-medium">Matchup</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {#each scheduleRows as row (row.game.gameId)}
                <tr class="border-b border-border/40">
                  <td class="px-4 py-1.5 font-mono text-[10px] text-muted-foreground">
                    {row.game.round}
                  </td>
                  <td class="px-4 py-1.5">
                    {row.humanIsHome ? 'vs' : 'at'}
                    {franchiseName(row.opponentFranchiseId)}
                  </td>
                  <td class="px-4 py-1.5 text-right">
                    {#if row.won === null}
                      <span class="font-mono text-[10px] text-muted-foreground">scheduled</span>
                    {:else}
                      <span
                        class="font-semibold {row.won ? 'text-primary' : 'text-muted-foreground'}"
                      >
                        {row.won ? 'W' : 'L'}
                      </span>
                      <span class="ml-2 font-mono text-[10px]">
                        {row.humanScore}–{row.opponentScore}
                        {#if row.game.status === 'forfeit'}· forfeit{/if}
                      </span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Team summaries -->
      {#if aggregates}
        <section aria-labelledby="hub-team-summaries-heading" class="rounded-xl bg-surface-1">
          <div class="px-4 py-3">
            <h2
              id="hub-team-summaries-heading"
              class="font-display text-base font-extrabold uppercase tracking-tight"
            >
              Team summaries
            </h2>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[40rem] text-sm">
              <thead>
                <tr
                  class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                  <th scope="col" class="px-4 py-2 text-left font-medium">Team</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">GP</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">PPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">RPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">APG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">SPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">BPG</th>
                  <th scope="col" class="px-4 py-2 text-right font-medium">TOPG</th>
                </tr>
              </thead>
              <tbody>
                {#each aggregates.teams as team (team.franchiseId)}
                  <tr class="border-b border-border/40">
                    <th scope="row" class="max-w-44 truncate px-4 py-1.5 text-left font-semibold">
                      {franchiseName(team.franchiseId)}
                    </th>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">{team.gamesPlayed}</td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(team.points / Math.max(1, team.gamesPlayed)).toFixed(1)}
                    </td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(
                        (team.offensiveRebounds + team.defensiveRebounds) /
                        Math.max(1, team.gamesPlayed)
                      ).toFixed(1)}
                    </td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(team.assists / Math.max(1, team.gamesPlayed)).toFixed(1)}
                    </td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(team.steals / Math.max(1, team.gamesPlayed)).toFixed(1)}
                    </td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(team.blocks / Math.max(1, team.gamesPlayed)).toFixed(1)}
                    </td>
                    <td class="px-4 py-1.5 text-right font-mono text-[10px]">
                      {(team.turnovers / Math.max(1, team.gamesPlayed)).toFixed(1)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </section>
      {/if}

      <!-- League leaders -->
      {#if leaders}
        <section aria-labelledby="hub-leaders-heading">
          <h2
            id="hub-leaders-heading"
            class="font-display text-xl font-extrabold tracking-tight uppercase"
          >
            League leaders
          </h2>
          <div class="mt-3">
            <LeadersTable
              tables={leaders}
              {playerName}
              franchiseAbbrev={(franchiseId) => franchiseAbbreviation(franchiseId)}
            />
          </div>
          <p class="mt-1 font-mono text-[10px] text-muted-foreground">
            Folded from accepted game summaries; rate categories require a 70% game share.
          </p>
        </section>
      {/if}

      {#if seasonComplete}
        <div class="flex flex-col gap-3 rounded-xl bg-surface-1 p-6">
          <h2 class="font-display text-xl font-extrabold uppercase tracking-tight">
            Regular season complete
          </h2>
          <p class="text-sm text-muted-foreground">
            All nine checkpoints are accepted. Review the final block recap and the full season
            standings.
          </p>
          <a
            href={resolve('/season/checkpoint')}
            class="inline-flex w-fit items-center justify-center gap-2 rounded-lg bg-primary px-5 py-3 font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
          >
            Review final block recap
          </a>
        </div>
      {/if}

      <p class="font-mono text-[10px] text-muted-foreground">
        run {run!.runId} · seed {run!.rootSeed} · revision {snapshot.acceptedBlocks.length}
      </p>
    </div>
  {/if}
</section>
