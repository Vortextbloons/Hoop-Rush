<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { HoopRushManifest, SeasonGameSummary } from '@hoop-rush/data-contracts';
  import SeasonTeamLogo from '#lib/components/season/SeasonTeamLogo.svelte';
  import RuleBadge from '#lib/components/season/RuleBadge.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '#lib/season/season-shell-context.js';
  import { franchiseIdentityOf } from '#lib/season/season-branding.js';
  import { boxScoreFromSummary } from '#lib/season/season-presentation.js';
  import { homeRuleOf } from '#lib/season/season-evolution-view.js';
  import { postseasonSummaryRow } from '#lib/season/season-postseason-presentation.js';
  import { getSeasonRunRepository } from '#lib/season/season-repo.js';
  import type { SeasonPostseasonSummary } from '@hoop-rush/data-contracts';
  import {
    playedScheduleCount,
    scheduleBlockGroups,
    scheduleBlockRows,
    type ScheduleBlockRow,
  } from '#lib/season/season-schedule-view.js';
  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);
  type ScheduleFilter = 'all' | 'played' | 'upcoming';
  const FILTERS: ReadonlyArray<{
    value: ScheduleFilter;
    label: string;
  }> = [
    { value: 'all', label: 'All' },
    { value: 'played', label: 'Played' },
    { value: 'upcoming', label: 'Upcoming' },
  ];
  let filter = $state<ScheduleFilter>('all');
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
  const rows = $derived(
    shell.run && shell.snapshot && shell.humanFranchiseId
      ? scheduleBlockRows(shell.run.games, shell.snapshot.summaries, shell.humanFranchiseId)
      : [],
  );
  const groups = $derived(scheduleBlockGroups(rows));
  const filteredGroups = $derived(
    groups
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) =>
          filter === 'all' ? true : filter === 'played' ? row.played : !row.played,
        ),
      }))
      .filter((group) => group.rows.length > 0),
  );
  const playedCount = $derived(playedScheduleCount(rows));
  const acceptedBlockIndexes = $derived(
    new Set((shell.snapshot?.acceptedBlocks ?? []).map((block) => block.blockIndex)),
  );
  const playerNames = $derived.by(() => {
    const map = new Map<string, string>();
    for (const roster of shell.run?.rosters ?? []) {
      for (const entry of roster.players) map.set(entry.playerVersionId, entry.displayName);
    }
    return map;
  });
  const playable = $derived.by(() => {
    const map = new Map<string, readonly string[]>();
    for (const roster of shell.run?.rosters ?? []) {
      for (const entry of roster.players) {
        map.set(entry.playerVersionId, shell.playablePositions(entry.playerVersionId));
      }
    }
    return map;
  });
  const summaryByGameId = $derived(
    new Map<string, SeasonGameSummary>(
      (shell.snapshot?.summaries ?? []).map((summary) => [summary.gameId, summary]),
    ),
  );
  const humanFranchiseId = $derived(shell.humanFranchiseId);
  const manifest = $derived(shell.manifest);
  const identityOf = (franchiseId: string) =>
    manifest ? franchiseIdentityOf(manifest, franchiseId) : null;
  function boxFor(row: ScheduleBlockRow) {
    if (!humanFranchiseId || !row.played) return null;
    const summary = summaryByGameId.get(row.gameId);
    if (!summary) return null;
    return boxScoreFromSummary(summary, humanFranchiseId, playerNames, playable);
  }
  function ruleFor(row: ScheduleBlockRow) {
    const summary = summaryByGameId.get(row.gameId);
    if (summary?.gameRule !== undefined) return summary.gameRule;
    const run = shell.run;
    if (run === null) return 'standard' as const;
    return homeRuleOf(run, row.game.homeFranchiseId);
  }
  function resultLabel(row: ScheduleBlockRow): string {
    if (row.won === null) return 'scheduled';
    if (row.forfeit) return row.won ? 'W · forfeit' : 'L · forfeit';
    return row.won ? 'W' : 'L';
  }
  function boxNote(row: ScheduleBlockRow): string | null {
    const summary = summaryByGameId.get(row.gameId);
    if (summary === undefined) return null;
    if (summary.overtimeRace !== undefined) {
      return (
        'First-to-7 OT ' +
        String(summary.overtimeRace.homePoints) +
        '-' +
        String(summary.overtimeRace.awayPoints)
      );
    }
    if (summary.overtimePeriods > 0) return 'OT x' + String(summary.overtimePeriods);
    return null;
  }
  let postseasonSummaries = $state<SeasonPostseasonSummary[] | null>(null);
  let postseasonSummariesError = $state<string | null>(null);
  $effect(() => {
    const runId = shell.run?.runId ?? null;
    const stage = shell.run?.stage ?? null;
    if (runId === null || stage === null || stage === 'regular-season') {
      postseasonSummaries = null;
      postseasonSummariesError = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getSeasonRunRepository();
        const summaries = await repo.loadPostseasonSummaries(runId);
        if (!cancelled) postseasonSummaries = summaries;
      } catch (error) {
        if (!cancelled) {
          postseasonSummariesError = error instanceof Error ? error.message : String(error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  });
  const postseasonRows = $derived(
    (postseasonSummaries ?? []).map((summary) =>
      postseasonSummaryRow(summary, humanFranchiseId ?? ''),
    ),
  );
  const postseasonPlayed = $derived(postseasonRows.length);
</script>

<svelte:head>
  <title>Season Run — schedule — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !shell.run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the schedule…</p>
{:else}
  <section aria-labelledby="schedule-heading" class="min-w-0 pt-6">
    <div class="sr-arrive flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <p class="sr-eyebrow">Season Run</p>
        <h1 id="schedule-heading" class="sr-page-title mt-1">Schedule</h1>
        <p class="mt-1 font-mono text-xs text-muted-foreground">
          <span class="sr-number">{playedCount}</span> of 82 played · 9 blocks
        </p>
      </div>
      <div
        role="group"
        aria-label="Schedule filter"
        class="flex shrink-0 gap-1 self-start rounded-full border border-border bg-surface-2 p-1"
      >
        {#each FILTERS as item (item.value)}
          <button
            type="button"
            aria-pressed={filter === item.value}
            onclick={() => {
              filter = item.value;
            }}
            class="min-h-11 rounded-full px-4 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors {filter ===
            item.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'} motion-reduce:transition-none"
          >
            {item.label}
          </button>
        {/each}
      </div>
    </div>

    {#if filteredGroups.length === 0}
      <p class="sr-panel-quiet mt-8 p-6 text-sm text-muted-foreground">
        No games in this view yet.
      </p>
    {:else}
      <div class="mt-6 flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:gap-6">
        {#each filteredGroups as group (group.blockIndex)}
          <section aria-labelledby={`schedule-block-${group.blockIndex}-heading`}>
            <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`schedule-block-${group.blockIndex}-heading`} class="sr-section-label">
                Block {group.blockIndex + 1} of 9
              </h2>
              <span class="font-mono text-xs text-muted-foreground">
                rounds {group.fromRound}–{group.toRound}
              </span>
              {#if acceptedBlockIndexes.has(group.blockIndex)}
                <a
                  href={resolve(`/season/run/checkpoint/?block=${String(group.blockIndex)}` as any)}
                  class="font-mono text-xs text-primary underline-offset-4 outline-none hover:underline"
                >
                  Block recap
                </a>
              {/if}
            </div>

            <ul class="mt-2 flex flex-col gap-2 md:hidden">
              {#each group.rows as row (row.gameId)}
                {@const box = boxFor(row)}
                <li
                  data-season-schedule-row
                  data-virtual-row
                  data-result={row.won === null ? 'pending' : row.won ? 'win' : 'loss'}
                  class="sr-gamecard"
                >
                  <div
                    class="grid grid-cols-[2rem_auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-3.5 sm:gap-x-3 sm:px-4"
                  >
                    <span class="shrink-0 font-mono text-xs text-muted-foreground">
                      R{row.round}
                    </span>
                    <RuleBadge rule={ruleFor(row)} compact />
                    {#if identityOf(row.opponentFranchiseId)}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={row.opponentFranchiseId}
                        teamExternalId={identityOf(row.opponentFranchiseId)!.teamExternalId}
                        alt={`${shell.franchiseName(row.opponentFranchiseId)} logo`}
                        size="sm"
                      />
                    {:else}
                      <span class="h-7 w-7 shrink-0" aria-hidden="true"></span>
                    {/if}
                    <p class="min-w-0 text-sm font-semibold leading-tight">
                      <span
                        class="mr-1 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        {row.humanIsHome ? 'vs' : 'at'}
                      </span>
                      <span class="break-words">{shell.franchiseName(row.opponentFranchiseId)}</span
                      >
                    </p>
                    <div class="shrink-0 pl-1 text-right tabular-nums">
                      {#if row.won === null}
                        <span class="font-mono text-xs text-muted-foreground">scheduled</span>
                      {:else}
                        <span
                          class="sr-number block text-sm font-extrabold leading-none {row.won
                            ? 'text-positive'
                            : 'text-negative'}"
                        >
                          {row.won ? 'W' : 'L'}
                        </span>
                        <span class="mt-0.5 block font-mono text-xs leading-none">
                          {row.humanScore}–{row.opponentScore}
                          {#if row.forfeit}· forfeit{/if}
                        </span>
                      {/if}
                    </div>
                  </div>
                  {#if box}
                    <details
                      class="group border-t border-border/60"
                      ontoggle={(event) => onBoxScoreToggle(event, row.gameId)}
                    >
                      <summary
                        class="sr-section-label cursor-pointer px-3 py-2 outline-none md:px-4 [&::-webkit-details-marker]:hidden"
                      >
                        Box score
                      </summary>
                      <div class="border-t border-border/40 p-3">
                        {#if openedBoxScores.has(row.gameId)}
                          {#await loadBoxScore() then { default: BoxScore }}
                            <p class="py-2 font-mono text-xs text-muted-foreground">
                              Loading box score…
                            </p>
                            <BoxScore
                              {box}
                              opponentName={shell.franchiseName(row.opponentFranchiseId)}
                              resultLabel={resultLabel(row)}
                              note={boxNote(row)}
                              {manifest}
                              teamFranchiseId={humanFranchiseId}
                              opponentFranchiseId={row.opponentFranchiseId}
                            />
                          {/await}
                        {/if}
                      </div>
                    </details>
                  {/if}
                </li>
              {/each}
            </ul>

            <ul class="mt-2 hidden flex-col gap-2 md:flex">
              {#each group.rows as row (row.gameId)}
                {@const box = boxFor(row)}
                <li
                  data-season-schedule-row
                  data-virtual-row
                  data-result={row.won === null ? 'pending' : row.won ? 'win' : 'loss'}
                  class="sr-gamecard"
                >
                  <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <span class="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                      R{row.round}
                    </span>
                    <RuleBadge rule={ruleFor(row)} compact />
                    {#if identityOf(row.opponentFranchiseId)}
                      <SeasonTeamLogo
                        {manifest}
                        franchiseId={row.opponentFranchiseId}
                        teamExternalId={identityOf(row.opponentFranchiseId)!.teamExternalId}
                        alt=""
                        size="sm"
                      />
                    {/if}
                    <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                      <span
                        class="font-mono text-[10px] text-muted-foreground"
                        aria-label={row.humanIsHome ? 'home' : 'away'}
                      >
                        {row.humanIsHome ? 'vs' : 'at'}
                      </span>
                      <span class="ml-1">
                        {shell.franchiseName(row.opponentFranchiseId)}
                      </span>
                    </span>
                    <span class="shrink-0 text-right tabular-nums">
                      {#if row.won === null}
                        <span class="font-mono text-xs text-muted-foreground">scheduled</span>
                      {:else}
                        <span
                          class="sr-number block text-sm font-extrabold leading-none {row.won
                            ? 'text-positive'
                            : 'text-negative'}"
                        >
                          {row.won ? 'W' : 'L'}
                        </span>
                        <span class="mt-0.5 block font-mono text-xs leading-none">
                          {row.humanScore}–{row.opponentScore}
                          {#if row.forfeit}· forfeit{/if}
                        </span>
                      {/if}
                    </span>
                  </div>
                  {#if box}
                    <details
                      class="group border-t border-border/60"
                      ontoggle={(event) => onBoxScoreToggle(event, row.gameId)}
                    >
                      <summary
                        class="sr-section-label cursor-pointer px-4 py-2 outline-none [&::-webkit-details-marker]:hidden"
                      >
                        Box score
                      </summary>
                      <div class="border-t border-border/40 p-3">
                        {#if openedBoxScores.has(row.gameId)}
                          {#await loadBoxScore() then { default: BoxScore }}
                            <p class="py-2 font-mono text-xs text-muted-foreground">
                              Loading box score…
                            </p>
                            <BoxScore
                              {box}
                              opponentName={shell.franchiseName(row.opponentFranchiseId)}
                              resultLabel={resultLabel(row)}
                              note={boxNote(row)}
                              {manifest}
                              teamFranchiseId={humanFranchiseId}
                              opponentFranchiseId={row.opponentFranchiseId}
                            />
                          {/await}
                        {/if}
                      </div>
                    </details>
                  {/if}
                </li>
              {/each}
            </ul>
          </section>
        {/each}
      </div>
    {/if}

    {#if postseasonSummariesError !== null}
      <p
        role="alert"
        class="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        Could not load postseason results: {postseasonSummariesError}
      </p>
    {:else if postseasonSummaries === null && (shell.run?.stage ?? 'regular-season') !== 'regular-season'}
      <p class="mt-6 font-mono text-sm text-muted-foreground">Loading postseason results…</p>
    {:else if postseasonRows.length > 0}
      <section aria-labelledby="postseason-schedule-heading" class="mt-8">
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="postseason-schedule-heading" class="sr-section-label">Postseason</h2>
          <span class="font-mono text-xs text-muted-foreground">
            {postseasonPlayed} game{postseasonPlayed === 1 ? '' : 's'} played · Play-In and playoffs
          </span>
        </div>
        <ul class="mt-2 hidden flex-col gap-2 md:flex">
          {#each postseasonRows as row (row.summary.gameId)}
            <li
              data-season-postseason-schedule-row
              data-result={row.humanGame ? (row.humanWon === true ? 'win' : 'loss') : undefined}
              class="sr-gamecard"
            >
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                <span class="w-24 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {row.phaseLabel} · {row.roundLabel}
                </span>
                <span class="flex min-w-0 flex-1 items-center gap-2">
                  {#if identityOf(row.summary.awayFranchiseId)}
                    <SeasonTeamLogo
                      {manifest}
                      franchiseId={row.summary.awayFranchiseId}
                      teamExternalId={identityOf(row.summary.awayFranchiseId)!.teamExternalId}
                      alt=""
                      size="sm"
                    />
                  {/if}
                  <span class="min-w-0 truncate text-sm font-semibold">
                    {shell.franchiseName(row.summary.awayFranchiseId)}
                    <span class="font-normal text-muted-foreground">at</span>
                    {shell.franchiseName(row.summary.homeFranchiseId)}
                  </span>
                </span>
                <span class="shrink-0 text-right tabular-nums">
                  <span
                    class="sr-number block text-sm font-extrabold leading-none {row.humanWon ===
                    true
                      ? 'text-positive'
                      : row.humanWon === false
                        ? 'text-negative'
                        : ''}"
                  >
                    {row.humanGame ? (row.humanWon === true ? 'W' : 'L') : ''}
                  </span>
                  <span class="mt-0.5 block font-mono text-xs leading-none">
                    {row.scoreLabel}
                  </span>
                </span>
              </div>
            </li>
          {/each}
        </ul>
        <ul class="mt-2 flex flex-col gap-2 md:hidden">
          {#each postseasonRows as row (row.summary.gameId)}
            <li
              data-season-postseason-schedule-row
              data-result={row.humanGame ? (row.humanWon === true ? 'win' : 'loss') : undefined}
              class="sr-gamecard"
            >
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3">
                <span class="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                  {row.phaseLabel}
                  {row.roundLabel}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                  {shell.franchiseName(row.summary.awayFranchiseId)}
                  <span class="font-normal text-muted-foreground">at</span>
                  {shell.franchiseName(row.summary.homeFranchiseId)}
                </span>
                <span class="shrink-0 text-right tabular-nums">
                  <span
                    class="sr-number block text-sm font-extrabold leading-none {row.humanWon ===
                    true
                      ? 'text-positive'
                      : row.humanWon === false
                        ? 'text-negative'
                        : ''}"
                  >
                    {row.humanGame ? (row.humanWon === true ? 'W' : 'L') : ''}
                  </span>
                  <span
                    class="mt-0.5 block font-mono text-[10px] leading-none text-muted-foreground"
                  >
                    {row.scoreLabel}
                  </span>
                </span>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </section>
{/if}
