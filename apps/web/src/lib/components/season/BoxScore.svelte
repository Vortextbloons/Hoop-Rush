<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { BoxScore, BoxScoreRow } from '#lib/season/season-presentation.js';
  import { formatClock } from '#lib/season/season-presentation.js';
  import { franchiseIdentityOf } from '#lib/season/season-branding.js';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import SeasonTeamLogo from './SeasonTeamLogo.svelte';
  let {
    box,
    opponentName,
    resultLabel,
    note = null,
    manifest = null,
    teamFranchiseId = null,
    opponentFranchiseId = null,
  }: {
    box: BoxScore;
    opponentName: string;
    resultLabel: string;
    note?: string | null;
    manifest?: HoopRushManifest | null;
    teamFranchiseId?: string | null;
    opponentFranchiseId?: string | null;
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
  const teamIdentity = $derived(
    manifest && teamFranchiseId ? franchiseIdentityOf(manifest, teamFranchiseId) : null,
  );
  const opponentIdentity = $derived(
    manifest && opponentFranchiseId ? franchiseIdentityOf(manifest, opponentFranchiseId) : null,
  );
  const hasDeep = $derived(
    (box.team.fourPointersAttempted ?? 0) > 0 ||
      box.players.some((player) => player.fourPointersAttempted > 0),
  );
  const compactColumns: readonly PlayerStatColumn<BoxScoreRow>[] = [
    {
      key: 'seconds',
      label: 'Min',
      value: (player) => formatClock(player.seconds),
      cellClass: 'font-mono text-muted-foreground',
    },
    {
      key: 'points',
      label: 'Pts',
      value: (player) => player.points,
      cellClass: 'font-bold',
      totalClass: 'sr-number font-extrabold',
    },
    {
      key: 'rebounds',
      label: 'Reb',
      value: (player) => player.offensiveRebounds + player.defensiveRebounds,
      cellClass: 'font-mono',
    },
    { key: 'assists', label: 'Ast', value: (player) => player.assists, cellClass: 'font-mono' },
  ];
  const fullColumns = $derived.by((): PlayerStatColumn<BoxScoreRow>[] => {
    const columns: PlayerStatColumn<BoxScoreRow>[] = [
      {
        key: 'position',
        label: 'Pos',
        value: (player) => player.position,
        cellClass: 'font-mono text-muted-foreground',
      },
      {
        key: 'seconds',
        label: 'Min',
        value: (player) => formatClock(player.seconds),
        cellClass: 'font-mono text-muted-foreground',
      },
      {
        key: 'points',
        label: 'Pts',
        value: (player) => player.points,
        cellClass: 'font-bold',
        totalClass: 'sr-number font-extrabold',
      },
      {
        key: 'fieldGoals',
        label: 'FG',
        value: (player) => `${player.fieldGoalsMade}/${player.fieldGoalsAttempted}`,
        cellClass: 'font-mono',
      },
      {
        key: 'threes',
        label: '3PT',
        value: (player) => `${player.threePointersMade}/${player.threePointersAttempted}`,
        cellClass: 'font-mono',
      },
    ];
    if (hasDeep) {
      columns.push({
        key: 'fourPointers',
        label: '4PT',
        value: (player) => `${player.fourPointersMade}/${player.fourPointersAttempted}`,
        cellClass: 'font-mono',
      });
    }
    columns.push(
      {
        key: 'freeThrows',
        label: 'FT',
        value: (player) => `${player.freeThrowsMade}/${player.freeThrowsAttempted}`,
        cellClass: 'font-mono',
      },
      {
        key: 'rebounds',
        label: 'Reb',
        value: (player) => player.offensiveRebounds + player.defensiveRebounds,
        cellClass: 'font-mono',
      },
      { key: 'assists', label: 'Ast', value: (player) => player.assists, cellClass: 'font-mono' },
      { key: 'steals', label: 'Stl', value: (player) => player.steals, cellClass: 'font-mono' },
      { key: 'blocks', label: 'Blk', value: (player) => player.blocks, cellClass: 'font-mono' },
      {
        key: 'turnovers',
        label: 'TO',
        value: (player) => player.turnovers,
        cellClass: 'font-mono',
      },
      { key: 'fouls', label: 'PF', value: (player) => player.fouls, cellClass: 'font-mono' },
    );
    return columns;
  });
  const compactTotals = $derived.by((): PlayerStatsTotals<BoxScoreRow> => ({
    label: 'Team',
    value: (column) => {
      if (column.key === 'points') return box.team.points;
      if (column.key === 'rebounds') return box.team.offensiveRebounds + box.team.defensiveRebounds;
      if (column.key === 'assists') return teamTotal.assists;
      return '';
    },
  }));
  const fullTotals = $derived.by((): PlayerStatsTotals<BoxScoreRow> => ({
    label: 'Team',
    value: (column) => {
      switch (column.key) {
        case 'points':
          return box.team.points;
        case 'fieldGoals':
          return `${box.team.fieldGoalsMade}/${box.team.fieldGoalsAttempted}`;
        case 'threes':
          return `${box.team.threePointersMade}/${box.team.threePointersAttempted}`;
        case 'fourPointers':
          return `${box.team.fourPointersMade ?? 0}/${box.team.fourPointersAttempted ?? 0}`;
        case 'freeThrows':
          return `${box.team.freeThrowsMade}/${box.team.freeThrowsAttempted}`;
        case 'rebounds':
          return box.team.offensiveRebounds + box.team.defensiveRebounds;
        case 'assists':
          return teamTotal.assists;
        case 'steals':
          return teamTotal.steals;
        case 'blocks':
          return teamTotal.blocks;
        case 'turnovers':
          return teamTotal.turnovers;
        case 'fouls':
          return teamTotal.fouls;
        default:
          return '';
      }
    },
  }));
  const rowKey = (player: BoxScoreRow) => player.playerVersionId;
</script>

<div class="sr-panel-quiet overflow-hidden" data-season-box-score>
  <div class="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
    <div class="flex min-w-0 items-center gap-2">
      {#if manifest && teamIdentity}
        <SeasonTeamLogo
          {manifest}
          franchiseId={teamIdentity.franchiseId}
          teamExternalId={teamIdentity.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
      <h3 class="sr-section-label">
        {resultLabel}
      </h3>
      {#if note}
        <span class="font-mono text-[10px] text-muted-foreground">{note}</span>
      {/if}
    </div>
    <p class="flex items-center gap-2 text-sm text-muted-foreground">
      <span class="sr-number text-lg text-foreground">
        {box.team.points} – {box.opponent.points}
      </span>
      <span>vs {opponentName}</span>
      {#if manifest && opponentIdentity}
        <SeasonTeamLogo
          {manifest}
          franchiseId={opponentIdentity.franchiseId}
          teamExternalId={opponentIdentity.teamExternalId}
          alt=""
          size="sm"
        />
      {/if}
    </p>
  </div>

  <div class="md:hidden">
    <PlayerStatsTable
      columns={compactColumns}
      rows={box.players}
      {rowKey}
      totals={compactTotals}
      tableClass="w-full"
      playerCellClass="max-w-36 truncate px-3 py-1.5 text-left font-semibold"
      playerHeadCellClass="text-left"
      statCellClass="px-3 py-1.5 text-right"
      headCellClass="text-right!"
      totalCellClass="px-3 py-2 text-right font-mono"
      playerTotalCellClass="sr-section-label px-3 py-2 text-left"
    >
      {#snippet identity(player)}
        {player.displayName}
      {/snippet}
    </PlayerStatsTable>

    <details class="group border-t border-border">
      <summary
        class="sr-section-label cursor-pointer px-4 py-2.5 outline-none [&::-webkit-details-marker]:hidden"
      >
        Full stats
      </summary>
      <div class="overflow-x-auto border-t border-border/60">
        <PlayerStatsTable
          columns={fullColumns}
          rows={box.players}
          {rowKey}
          totals={fullTotals}
          tableClass="min-w-[42rem]"
          playerCellClass="max-w-44 truncate px-3 py-1.5 text-left font-semibold"
          playerHeadCellClass="text-left"
          statCellClass="px-3 py-1.5 text-right"
          headCellClass="text-right!"
          totalCellClass="px-3 py-2 text-right font-mono"
          playerTotalCellClass="sr-section-label px-3 py-2 text-left"
        >
          {#snippet identity(player)}
            {player.displayName}
          {/snippet}
        </PlayerStatsTable>
      </div>
    </details>
  </div>

  <div class="hidden overflow-x-auto md:block">
    <PlayerStatsTable
      columns={fullColumns}
      rows={box.players}
      {rowKey}
      totals={fullTotals}
      tableClass="min-w-[42rem]"
      playerCellClass="max-w-44 truncate px-3 py-1.5 text-left font-semibold"
      playerHeadCellClass="text-left"
      statCellClass="px-3 py-1.5 text-right"
      headCellClass="text-right!"
      totalCellClass="px-3 py-2 text-right font-mono"
      playerTotalCellClass="sr-section-label px-3 py-2 text-left"
    >
      {#snippet identity(player)}
        {player.displayName}
      {/snippet}
    </PlayerStatsTable>
  </div>
</div>
