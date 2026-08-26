<script lang="ts">import { getContext } from 'svelte';
import { resolve } from '$app/paths';
import type { RouteId } from '$app/types';
import type { HoopRushManifest, SeasonGameSummary } from '@hoop-rush/data-contracts';
import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
import { SEASON_RUN_SHELL_CONTEXT, type SeasonRunShellData, } from '$lib/season/season-shell-context';
import { franchiseIdentityOf } from '$lib/season/season-branding';
import { boxScoreFromSummary } from '$lib/season/season-presentation';
import { postseasonSummaryRow } from '$lib/season/season-postseason-presentation';
import { getSeasonRunRepository } from '$lib/season/season-repo';
import type { SeasonPostseasonSummary } from '@hoop-rush/data-contracts';
import { playedScheduleCount, scheduleBlockGroups, scheduleBlockRows, type ScheduleBlockRow, } from '$lib/season/season-schedule-view';
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
    if (!(event.currentTarget instanceof HTMLDetailsElement))
        return;
    if (!event.currentTarget.open || openedBoxScores.has(gameId))
        return;
    openedBoxScores = new Set([...openedBoxScores, gameId]);
}
let boxScoreModule: Promise<typeof import('$lib/components/season/BoxScore.svelte')> | null = null;
function loadBoxScore(): Promise<typeof import('$lib/components/season/BoxScore.svelte')> {
    boxScoreModule ??= import('$lib/components/season/BoxScore.svelte');
    return boxScoreModule;
}
let desktopViewport = $state<boolean | null>(null);
$effect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
        return;
    const media = window.matchMedia('(min-width: 768px)');
    const update = () => {
        desktopViewport = media.matches;
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
});
const rows = $derived(shell.run && shell.snapshot && shell.humanFranchiseId
    ? scheduleBlockRows(shell.run.games, shell.snapshot.summaries, shell.humanFranchiseId)
    : []);
const groups = $derived(scheduleBlockGroups(rows));
const filteredGroups = $derived(groups
    .map((group) => ({
    ...group,
    rows: group.rows.filter((row) => filter === 'all' ? true : filter === 'played' ? row.played : !row.played),
}))
    .filter((group) => group.rows.length > 0));
const playedCount = $derived(playedScheduleCount(rows));
const acceptedBlockIndexes = $derived(new Set((shell.snapshot?.acceptedBlocks ?? []).map((block) => block.blockIndex)));
const playerNames = $derived.by(() => {
    const map = new Map<string, string>();
    for (const roster of shell.run?.rosters ?? []) {
        for (const entry of roster.players)
            map.set(entry.playerVersionId, entry.displayName);
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
const summaryByGameId = $derived(new Map((shell.snapshot?.summaries ?? []).map((summary) => [summary.gameId, summary])));
const humanFranchiseId = $derived(shell.humanFranchiseId);
const manifest = $derived(shell.manifest);
const identityOf = (franchiseId: string) => manifest ? franchiseIdentityOf(manifest, franchiseId) : null;
function boxFor(row: ScheduleBlockRow) {
    if (!humanFranchiseId || !row.played)
        return null;
    const summary = summaryByGameId.get(row.gameId);
    if (!summary)
        return null;
    return boxScoreFromSummary(summary, humanFranchiseId, playerNames, playable);
}
function resultLabel(row: ScheduleBlockRow): string {
    if (row.won === null)
        return 'scheduled';
    if (row.forfeit)
        return row.won ? 'W · forfeit' : 'L · forfeit';
    return row.won ? 'W' : 'L';
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
            if (!cancelled)
                postseasonSummaries = summaries;
        }
        catch (error) {
            if (!cancelled) {
                postseasonSummariesError = error instanceof Error ? error.message : String(error);
            }
        }
    })();
    return () => {
        cancelled = true;
    };
});
const postseasonRows = $derived((postseasonSummaries ?? []).map((summary) => postseasonSummaryRow(summary, humanFranchiseId ?? '')));
const postseasonPlayed = $derived(postseasonRows.length);
</script>

<svelte:head>
  <title>Season Run — schedule — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !shell.run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the schedule…</p>
{:else}
  <section aria-labelledby="schedule-heading" class="min-w-0 pt-6">
    <div class="flex flex-col gap-3 px-3 sm:flex-row sm:items-end sm:justify-between sm:px-0">
      <div class="min-w-0">
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · schedule
        </p>
        <h1
          id="schedule-heading"
          class="font-display mt-1 text-2xl font-extrabold tracking-tight uppercase sm:text-3xl"
        >
          Schedule
        </h1>
        <p class="mt-1 font-mono text-xs text-muted-foreground">
          {playedCount} of 82 played · nine checkpoints
        </p>
      </div>
      <div
        role="group"
        aria-label="Schedule filter"
        class="flex shrink-0 self-start rounded-lg bg-surface-2 p-1"
      >
        {#each FILTERS as item (item.value)}
          <button
            type="button"
            aria-pressed={filter === item.value}
            onclick={() => {
              filter = item.value;
            }}
            class="rounded-md px-3 py-1.5 font-mono text-xs font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {filter ===
            item.value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'}"
          >
            {item.label}
          </button>
        {/each}
      </div>
    </div>

    {#if filteredGroups.length === 0}
      <p class="mt-8 rounded-xl bg-surface-1 p-6 text-sm text-muted-foreground">
        No games in this view yet.
      </p>
    {:else}
      <div class="mt-6 flex flex-col gap-8">
        {#each filteredGroups as group (group.blockIndex)}
          <section aria-labelledby={`schedule-block-${group.blockIndex}-heading`}>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-0">
              <h2
                id={`schedule-block-${group.blockIndex}-heading`}
                class="font-display text-lg font-extrabold tracking-tight uppercase"
              >
                Block {group.blockIndex + 1} of 9
              </h2>
              <span class="font-mono text-xs text-muted-foreground">
                rounds {group.fromRound}–{group.toRound}
              </span>
              {#if acceptedBlockIndexes.has(group.blockIndex)}
                <a
                  href={resolve(
                    `/season/run/checkpoint/?block=${String(group.blockIndex)}` as RouteId,
                  )}
                  class="font-mono text-xs text-primary underline-offset-4 hover:underline"
                >
                  Checkpoint recap
                </a>
              {/if}
            </div>

            {#if desktopViewport !== true}
              <ul class="mt-2 flex flex-col gap-0 md:hidden md:gap-2">
                {#each group.rows as row (row.gameId)}
                  {@const box = boxFor(row)}
                  <li data-season-schedule-row class="overflow-hidden bg-surface-1 md:rounded-xl">
                    <div
                      class="grid grid-cols-[2rem_auto_minmax(0,1fr)_auto] items-center gap-x-2 px-3 py-3.5 sm:gap-x-3 sm:px-4"
                    >
                      <span class="shrink-0 font-mono text-xs text-muted-foreground">
                        R{row.round}
                      </span>
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
                        <span class="break-words"
                          >{shell.franchiseName(row.opponentFranchiseId)}</span
                        >
                      </p>
                      <div class="shrink-0 pl-1 text-right tabular-nums">
                        {#if row.won === null}
                          <span class="font-mono text-xs text-muted-foreground">scheduled</span>
                        {:else}
                          <span
                            class="block font-mono text-sm font-bold leading-none {row.won
                              ? 'text-primary'
                              : 'text-muted-foreground'}"
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
                        class="group border-t border-border/50"
                        ontoggle={(event) => onBoxScoreToggle(event, row.gameId)}
                      >
                        <summary
                          class="cursor-pointer px-3 py-2 font-mono text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring md:px-4 [&::-webkit-details-marker]:hidden"
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
            {/if}

            {#if desktopViewport !== false}
              <div class="mt-2 hidden overflow-x-auto rounded-xl bg-surface-1 md:block">
                <table class="w-full min-w-[56rem] text-sm">
                  <caption class="sr-only">
                    Block {group.blockIndex + 1} games — rounds {group.fromRound}–{group.toRound}
                  </caption>
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
                    {#each group.rows as row (row.gameId)}
                      <tr data-season-schedule-row class="border-b border-border/40">
                        <td class="px-4 py-2 font-mono text-[10px] text-muted-foreground">
                          {row.round}
                        </td>
                        <td class="px-4 py-2">
                          <span class="flex items-center gap-2">
                            {#if identityOf(row.opponentFranchiseId)}
                              <SeasonTeamLogo
                                {manifest}
                                franchiseId={row.opponentFranchiseId}
                                teamExternalId={identityOf(row.opponentFranchiseId)!.teamExternalId}
                                alt=""
                                size="sm"
                              />
                            {/if}
                            <span
                              class="font-mono text-[10px] text-muted-foreground"
                              aria-label={row.humanIsHome ? 'home' : 'away'}
                            >
                              {row.humanIsHome ? 'vs' : 'at'}
                            </span>
                            <span class="truncate font-semibold">
                              {shell.franchiseName(row.opponentFranchiseId)}
                            </span>
                          </span>
                        </td>
                        <td class="px-4 py-2 text-right">
                          {#if row.won === null}
                            <span class="font-mono text-[10px] text-muted-foreground"
                              >scheduled</span
                            >
                          {:else}
                            <span class="font-semibold {row.won ? 'text-primary' : ''}">
                              {row.won ? 'W' : 'L'}
                            </span>
                            <span class="ml-2 font-mono text-[10px]">
                              {row.humanScore}–{row.opponentScore}
                              {#if row.forfeit}· forfeit{/if}
                            </span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            {/if}
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
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 sm:px-0">
          <h2
            id="postseason-schedule-heading"
            class="font-display text-lg font-extrabold tracking-tight uppercase"
          >
            Postseason
          </h2>
          <span class="font-mono text-xs text-muted-foreground">
            {postseasonPlayed} game{postseasonPlayed === 1 ? '' : 's'} played · Play-In and playoffs
          </span>
        </div>
        <div class="mt-2 hidden overflow-x-auto rounded-xl bg-surface-1 md:block">
          <table class="w-full min-w-[56rem] text-sm">
            <caption class="sr-only">Postseason games — Play-In and playoffs</caption>
            <thead>
              <tr
                class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
              >
                <th scope="col" class="px-4 py-2 text-left font-medium">Round</th>
                <th scope="col" class="px-4 py-2 text-left font-medium">Matchup</th>
                <th scope="col" class="px-4 py-2 text-right font-medium">Result</th>
              </tr>
            </thead>
            <tbody>
              {#each postseasonRows as row (row.summary.gameId)}
                <tr data-season-postseason-schedule-row class="border-b border-border/40">
                  <td class="px-4 py-2 font-mono text-[10px] text-muted-foreground">
                    {row.phaseLabel} · {row.roundLabel}
                  </td>
                  <td class="px-4 py-2">
                    <span class="flex items-center gap-2">
                      {#if identityOf(row.summary.awayFranchiseId)}
                        <SeasonTeamLogo
                          {manifest}
                          franchiseId={row.summary.awayFranchiseId}
                          teamExternalId={identityOf(row.summary.awayFranchiseId)!.teamExternalId}
                          alt=""
                          size="sm"
                        />
                      {/if}
                      <span class="font-mono text-[10px] text-muted-foreground">at</span>
                      {#if identityOf(row.summary.homeFranchiseId)}
                        <SeasonTeamLogo
                          {manifest}
                          franchiseId={row.summary.homeFranchiseId}
                          teamExternalId={identityOf(row.summary.homeFranchiseId)!.teamExternalId}
                          alt=""
                          size="sm"
                        />
                      {/if}
                      <span class="truncate font-semibold">
                        {shell.franchiseName(row.summary.awayFranchiseId)}
                        <span class="font-normal text-muted-foreground">at</span>
                        {shell.franchiseName(row.summary.homeFranchiseId)}
                      </span>
                    </span>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <span class="font-semibold {row.humanWon === true ? 'text-primary' : ''}">
                      {row.humanGame ? (row.humanWon === true ? 'W' : 'L') : ''}
                    </span>
                    <span class="ml-2 font-mono text-[10px]">{row.scoreLabel}</span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <ul class="mt-2 flex flex-col gap-0 md:hidden md:gap-2">
          {#each postseasonRows as row (row.summary.gameId)}
            <li
              data-season-postseason-schedule-row
              class="flex items-center gap-3 bg-surface-1 px-3 py-3 sm:rounded-xl"
            >
              <span class="w-16 shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.phaseLabel}
                {row.roundLabel}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm font-semibold">
                {shell.franchiseName(row.summary.awayFranchiseId)}
                <span class="font-normal text-muted-foreground">at</span>
                {shell.franchiseName(row.summary.homeFranchiseId)}
              </span>
              <span class="shrink-0 text-right">
                <span
                  class="block font-mono text-xs font-bold {row.humanWon === true
                    ? 'text-primary'
                    : ''}"
                >
                  {row.humanGame ? (row.humanWon === true ? 'W' : 'L') : ''}
                </span>
                <span class="block font-mono text-[10px] text-muted-foreground">
                  {row.scoreLabel}
                </span>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <p class="mt-6 px-3 font-mono text-xs text-muted-foreground sm:px-0">
      Results update as checkpoints complete; scheduled games carry no prediction.
    </p>
  </section>
{/if}
