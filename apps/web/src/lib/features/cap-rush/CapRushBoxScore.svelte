<script lang="ts">
  import type {
    CapRushBoxScore,
    CapRushBoxParticipant,
    CapRushTeamBox,
  } from '@hoop-rush/data-contracts';
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
      <div class="overflow-x-auto" aria-label={`${team.displayName} player box score`}>
        <table class="w-full min-w-[44rem] border-collapse text-left">
          <thead>
            <tr class="font-mono text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
              <th scope="col" class="sticky left-0 z-10 bg-card px-3 py-1.5 font-bold">Player</th>
              <th scope="col" class="px-1.5 py-1.5 text-center font-bold">Pos</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">Min</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">PTS</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">REB</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">AST</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">STL</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">BLK</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">TO</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">PF</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">FG</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">3P</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">FT</th>
              <th scope="col" class="px-1.5 py-1.5 text-right font-bold">Adj</th>
            </tr>
          </thead>
          <tbody>
            {#each team.participants as line (line.playerId + line.slot + line.kind)}
              <tr class="border-t border-line-soft/50">
                <th
                  scope="row"
                  class="sticky left-0 z-10 max-w-48 truncate bg-card px-3 py-1.5 text-left text-[11px] font-semibold"
                  title={line.displayName}
                >
                  {line.displayName}
                  {#if line.kind !== 'starter'}
                    <span class="ml-1 font-mono text-[8px] text-muted-foreground uppercase"
                      >{line.kind === 'clone' ? 'C' : 'R'}</span
                    >
                  {/if}
                </th>
                <td class="px-1.5 py-1.5 text-center font-mono text-[9px] text-muted-foreground">
                  {line.slot}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.minutes}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] font-bold tabular-nums">
                  {line.points}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.rebounds}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.assists}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.steals}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.blocks}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.turnovers}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.fouls}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.fieldGoalsMade}-{line.fieldGoalsAttempted}
                  <span class="hidden text-[8px] text-muted-foreground sm:inline"
                    >({formatShootingPercentage(
                      line.fieldGoalsMade,
                      line.fieldGoalsAttempted,
                    )})</span
                  >
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.threesMade}-{line.threesAttempted}
                </td>
                <td class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums">
                  {line.freeThrowsMade}-{line.freeThrowsAttempted}
                </td>
                <td
                  class="px-1.5 py-1.5 text-right font-mono text-[10px] tabular-nums {line.adjustments !==
                  0
                    ? 'text-accent'
                    : 'text-muted-foreground'}"
                >
                  {line.adjustments !== 0
                    ? `${line.adjustments > 0 ? '+' : ''}${line.adjustments}`
                    : '—'}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="px-4 py-2 font-mono text-[9px] text-muted-foreground uppercase sm:px-5">
        {team.participants.filter((line: CapRushBoxParticipant) => line.kind === 'starter').length}
        starters · {team.participants.length} recorded participants
      </p>
    </div>
  {/each}
</section>
