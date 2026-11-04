<script lang="ts">
  import type {
    CapRushBoxScore,
    CapRushBoxParticipant,
    CapRushTeamBox,
  } from '@hoop-rush/data-contracts';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { formatShootingPercentage } from './cap-rush-presentation.ts';

  let {
    box,
    label,
    userTeamId = null,
  }: {
    box: CapRushBoxScore;
    label: string;
    userTeamId?: string | null;
  } = $props();

  const periods = $derived(Math.max(box.home.periods.length, box.away.periods.length));
  const periodNumbers = $derived(Array.from({ length: periods }, (_, index) => index + 1));

  const boxColumns: readonly PlayerStatColumn<CapRushBoxParticipant>[] = [
    { key: 'slot', label: 'Pos', align: 'center', value: (line) => line.slot },
    { key: 'minutes', label: 'Min', value: (line) => line.minutes },
    { key: 'points', label: 'PTS', value: (line) => line.points, cellClass: 'font-bold' },
    { key: 'rebounds', label: 'REB', value: (line) => line.rebounds },
    { key: 'assists', label: 'AST', value: (line) => line.assists },
    { key: 'steals', label: 'STL', value: (line) => line.steals },
    { key: 'blocks', label: 'BLK', value: (line) => line.blocks },
    { key: 'turnovers', label: 'TO', value: (line) => line.turnovers },
    { key: 'fouls', label: 'PF', value: (line) => line.fouls },
    {
      key: 'fieldGoals',
      label: 'FG',
      value: (line) => `${line.fieldGoalsMade}-${line.fieldGoalsAttempted}`,
    },
    {
      key: 'threes',
      label: '3P',
      value: (line) => `${line.threesMade}-${line.threesAttempted}`,
    },
    {
      key: 'freeThrows',
      label: 'FT',
      value: (line) => `${line.freeThrowsMade}-${line.freeThrowsAttempted}`,
    },
    {
      key: 'adjustments',
      label: 'Adj',
      value: (line) =>
        line.adjustments !== 0 ? `${line.adjustments > 0 ? '+' : ''}${line.adjustments}` : '—',
    },
  ];

  function teamClass(team: CapRushTeamBox): string {
    return team.teamId === userTeamId ? 'text-primary' : 'text-foreground';
  }
</script>

<section class="overflow-hidden rounded-2xl border border-border bg-card" aria-label={label}>
  <div class="border-b border-line-soft px-4 py-3 sm:px-5">
    <p class="font-mono text-[9px] font-bold tracking-[0.16em] text-muted-foreground uppercase">
      {label}
    </p>
    <div class="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <span class="truncate text-sm font-bold {teamClass(box.away)}" title={box.away.displayName}
        >{box.away.displayName}</span
      >
      <span class="font-display text-2xl font-extrabold tabular-nums">
        {box.away.points}–{box.home.points}
      </span>
      <span
        class="truncate text-right text-sm font-bold {teamClass(box.home)}"
        title={box.home.displayName}>{box.home.displayName}</span
      >
    </div>
    {#if box.overtimePeriods > 0}
      <p class="mt-1 text-center font-mono text-[9px] text-muted-foreground uppercase">
        {box.overtimePeriods > 1 ? `${box.overtimePeriods} overtimes` : 'Overtime'}
      </p>
    {/if}
  </div>

  <div class="overflow-x-auto" aria-label={`${label} period scoring`}>
    <table class="w-full min-w-[26rem] border-collapse text-left">
      <thead>
        <tr class="font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase">
          <th scope="col" class="sticky left-0 z-10 bg-card px-3 py-2 font-bold">Team</th>
          {#each periodNumbers as period (period)}
            <th scope="col" class="px-2 py-2 text-right font-bold"
              >{period <= 4 ? period : `OT${period - 4}`}</th
            >
          {/each}
          <th scope="col" class="px-3 py-2 text-right font-bold">T</th>
        </tr>
      </thead>
      <tbody>
        {#each [box.away, box.home] as team (team.teamId)}
          <tr class="border-t border-line-soft/60">
            <th
              scope="row"
              class="sticky left-0 z-10 max-w-40 truncate bg-card px-3 py-1.5 text-[11px] font-bold {teamClass(
                team,
              )}"
              title={team.displayName}
            >
              {team.displayName}
            </th>
            {#each periodNumbers as period (period)}
              <td class="px-2 py-1.5 text-right font-mono text-[10px] tabular-nums">
                {team.periods[period - 1] ?? '—'}
              </td>
            {/each}
            <td class="px-3 py-1.5 text-right font-mono text-[11px] font-bold tabular-nums">
              {team.points}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#each [box.away, box.home] as team (team.teamId)}
    <div class="border-t border-line-soft">
      <div class="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2 sm:px-5">
        <h3 class="text-sm font-bold {teamClass(team)}">{team.displayName}</h3>
        <p class="font-mono text-[9px] text-muted-foreground uppercase">
          {#if team.adjustments !== 0}
            adjustments {team.adjustments > 0 ? '+' : ''}{team.adjustments} ·
          {/if}
          {#if team.teamBonusPoints !== 0}
            team bonus {team.teamBonusPoints > 0 ? '+' : ''}{team.teamBonusPoints}
          {/if}
        </p>
      </div>
      <div class="ui-stats-scroll" aria-label={`${team.displayName} player box score`}>
        <PlayerStatsTable
          columns={boxColumns}
          rows={team.participants}
          rowKey={(line) => line.playerId + line.slot + line.kind}
          caption={`${team.displayName} player box score`}
          tableClass="min-w-[44rem] text-[10px]"
          statCellClass="font-mono"
          playerCellClass="ui-stats-player-cell"
          playerHeadCellClass="ui-stats-player-cell"
          stickyIdentity
          rowAttributes={(line) => ({ 'data-kind': line.kind })}
        >
          {#snippet identity(line)}
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="truncate" title={line.displayName}>{line.displayName}</span>
              {#if line.kind !== 'starter'}
                <span class="font-mono text-[8px] text-muted-foreground uppercase"
                  >{line.kind === 'clone' ? 'C' : 'R'}</span
                >
              {/if}
            </span>
          {/snippet}
          {#snippet cell(line, column)}
            {#if column.key === 'fieldGoals'}
              {line.fieldGoalsMade}-{line.fieldGoalsAttempted}
              <span class="hidden text-[8px] text-muted-foreground sm:inline"
                >({formatShootingPercentage(line.fieldGoalsMade, line.fieldGoalsAttempted)})</span
              >
            {:else if column.key === 'adjustments'}
              <span class={line.adjustments !== 0 ? 'text-accent' : 'text-muted-foreground'}
                >{column.value(line)}</span
              >
            {:else}
              {column.value(line)}
            {/if}
          {/snippet}
        </PlayerStatsTable>
      </div>
      <p class="px-4 py-2 font-mono text-[9px] text-muted-foreground uppercase sm:px-5">
        {team.participants.filter((line: CapRushBoxParticipant) => line.kind === 'starter').length}
        starters · {team.participants.length} recorded participants
      </p>
    </div>
  {/each}
</section>
