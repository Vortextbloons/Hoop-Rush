<script lang="ts">
  import { getContext } from 'svelte';
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import type { HoopRushManifest, SeasonGameSummary } from '@hoop-rush/data-contracts';
  import BoxScore from '$lib/components/season/BoxScore.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import {
    SEASON_RUN_SHELL_CONTEXT,
    type SeasonRunShellData,
  } from '$lib/season/season-shell-context';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import { boxScoreFromSummary } from '$lib/season/season-presentation';
  import {
    playedScheduleCount,
    scheduleBlockGroups,
    scheduleBlockRows,
    type ScheduleBlockRow,
  } from '$lib/season/season-schedule-view';

  /**
   * Schedule tab (spec/2.0/11, M2.3.5): the human team's 82 games grouped
   * into the nine blocks, with All/Played/Upcoming filters. Mobile renders
   * opponent cards (logo, round, home/away, score, W/L state) and completed
   * games expand into branded compact box scores; desktop renders a denser
   * table in a scroll wrapper. Each completed block heading links to its
   * checkpoint recap. Every fact derives from the run's schedule and the
   * accepted summaries.
   */

  const shell = getContext<SeasonRunShellData>(SEASON_RUN_SHELL_CONTEXT);

  type ScheduleFilter = 'all' | 'played' | 'upcoming';
  const FILTERS: ReadonlyArray<{ value: ScheduleFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'played', label: 'Played' },
    { value: 'upcoming', label: 'Upcoming' },
  ];
  let filter = $state<ScheduleFilter>('all');

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
    new Map((shell.snapshot?.summaries ?? []).map((summary) => [summary.gameId, summary])),
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

  function resultLabel(row: ScheduleBlockRow): string {
    if (row.won === null) return 'scheduled';
    if (row.forfeit) return row.won ? 'W · forfeit' : 'L · forfeit';
    return row.won ? 'W' : 'L';
  }

  const checkpointHref = resolve('/season/run/checkpoint' as RouteId);
</script>

<svelte:head>
  <title>Season Run — schedule — Hoop Rush</title>
</svelte:head>

{#if !shell.ready || !shell.snapshot || !shell.run || !humanFranchiseId || !manifest}
  <p class="py-10 font-mono text-sm text-muted-foreground">Preparing the schedule…</p>
{:else}
  <section aria-labelledby="schedule-heading" class="pt-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">
          Season Run · schedule
        </p>
        <h1
          id="schedule-heading"
          class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase"
        >
          Schedule
        </h1>
        <p class="mt-1 font-mono text-[10px] text-muted-foreground">
          {playedCount} of 82 played · nine checkpoints
        </p>
      </div>
      <div role="group" aria-label="Schedule filter" class="flex rounded-lg bg-surface-2 p-1">
        {#each FILTERS as item (item.value)}
          <button
            type="button"
            aria-pressed={filter === item.value}
            onclick={() => {
              filter = item.value;
            }}
            class="rounded-md px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring {filter ===
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
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2
                id={`schedule-block-${group.blockIndex}-heading`}
                class="font-display text-lg font-extrabold tracking-tight uppercase"
              >
                Block {group.blockIndex + 1} of 9
              </h2>
              <span class="font-mono text-[10px] text-muted-foreground">
                rounds {group.fromRound}–{group.toRound}
              </span>
              {#if acceptedBlockIndexes.has(group.blockIndex)}
                <a
                  href={`${checkpointHref}?block=${String(group.blockIndex)}`}
                  class="font-mono text-[10px] text-primary underline-offset-4 hover:underline"
                >
                  Checkpoint recap
                </a>
              {/if}
            </div>

            <!-- Mobile: one card per game; completed games expand to a box score -->
            <ul class="mt-2 flex flex-col gap-2 md:hidden">
              {#each group.rows as row (row.gameId)}
                {@const box = boxFor(row)}
                <li data-season-schedule-row class="rounded-xl bg-surface-1">
                  <div class="flex items-center gap-3 px-4 py-3">
                    <span class="w-9 shrink-0 font-mono text-[10px] text-muted-foreground">
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
                    {/if}
                    <span class="min-w-0 flex-1">
                      <span
                        class="mr-1.5 inline-flex rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        {row.humanIsHome ? 'vs' : 'at'}
                      </span>
                      <span class="truncate font-semibold">
                        {shell.franchiseName(row.opponentFranchiseId)}
                      </span>
                    </span>
                    <span class="shrink-0 text-right">
                      {#if row.won === null}
                        <span class="font-mono text-[10px] text-muted-foreground">scheduled</span>
                      {:else}
                        <span
                          class="block font-mono text-sm font-bold {row.won
                            ? 'text-primary'
                            : 'text-muted-foreground'}"
                        >
                          {row.won ? 'W' : 'L'}
                        </span>
                        <span class="block font-mono text-[10px]">
                          {row.humanScore}–{row.opponentScore}
                          {#if row.forfeit}· forfeit{/if}
                        </span>
                      {/if}
                    </span>
                  </div>
                  {#if box}
                    <details class="group border-t border-border/50">
                      <summary
                        class="cursor-pointer px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
                      >
                        Box score
                      </summary>
                      <div class="border-t border-border/40 p-3">
                        <BoxScore
                          {box}
                          opponentName={shell.franchiseName(row.opponentFranchiseId)}
                          resultLabel={resultLabel(row)}
                          {manifest}
                          teamFranchiseId={humanFranchiseId}
                          opponentFranchiseId={row.opponentFranchiseId}
                        />
                      </div>
                    </details>
                  {/if}
                </li>
              {/each}
            </ul>

            <!-- Desktop: denser table in a scroll wrapper -->
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
                          <span class="font-mono text-[10px] text-muted-foreground">scheduled</span>
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
          </section>
        {/each}
      </div>
    {/if}

    <p class="mt-6 font-mono text-[10px] text-muted-foreground">
      Results come from accepted checkpoints; scheduled games carry no prediction.
    </p>
  </section>
{/if}
