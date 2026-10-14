<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type {
    SeasonGameSummary,
    SeasonRetainedGameDetail,
    SeasonRosterEntry,
  } from '@hoop-rush/data-contracts';
  import { blockRoundRange } from '@hoop-rush/data-contracts';
  import CheckpointRecap from '#lib/components/season/CheckpointRecap.svelte';
  import SeasonTeamLogo from '#lib/components/season/SeasonTeamLogo.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '#lib/season/season-shell-context.js';
  import { franchiseIdentityOf } from '#lib/season/season-branding.js';
  import { aggregateMechanismEvidence } from '#lib/season/season-effects-view.js';
  import { homeRuleOf } from '#lib/season/season-evolution-view.js';
  import { seasonInnovationImpactOf } from '#lib/season/season-innovation-impact-view.js';
  import {
    boxScoreFromSummary,
    deriveBlockRecap,
    ordinal,
    progressLabel,
    summariesDigest,
  } from '#lib/season/season-presentation.js';
  import { availabilityStripRows } from '#lib/season/season-health-view.js';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  let blockSummaries = $state<SeasonGameSummary[]>([]);
  let retainedGameIds = $state<string[]>([]);
  let blockDetails = $state<SeasonRetainedGameDetail[]>([]);
  let retainedDetails = $state<SeasonRetainedGameDetail[]>([]);
  let loadError = $state<string | null>(null);
  let openedBoxScores = $state.raw(new Set<string>());
  function onBoxScoreToggle(event: Event, gameId: string) {
    if (!(event.currentTarget instanceof HTMLDetailsElement)) return;
    if (!event.currentTarget.open || openedBoxScores.has(gameId)) return;
    openedBoxScores = new Set([...openedBoxScores, gameId]);
  }
  let boxScoreModule: Promise<typeof import('#lib/components/season/BoxScore.svelte')> | null =
    null;
  function loadBoxScore(): Promise<typeof import('#lib/components/season/BoxScore.svelte')> {
    boxScoreModule ??= import('#lib/components/season/BoxScore.svelte');
    return boxScoreModule;
  }
  const requestedBlock = $derived.by(() => {
    const raw = page.url.searchParams.get('block');
    if (raw === null || raw.trim() === '') return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const acceptedBlocks = $derived(shell.snapshot?.acceptedBlocks ?? []);
  const lastAcceptedIndex = $derived(
    acceptedBlocks.length > 0 ? acceptedBlocks[acceptedBlocks.length - 1]!.blockIndex : null,
  );
  const requestedOutOfRange = $derived(
    requestedBlock !== null && (requestedBlock < 0 || requestedBlock > 8),
  );
  const requestedNotAccepted = $derived(
    requestedBlock !== null &&
      !requestedOutOfRange &&
      !acceptedBlocks.some((block) => block.blockIndex === requestedBlock),
  );
  const displayBlock = $derived(
    requestedOutOfRange || requestedNotAccepted
      ? null
      : requestedBlock !== null
        ? requestedBlock
        : lastAcceptedIndex,
  );
  const acceptedBlock = $derived(
    displayBlock === null
      ? null
      : (acceptedBlocks.find((block) => block.blockIndex === displayBlock) ?? null),
  );
  const run = $derived(shell.run);
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);
  const playerNames = $derived.by(() => {
    const map = new Map<string, string>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });
  const playable = $derived.by(() => {
    const map = new Map<string, readonly string[]>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) {
        map.set(entry.playerVersionId, shell.playablePositions(entry.playerVersionId));
      }
    }
    return map;
  });
  const rosterByVersion = $derived.by(() => {
    const map = new Map<string, SeasonRosterEntry>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry);
    }
    return map;
  });
  $effect(() => {
    if (import.meta.env.SSR) return;
    const hub = shell.hub;
    const runId = run?.runId;
    const blockIndex = displayBlock;
    if (hub === null || runId === undefined || blockIndex === null) return;
    let cancelled = false;
    blockSummaries = [];
    retainedGameIds = [];
    blockDetails = [];
    retainedDetails = [];
    loadError = null;
    Promise.all([hub.loadBlockSummaries(runId, blockIndex), hub.loadRetainedDetails(runId)])
      .then(([summaries, details]) => {
        if (cancelled) return;
        blockSummaries = summaries;
        retainedDetails = details;
        const { fromRound, toRound } = blockRoundRange(blockIndex);
        blockDetails = details.filter(
          (detail) => detail.round >= fromRound && detail.round <= toRound,
        );
        retainedGameIds = blockDetails.map((detail) => detail.gameId);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        loadError = error instanceof Error ? error.message : String(error);
      });
    return () => {
      cancelled = true;
    };
  });
  const humanGames = $derived(
    blockSummaries.filter(
      (summary) =>
        summary.homeFranchiseId === humanFranchiseId ||
        summary.awayFranchiseId === humanFranchiseId,
    ),
  );
  const recapCache = new Map<string, ReturnType<typeof deriveBlockRecap>>();
  function memoizedRecap(
    input: Parameters<typeof deriveBlockRecap>[0],
  ): ReturnType<typeof deriveBlockRecap> {
    const key = `${input.runId}:${String(input.blockIndex)}:${String(input.completedRounds)}:${summariesDigest(input.blockSummaries)}:${summariesDigest(input.allSummaries)}:${input.humanFranchiseId}:${input.run.stateRevision}`;
    const hit = recapCache.get(key);
    if (hit !== undefined) return hit;
    const computed = deriveBlockRecap(input);
    recapCache.set(key, computed);
    if (recapCache.size > 4) {
      const oldest = recapCache.keys().next().value;
      if (oldest !== undefined) recapCache.delete(oldest);
    }
    return computed;
  }
  const recap = $derived.by(() => {
    if (!run || !humanFranchiseId || !acceptedBlock || !shell.snapshot) return null;
    return memoizedRecap({
      runId: run.runId,
      blockIndex: acceptedBlock.blockIndex,
      completedRounds: acceptedBlock.completedRounds,
      standings: run.standings,
      league: run.league,
      blockSummaries,
      allSummaries: shell.snapshot.summaries,
      rosters: run.rosters.flatMap((roster) => roster.players),
      games: run.games,
      humanFranchiseId,
      run,
    });
  });
  const effectsEvidence = $derived(aggregateMechanismEvidence(blockDetails));
  const innovationRule = $derived(
    run !== null && humanFranchiseId !== null ? homeRuleOf(run, humanFranchiseId) : 'standard',
  );
  const innovationImpact = $derived.by(() => {
    if (humanFranchiseId === null || innovationRule === 'standard') return null;
    return seasonInnovationImpactOf({
      summaries: shell.snapshot?.summaries ?? [],
      details: retainedDetails,
      humanFranchiseId,
      rule: innovationRule,
    });
  });
  const blockInnovationImpact = $derived.by(() => {
    if (humanFranchiseId === null || innovationRule === 'standard') return null;
    return seasonInnovationImpactOf({
      summaries: blockSummaries,
      details: blockDetails,
      humanFranchiseId,
      rule: innovationRule,
    });
  });
  const healthRows = $derived.by(() => {
    if (!run || !humanFranchiseId) return [];
    const roster = run.rosters.find((r) => r.franchiseId === humanFranchiseId);
    if (roster === undefined) return [];
    const humanGames = run.games.filter(
      (game) =>
        game.homeFranchiseId === humanFranchiseId || game.awayFranchiseId === humanFranchiseId,
    );
    return availabilityStripRows(run.health, roster, humanGames, playerNames);
  });
  function boxFor(summary: SeasonGameSummary) {
    if (!humanFranchiseId) return null;
    return boxScoreFromSummary(summary, humanFranchiseId, playerNames, playable);
  }
  function resultLabel(summary: SeasonGameSummary): string {
    if (summary.status === 'forfeit') {
      return summary.forfeitLoserFranchiseId === humanFranchiseId ? 'L · forfeit' : 'W · forfeit';
    }
    const won =
      summary.homeFranchiseId === humanFranchiseId
        ? summary.homeScore > summary.awayScore
        : summary.awayScore > summary.homeScore;
    return won ? 'W' : 'L';
  }
  const opponentOf = (summary: SeasonGameSummary): string =>
    summary.homeFranchiseId === humanFranchiseId
      ? summary.awayFranchiseId
      : summary.homeFranchiseId;
  const identityOf = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;
  const hubHref = resolve('/season/run' as any);
</script>

<svelte:head>
  <title>Season Run — Block — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Loading Block…</p>
{:else if loadError}
  <p class="mt-8 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
    Failed to load block: {loadError}
  </p>
{:else if acceptedBlocks.length === 0}
  <div class="sr-panel mt-10 flex flex-col gap-4 p-6">
    <p class="font-mono text-sm text-muted-foreground">No block yet — submit the first block.</p>
    <a href={hubHref} class="sr-btn w-fit"> Open Hub </a>
  </div>
{:else if requestedOutOfRange}
  <div class="sr-panel mt-10 flex flex-col gap-4 p-6">
    <p class="font-mono text-sm text-muted-foreground">That block doesn't exist.</p>
    <a href={hubHref} class="sr-btn-ghost w-fit"> Back to Hub </a>
  </div>
{:else if requestedNotAccepted}
  <div class="sr-panel mt-10 flex flex-col gap-4 p-6">
    <p class="font-mono text-sm text-muted-foreground">That block hasn't been reached yet.</p>
    <a href={hubHref} class="sr-btn-ghost w-fit"> Back to Hub </a>
  </div>
{:else if displayBlock !== null && recap}
  <section
    data-season-checkpoint-block={displayBlock}
    aria-labelledby="checkpoint-heading"
    class="pt-6"
  >
    <div class="sr-arrive flex items-end justify-between gap-4">
      <div class="min-w-0">
        <p class="sr-eyebrow">Season Run</p>
        <h1 id="checkpoint-heading" class="sr-page-title mt-1">
          Block {displayBlock + 1} recap
        </h1>
        <p class="mt-1 font-mono text-xs text-muted-foreground">
          {progressLabel(recap.completedRounds)} · {ordinal(recap.completedRounds)} rounds
        </p>
      </div>
      <a href={hubHref} class="sr-btn-ghost inline-flex min-h-11 shrink-0 px-3 text-xs"> Hub </a>
    </div>

    <div class="mt-8 flex flex-col gap-8">
      <CheckpointRecap
        {recap}
        humanRecord={recap.humanRecord}
        franchiseName={shell.franchiseName}
        playerName={shell.playerName}
        {manifest}
        faces={shell.facesByVersion}
        {rosterByVersion}
        {effectsEvidence}
        {healthRows}
        {innovationImpact}
        {blockInnovationImpact}
      />

      {#if humanGames.length > 0}
        <section aria-labelledby="checkpoint-boxes-heading">
          <h2 id="checkpoint-boxes-heading" class="sr-section-label">Box scores · your games</h2>
          <div class="mt-3 grid gap-2 sm:gap-3 lg:grid-cols-2 lg:items-start">
            {#each humanGames as summary (summary.gameId)}
              {@const box = boxFor(summary)}
              {@const opponentId = opponentOf(summary)}
              <details
                id={`box-score-${summary.gameId}`}
                data-result={resultLabel(summary).startsWith('W') ? 'win' : 'loss'}
                class="sr-gamecard group"
                ontoggle={(event) => onBoxScoreToggle(event, summary.gameId)}
              >
                <summary
                  class="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm font-semibold outline-none [&::-webkit-details-marker]:hidden"
                >
                  <span class="font-mono text-xs text-muted-foreground">R{summary.round}</span>
                  {#if identityOf(opponentId)}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={opponentId}
                      teamExternalId={identityOf(opponentId)!.teamExternalId}
                      alt={`${shell.franchiseName(opponentId)} logo`}
                      size="sm"
                    />
                  {/if}
                  <span class="min-w-0 flex-1 truncate">
                    {summary.homeFranchiseId === humanFranchiseId ? 'vs ' : 'at '}
                    {shell.franchiseName(opponentId)}
                  </span>
                  <span class="sr-number font-mono text-xs">
                    {summary.homeScore}–{summary.awayScore}
                    {#if summary.status === 'forfeit'}· forfeit{/if}
                  </span>
                  <span
                    class="sr-badge shrink-0"
                    data-tone={resultLabel(summary).startsWith('W') ? 'win' : 'loss'}
                  >
                    {resultLabel(summary)}
                  </span>
                </summary>
                <div class="border-t border-border/60 p-4">
                  {#if box}
                    {#if openedBoxScores.has(summary.gameId)}
                      {#await loadBoxScore() then { default: BoxScore }}
                        <p class="py-2 text-xs text-muted-foreground">Opening box score…</p>
                        <BoxScore
                          {box}
                          opponentName={shell.franchiseName(opponentId)}
                          resultLabel={resultLabel(summary)}
                          {manifest}
                          teamFranchiseId={humanFranchiseId}
                          opponentFranchiseId={opponentId}
                        />
                      {/await}
                    {/if}
                  {:else}
                    <p class="text-sm text-muted-foreground">Box score unavailable.</p>
                  {/if}
                </div>
              </details>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </section>
{:else}
  <p class="py-10 font-mono text-sm text-muted-foreground">Loading Block…</p>
{/if}
