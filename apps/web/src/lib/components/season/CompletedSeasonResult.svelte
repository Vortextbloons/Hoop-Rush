<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import { goto } from '$app/navigation';
  import { Dialog } from 'bits-ui';
  import { blockRoundRange, type SeasonBlockRecap } from '@hoop-rush/data-contracts';
  import type { SeasonCompletedRunIndexEntry, SeasonCompletedSeason } from '@hoop-rush/persistence';
  import { getSeasonRunRepository } from '$lib/season/season-repo';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import {
    deriveBlockRecap,
    foldSeasonAggregates,
    LEADER_CATEGORY_LABELS,
    recordLabel,
  } from '$lib/season/season-presentation';
  import { engineOrderLeaderTables, LEADER_CATEGORIES } from '$lib/season/season-leaders-view';
  import { humanInjuryTimeline, INJURY_SEVERITY_LABEL } from '$lib/season/season-health-view';
  import {
    postseasonRankingsOf,
    postseasonSummaryRow,
    rankedEntriesOf,
  } from '$lib/season/season-postseason-presentation';
  import {
    buildCompletedSeasonRunReplayExport,
    deriveCompletedSeasonTradeGrades,
  } from '$lib/season/season-completed-export';
  import AwardsSection from '$lib/components/season/AwardsSection.svelte';
  import ChampionSummary from '$lib/components/season/ChampionSummary.svelte';
  import PostseasonBracket from '$lib/components/season/PostseasonBracket.svelte';
  import StandingsTable from '$lib/components/season/StandingsTable.svelte';
  import TiebreakExplanations from '$lib/components/season/TiebreakExplanations.svelte';

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  let {
    runId,
  }: {
    runId: string;
  } = $props();

  let completed = $state<SeasonCompletedSeason | null>(null);
  let indexEntry = $state<SeasonCompletedRunIndexEntry | null>(null);
  let loadError = $state<string | null>(null);
  let loadedRunId = $state<string | null>(null);

  async function loadResult(): Promise<void> {
    if (runId === '' || runId === loadedRunId) return;
    loadedRunId = runId;
    completed = null;
    indexEntry = null;
    loadError = null;
    try {
      const repo = await getSeasonRunRepository();
      const [season, entries] = await Promise.all([
        repo.loadCompletedSeason(runId),
        repo.listCompletedSeasonRuns(),
      ]);
      if (season === null) {
        loadError = `No completed season with run id ${runId} was found on this device.`;
        return;
      }
      completed = season;
      indexEntry = entries.find((entry) => entry.runId === runId) ?? null;
    } catch (error) {
      loadError = error instanceof Error ? error.message : String(error);
    }
  }

  $effect(() => {
    void loadResult();
  });

  const run = $derived(completed?.run ?? null);
  const humanFranchiseId = $derived(
    run !== null
      ? (run.league.teams.find((entry) => entry.control === 'human')?.franchiseId ?? null)
      : null,
  );

  const rankings = $derived(run !== null ? postseasonRankingsOf(run) : null);
  const rankedEntries = $derived(
    run !== null && rankings !== null ? rankedEntriesOf(rankings, run.standings) : [],
  );

  const postseasonRows = $derived(
    (completed?.postseasonSummaries ?? []).map((summary) =>
      postseasonSummaryRow(summary, humanFranchiseId ?? ''),
    ),
  );

  const rosterByVersion = $derived.by(() => {
    const map = new Map<string, { displayName: string; franchiseId: string }>();
    for (const roster of run?.rosters ?? []) {
      for (const entry of roster.players) {
        map.set(entry.playerVersionId, {
          displayName: entry.displayName,
          franchiseId: entry.franchiseId,
        });
      }
    }
    return map;
  });
  const playerName = $derived(
    (playerVersionId: string): string =>
      rosterByVersion.get(playerVersionId)?.displayName ?? playerVersionId,
  );

  const humanRoster = $derived(
    run?.rosters.find((roster) => roster.franchiseId === humanFranchiseId) ?? null,
  );
  const injuryTimeline = $derived(
    run !== null && humanRoster !== null
      ? humanInjuryTimeline(run.health, humanRoster, humanFranchiseId ?? '', completed?.summaries)
      : [],
  );

  const blockRecaps = $derived.by((): Array<{ blockIndex: number; recap: SeasonBlockRecap }> => {
    const currentRun = run;
    const allSummaries = completed?.summaries ?? [];
    if (currentRun === null || humanFranchiseId === null) return [];
    const result: Array<{ blockIndex: number; recap: SeasonBlockRecap }> = [];
    for (let blockIndex = 0; blockIndex < 9; blockIndex += 1) {
      const { fromRound, toRound } = blockRoundRange(blockIndex);
      const blockSummaries = allSummaries.filter(
        (summary) => summary.round >= fromRound && summary.round <= toRound,
      );
      if (blockSummaries.length === 0) continue;
      const recap = deriveBlockRecap({
        runId: currentRun.runId,
        blockIndex,
        completedRounds: Math.min((blockIndex + 1) * 10, 82),
        standings: currentRun.standings,
        league: currentRun.league,
        blockSummaries,
        allSummaries,
        rosters: currentRun.rosters.flatMap((roster) => roster.players),
        games: currentRun.games,
        humanFranchiseId,
        run: currentRun,
      });
      result.push({ blockIndex, recap });
    }
    return result;
  });

  const aggregates = $derived(completed ? foldSeasonAggregates(completed.summaries) : null);
  const leaderTables = $derived(
    aggregates ? engineOrderLeaderTables(aggregates.players, aggregates.teams) : null,
  );

  const transactions = $derived(run?.transactions ?? []);
  const humanTransactions = $derived(
    transactions.filter(
      (entry) => entry.franchiseId === null || entry.franchiseId === humanFranchiseId,
    ),
  );

  let exportingGameId = $state<string | null>(null);
  let exportingFullRun = $state(false);
  let exportError = $state<string | null>(null);

  const humanTradeGrades = $derived.by(() => {
    const season = completed;
    const franchiseId = humanFranchiseId;
    if (season === null || franchiseId === null) return [];
    const grades = deriveCompletedSeasonTradeGrades(season);
    return grades.grades.filter((grade) => grade.franchiseId === franchiseId);
  });

  function downloadJson(filename: string, payload: unknown): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function exportGame(gameId: string): Promise<void> {
    if (exportingGameId !== null || exportingFullRun) return;
    exportingGameId = gameId;
    exportError = null;
    try {
      const repo = await getSeasonRunRepository();
      const artifact = await repo.buildReplayExport(runId, gameId);
      if (artifact === null) {
        exportError = 'No replay export is available for that game.';
        return;
      }
      downloadJson(`hoop-rush-replay-${runId}-${gameId}.json`, artifact);
    } catch (error) {
      exportError = error instanceof Error ? error.message : String(error);
    } finally {
      exportingGameId = null;
    }
  }

  async function exportFullRun(): Promise<void> {
    if (exportingGameId !== null || exportingFullRun || completed === null) return;
    exportingFullRun = true;
    exportError = null;
    try {
      const artifact = buildCompletedSeasonRunReplayExport(completed, shell.manifest);
      downloadJson(`hoop-rush-replay-${runId}-full-run.json`, artifact);
    } catch (error) {
      exportError = error instanceof Error ? error.message : String(error);
    } finally {
      exportingFullRun = false;
    }
  }

  let deleteOpen = $state(false);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  async function confirmDelete(): Promise<void> {
    if (deleting) return;
    deleting = true;
    deleteError = null;
    try {
      const repo = await getSeasonRunRepository();
      await repo.deleteCompletedSeason(runId);
      deleteOpen = false;
      await goto(resolve('/season/run/history'));
    } catch (error) {
      deleteError = error instanceof Error ? error.message : String(error);
    } finally {
      deleting = false;
    }
  }
</script>

{#if loadError !== null}
  <section aria-labelledby="result-error-heading" class="min-w-0 pt-6">
    <div
      id="result-error-heading"
      role="alert"
      class="mx-auto w-full max-w-xl rounded-xl border border-destructive/40 bg-destructive/10 p-6"
    >
      <h1 class="font-display text-xl font-extrabold uppercase tracking-tight">
        Season result unavailable
      </h1>
      <p class="mt-2 text-sm text-muted-foreground">
        The stored completed season failed validation or is missing. It stays on this device;
        nothing was deleted.
      </p>
      <p class="mt-2 font-mono text-xs text-destructive">{loadError}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onclick={() => {
            loadedRunId = null;
            void loadResult();
          }}
          class="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity outline-none focus-visible:ring-2 focus-visible:ring-ring hover:opacity-90"
        >
          Try again
        </button>
        <a
          href={resolve('/season/run/history')}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Back to history
        </a>
      </div>
    </div>
  </section>
{:else if completed === null || run === null}
  <p class="py-10 font-mono text-sm text-muted-foreground" aria-live="polite">
    Loading the completed season…
  </p>
{:else}
  <section aria-labelledby="result-heading" class="min-w-0 pt-6">
    <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · completed season
        </p>
        <h1
          id="result-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          {run.postseason.championFranchiseId !== null
            ? shell.franchiseName(run.postseason.championFranchiseId)
            : 'Season'}
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          run {run.runId} · seed {run.rootSeed.slice(0, 16)}
          {#if indexEntry !== null}
            · completed {new Date(indexEntry.completedAtIso).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          {/if}
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <a
          href={resolve('/season/run/history')}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground"
        >
          Back to history
        </a>
        <button
          type="button"
          data-season-history-delete
          onclick={() => (deleteOpen = true)}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10"
        >
          Delete season
        </button>
      </div>
    </div>

    <div class="mt-6">
      <ChampionSummary
        championFranchiseId={run.postseason.championFranchiseId}
        franchiseName={shell.franchiseName}
        franchiseAbbrev={shell.franchiseAbbrev}
        manifest={shell.manifest}
        completion={run.completion}
        humanWon={humanFranchiseId !== null &&
          run.postseason.championFranchiseId === humanFranchiseId}
      />
    </div>

    <div class="mt-8">
      <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Final bracket</h2>
      <div class="mt-3">
        <PostseasonBracket
          postseason={run.postseason}
          franchiseName={shell.franchiseName}
          franchiseAbbrev={shell.franchiseAbbrev}
          manifest={shell.manifest}
          {humanFranchiseId}
        />
      </div>
    </div>

    <div class="mt-8">
      <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
        Final standings
      </h2>
      <div class="mt-3">
        <StandingsTable
          standings={run.standings}
          league={run.league}
          {humanFranchiseId}
          franchiseName={shell.franchiseName}
          streakOf={() => null}
          manifest={shell.manifest}
          rankedOrder={rankedEntries}
        />
      </div>
      <div class="mt-4">
        <TiebreakExplanations
          resolutions={run.postseason.tiebreakResolutions}
          franchiseName={shell.franchiseName}
        />
      </div>
    </div>

    {#if postseasonRows.length > 0}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
          Postseason results
        </h2>
        <ul class="mt-3 flex flex-col gap-1">
          {#each postseasonRows as row (row.summary.gameId)}
            <li
              data-season-history-postseason-game={row.summary.gameId}
              class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-1 px-4 py-2.5"
            >
              <span class="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.phaseLabel} · {row.roundLabel}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                {shell.franchiseName(row.summary.awayFranchiseId)}
                <span class="font-normal text-muted-foreground">at</span>
                {shell.franchiseName(row.summary.homeFranchiseId)}
              </span>
              <span
                class="shrink-0 font-mono text-xs font-bold {row.humanWon === true
                  ? 'text-primary'
                  : ''}"
              >
                {row.humanGame ? (row.humanWon === true ? 'W ' : 'L ') : ''}{row.scoreLabel}
              </span>
              <button
                type="button"
                data-season-history-export={row.summary.gameId}
                onclick={() => void exportGame(row.summary.gameId)}
                disabled={exportingGameId !== null || exportingFullRun}
                class="shrink-0 rounded-lg border border-border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                {exportingGameId === row.summary.gameId ? 'Exporting…' : 'Export'}
              </button>
            </li>
          {/each}
        </ul>
        {#if exportError !== null}
          <p role="alert" class="mt-2 text-sm text-destructive">{exportError}</p>
        {/if}
        <p class="mt-2 font-mono text-[10px] text-muted-foreground">
          Export downloads a self-contained replay of that game (scores, player lines, and the
          recorded result digest).
        </p>
      </div>
    {/if}

    {#if run.awards !== null}
      <div class="mt-8">
        <AwardsSection
          awards={run.awards}
          {playerName}
          franchiseName={shell.franchiseName}
          manifest={shell.manifest}
          faces={new Map()}
        />
      </div>
    {/if}

    {#if leaderTables !== null}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
          Regular-season leaders
        </h2>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Top three per category · engine ordering (per-game desc, then value)
        </p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {#each LEADER_CATEGORIES as category (category)}
            <div class="rounded-xl border border-border bg-surface-1 p-3">
              <p
                class="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
              >
                {LEADER_CATEGORY_LABELS[category]}
              </p>
              <ol class="mt-1 flex flex-col divide-y divide-border/40">
                {#each (leaderTables[category] ?? []).slice(0, 3) as entry, rank (entry.playerVersionId)}
                  <li class="flex items-center gap-2 py-1.5 text-sm">
                    <span
                      class="w-4 shrink-0 font-mono text-[10px] font-bold text-muted-foreground"
                    >
                      {rank + 1}
                    </span>
                    <span class="min-w-0 flex-1 truncate font-semibold">
                      {playerName(entry.playerVersionId)}
                    </span>
                    <span class="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {Number.isInteger(entry.perGame)
                        ? String(entry.perGame)
                        : entry.perGame.toFixed(1)}
                    </span>
                  </li>
                {/each}
              </ol>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if blockRecaps.length > 0}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">
          Regular-season recaps
        </h2>
        <ul class="mt-3 flex flex-col gap-1">
          {#each blockRecaps as entry (entry.blockIndex)}
            <li class="rounded-lg bg-surface-1 px-4 py-3">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span class="font-mono text-[10px] font-bold uppercase text-primary">
                  Block {entry.blockIndex + 1} of 9
                </span>
                {#if entry.recap.humanRecord !== null}
                  <span class="font-mono text-xs font-bold">
                    {recordLabel(
                      entry.recap.humanRecord.winsAfter,
                      entry.recap.humanRecord.lossesAfter,
                    )}
                  </span>
                  <span class="font-mono text-[10px] text-muted-foreground">
                    {entry.recap.humanRecord.positionBefore > 0
                      ? `moved ${String(entry.recap.humanRecord.positionBefore)} → ${String(entry.recap.humanRecord.positionAfter)} in conference`
                      : ''}
                  </span>
                {/if}
              </div>
              {#if entry.recap.notablePerformances.length > 0}
                <p class="mt-1 truncate text-sm text-muted-foreground">
                  {playerName(entry.recap.notablePerformances[0]?.playerVersionId ?? '')}
                  {String(entry.recap.notablePerformances[0]?.points ?? 0)} points
                  {#if entry.recap.notablePerformances.length > 1}
                    ·
                    {playerName(entry.recap.notablePerformances[1]?.playerVersionId ?? '')}
                    {String(entry.recap.notablePerformances[1]?.points ?? 0)} points
                  {/if}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if injuryTimeline.length > 0}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Injuries</h2>
        <ul class="mt-3 flex flex-col gap-1">
          {#each injuryTimeline as player (player.playerVersionId)}
            <li class="rounded-lg bg-surface-1 px-4 py-2.5">
              <p class="text-sm font-semibold">{player.displayName}</p>
              <ul class="mt-1 flex flex-col gap-0.5">
                {#each player.entries as injury (injury.injuryId)}
                  <li class="font-mono text-[10px] text-muted-foreground">
                    {INJURY_SEVERITY_LABEL[injury.severity]} · {injury.missedGamesTotal} game
                    {injury.missedGamesTotal === 1 ? 'out' : 's out'}
                    {#if injury.missedGamesRemaining === 0}
                      <span class="text-positive"> · returned</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if humanTransactions.length > 0}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Transactions</h2>
        <ul class="mt-3 flex flex-col gap-1">
          {#each humanTransactions.slice(-12).reverse() as entry (entry.transactionId)}
            <li class="rounded-lg bg-surface-1 px-4 py-2.5 text-sm">
              <span
                class="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {entry.type}
              </span>
              <span class="ml-2">{entry.explanation}</span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if humanTradeGrades.length > 0}
      <div class="mt-8">
        <h2 class="font-display text-base font-extrabold uppercase tracking-tight">Trade grades</h2>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          Post-trade production, availability, minutes, and team trend from recorded facts
        </p>
        <ul class="mt-3 flex flex-col gap-1">
          {#each humanTradeGrades as grade (grade.gradeId)}
            <li class="rounded-lg bg-surface-1 px-4 py-2.5 text-sm">
              <div class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span class="font-mono text-lg font-bold tracking-tight">{grade.label}</span>
                <span class="font-mono text-[10px] text-muted-foreground">
                  window {grade.windowIndex + 1} · score {grade.score}
                  {#if grade.neutral}
                    · limited sample
                  {/if}
                </span>
              </div>
              <p class="mt-1 text-muted-foreground">{grade.reasons[0]}</p>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="mt-8 flex flex-wrap items-center gap-3">
      <button
        type="button"
        data-season-history-export-full-run
        onclick={() => void exportFullRun()}
        disabled={exportingGameId !== null || exportingFullRun}
        class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
      >
        {exportingFullRun ? 'Exporting full run…' : 'Export full-run replay'}
      </button>
      <p class="font-mono text-[10px] text-muted-foreground">
        Includes the command log, almanac, and postseason summaries for `season run reproduce`.
      </p>
    </div>
  </section>
{/if}

<Dialog.Root
  open={deleteOpen}
  onOpenChange={(open) => {
    if (!open && !deleting) deleteOpen = false;
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
    <Dialog.Content
      class="fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl shadow-black/40 outline-none sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:pb-4"
    >
      <div class="flex items-start justify-between gap-3">
        <Dialog.Title class="font-display truncate text-lg font-extrabold tracking-tight uppercase">
          Delete this season?
        </Dialog.Title>
      </div>
      <p class="mt-2 text-sm text-muted-foreground">
        This permanently deletes the completed season — its champion, bracket, awards, and results —
        from this browser. It cannot be recovered.
      </p>
      {#if deleteError}
        <p
          role="alert"
          class="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
        >
          {deleteError}
        </p>
      {/if}
      <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onclick={() => (deleteOpen = false)}
          disabled={deleting}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          Keep it
        </button>
        <button
          type="button"
          onclick={() => void confirmDelete()}
          disabled={deleting}
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/50 px-4 py-2 text-sm font-semibold text-destructive transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {deleting ? 'Deleting…' : 'Delete season'}
        </button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
