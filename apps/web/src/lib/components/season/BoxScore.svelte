<script lang="ts">
  import type { BoxScore } from '$lib/season/season-presentation';
  import { formatClock } from '$lib/season/season-presentation';

  /**
   * Box score view for one completed human-team game (M2.3): team totals and
   * the ten compact player lines from the summary, joined with roster names
   * and positions. Exact integers only — no derived efficiencies beyond what
   * the compact contract carries.
   */

  let {
    box,
    opponentName,
    resultLabel,
  }: {
    box: BoxScore;
    opponentName: string;
    resultLabel: string;
  } = $props();

  const teamTotal = $derived(
    box.players.reduce(
      (acc, p) => {
        acc.rebounds += p.offensiveRebounds + p.defensiveRebounds;
        acc.assists += p.assists;
        acc.turnovers += p.turnovers;
        acc.steals += p.steals;
        acc.blocks += p.blocks;
        acc.fouls += p.fouls;
        return acc;
      },
      { rebounds: 0, assists: 0, turnovers: 0, steals: 0, blocks: 0, fouls: 0 },
    ),
  );
</script>

<div class="rounded-xl bg-surface-1">
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3"
  >
    <h3 class="font-display text-base font-extrabold uppercase tracking-tight">
      {resultLabel}
    </h3>
    <p class="text-sm text-muted-foreground">
      {box.team.points} – {box.opponent.points} vs {opponentName}
    </p>
  </div>

  <div class="overflow-x-auto">
    <table class="w-full min-w-[42rem] text-sm">
      <thead>
        <tr
          class="border-b border-border/70 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
        >
          <th scope="col" class="px-3 py-2 text-left font-medium">Player</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Pos</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Min</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Pts</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">FG</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">3PT</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">FT</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Reb</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Ast</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Stl</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">Blk</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">TO</th>
          <th scope="col" class="px-3 py-2 text-right font-medium">PF</th>
        </tr>
      </thead>
      <tbody>
        {#each box.players as player (player.playerVersionId)}
          <tr class="border-b border-border/40">
            <th scope="row" class="max-w-44 truncate px-3 py-1.5 text-left font-semibold">
              {player.displayName}
            </th>
            <td class="px-3 py-1.5 text-right font-mono text-[10px] text-muted-foreground">
              {player.position}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {formatClock(player.seconds)}
            </td>
            <td class="px-3 py-1.5 text-right font-bold">{player.points}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.fieldGoalsMade}/{player.fieldGoalsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.threePointersMade}/{player.threePointersAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.freeThrowsMade}/{player.freeThrowsAttempted}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">
              {player.offensiveRebounds + player.defensiveRebounds}
            </td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.assists}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.steals}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.blocks}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.turnovers}</td>
            <td class="px-3 py-1.5 text-right font-mono text-[10px]">{player.fouls}</td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr class="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          <th scope="row" class="px-3 py-2 text-left font-medium">Team</th>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2"></td>
          <td class="px-3 py-2 text-right font-bold text-foreground">{box.team.points}</td>
          <td class="px-3 py-2 text-right">
            {box.team.fieldGoalsMade}/{box.team.fieldGoalsAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.threePointersMade}/{box.team.threePointersAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.freeThrowsMade}/{box.team.freeThrowsAttempted}
          </td>
          <td class="px-3 py-2 text-right">
            {box.team.offensiveRebounds + box.team.defensiveRebounds}
          </td>
          <td class="px-3 py-2 text-right">{teamTotal.assists}</td>
          <td class="px-3 py-2 text-right">{teamTotal.steals}</td>
          <td class="px-3 py-2 text-right">{teamTotal.blocks}</td>
          <td class="px-3 py-2 text-right">{teamTotal.turnovers}</td>
          <td class="px-3 py-2 text-right">{teamTotal.fouls}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>
