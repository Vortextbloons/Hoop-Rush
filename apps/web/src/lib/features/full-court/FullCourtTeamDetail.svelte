<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_NAMES,
    type FullCourtSeasonScore,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import {
    buildFullCourtPlayerSeasonStats,
    type FullCourtPlayerSeasonRow,
    type FullCourtSeasonLock,
    type FullCourtStandingsRow,
  } from '@hoop-rush/engine';
  import { franchiseIdentityOf } from '#lib/branding.js';
  import PlayerStatsSection from '#lib/components/basketball/PlayerStatsSection.svelte';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import { seasonStatColumns } from '#lib/components/season-stat-columns.js';
  import TeamLogo from '#lib/components/TeamLogo.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { perGameText, trueShootingPct, usagePct, usagePossessions } from '#lib/format.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtPortrait from './FullCourtPortrait.svelte';

  type LeagueTeam = FullCourtSeasonLock['season']['teams'][number];

  let {
    team,
    standing,
    scores,
    isUserTeam = false,
    manifest = null,
    art = null,
  }: {
    team: LeagueTeam;
    standing: FullCourtStandingsRow | null;
    scores: readonly FullCourtSeasonScore[];
    isUserTeam?: boolean;
    manifest?: HoopRushManifest | null;
    art?: FullCourtArt | null;
  } = $props();

  let statValues = $state<'game' | 'totals'>('game');

  const identity = $derived(manifest === null ? null : franchiseIdentityOf(manifest, team.teamId));
  const gamesPlayed = $derived(standing === null ? 0 : standing.wins + standing.losses);
  const playerRows = $derived(
    buildFullCourtPlayerSeasonStats({
      teams: [team],
      scores,
    }),
  );
  const teamUsage = $derived(
    playerRows.reduce((sum, row) => sum + usagePossessions(row.fga, row.fta, row.turnovers), 0),
  );

  function pctText(value: number | null): string {
    return value === null ? '—' : `${value.toFixed(1)}%`;
  }

  function signed(value: number): string {
    return value > 0 ? `+${String(value)}` : String(value);
  }

  const statColumns = $derived.by((): PlayerStatColumn<FullCourtPlayerSeasonRow>[] => {
    const totals = statValues === 'totals';
    const stat = (total: number, pg: number, games: number): string => {
      if (totals) return String(Math.round(total));
      return games === 0 ? '0.0' : pg.toFixed(1);
    };
    const rawStat = (total: number, games: number): string =>
      totals ? String(Math.round(total)) : games === 0 ? '0.0' : perGameText(total, games);

    const columns = seasonStatColumns<FullCourtPlayerSeasonRow>(
      {
        games: (row) => row.games,
        points: (row) => stat(row.points, row.ppg, row.games),
        rebounds: (row) => stat(row.rebounds, row.rpg, row.games),
        assists: (row) => stat(row.assists, row.apg, row.games),
        steals: (row) => stat(row.steals, row.spg, row.games),
        blocks: (row) => stat(row.blocks, row.bpg, row.games),
        turnovers: (row) => stat(row.turnovers, row.topg, row.games),
        fgPct: (row) => pctText(row.fgPct),
        threePct: (row) => pctText(row.tpPct),
        ftPct: (row) => pctText(row.ftPct),
        tsPct: (row) => pctText(row.tsPct),
        usagePct: (row) => usagePct(usagePossessions(row.fga, row.fta, row.turnovers), teamUsage),
        fgAttempts: (row) => rawStat(row.fga, row.games),
        threeAttempts: (row) => rawStat(row.tpa, row.games),
        ftAttempts: (row) => rawStat(row.fta, row.games),
        threeMade: (row) => stat(row.tpm, row.tpmPg, row.games),
      },
      { includeGames: true, includeDetailed: true },
    ).map((column) =>
      column.key === 'points' ? { ...column, cellClass: 'ui-stats-value-strong' } : column,
    );
    return [
      ...columns.slice(0, 1),
      {
        key: 'mpg',
        label: totals ? 'MIN' : 'MPG',
        value: (row) => (totals ? String(Math.round(row.minutes)) : row.mpg.toFixed(1)),
      },
      ...columns.slice(1),
    ];
  });

  const teamTotalsRow = $derived.by((): PlayerStatsTotals<FullCourtPlayerSeasonRow> | null => {
    if (playerRows.length === 0) return null;
    const totals = statValues === 'totals';
    const teamGames = playerRows.reduce((max, row) => Math.max(max, row.games), 0);
    const sum = (pick: (row: FullCourtPlayerSeasonRow) => number): number =>
      playerRows.reduce((acc, row) => acc + pick(row), 0);
    const pts = sum((r) => r.points);
    const reb = sum((r) => r.rebounds);
    const ast = sum((r) => r.assists);
    const stl = sum((r) => r.steals);
    const blk = sum((r) => r.blocks);
    const tov = sum((r) => r.turnovers);
    const min = sum((r) => r.minutes);
    const fgm = sum((r) => r.fgm);
    const fga = sum((r) => r.fga);
    const tpm = sum((r) => r.tpm);
    const tpa = sum((r) => r.tpa);
    const ftm = sum((r) => r.ftm);
    const fta = sum((r) => r.fta);
    const fmt = (total: number): string =>
      totals ? String(Math.round(total)) : teamGames === 0 ? '0.0' : perGameText(total, teamGames);
    const ratio = (made: number, att: number): string =>
      att === 0 ? '—' : `${((100 * made) / att).toFixed(1)}%`;

    return {
      label: 'Team',
      value: (column) => {
        switch (column.key) {
          case 'games':
            return teamGames;
          case 'mpg':
            return fmt(min);
          case 'points':
            return fmt(pts);
          case 'rebounds':
            return fmt(reb);
          case 'assists':
            return fmt(ast);
          case 'steals':
            return fmt(stl);
          case 'blocks':
            return fmt(blk);
          case 'turnovers':
            return fmt(tov);
          case 'fgPct':
            return ratio(fgm, fga);
          case 'threePct':
            return ratio(tpm, tpa);
          case 'ftPct':
            return ratio(ftm, fta);
          case 'tsPct':
            return trueShootingPct(pts, fga, fta);
          case 'usagePct':
            return teamUsage > 0 ? '100.0%' : '—';
          case 'fgAttempts':
            return fmt(fga);
          case 'threeAttempts':
            return fmt(tpa);
          case 'ftAttempts':
            return fmt(fta);
          case 'threeMade':
            return fmt(tpm);
          default:
            return '—';
        }
      },
    };
  });
</script>

<div class="space-y-4">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div class="flex min-w-0 items-center gap-3">
      {#if manifest !== null && identity !== null}
        <TeamLogo
          {manifest}
          franchiseId={identity.franchiseId}
          teamExternalId={identity.teamExternalId}
          alt=""
          className="h-10 w-10 shrink-0"
        />
      {/if}
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-display truncate text-xl font-extrabold tracking-tight uppercase">
            {team.displayName}
          </h3>
          {#if isUserTeam}
            <Badge tone="primary">Your team</Badge>
          {/if}
        </div>
        {#if standing !== null}
          <p class="mt-0.5 text-xs text-muted-foreground">
            {CAP_RUSH_CONFERENCE_NAMES[standing.conference]} · Seed #{standing.seed}
            {#if standing.qualified}
              · Playoff spot
            {/if}
          </p>
        {/if}
      </div>
    </div>
    {#if standing !== null}
      <Badge tone={standing.qualified ? 'primary' : 'neutral'}>
        {standing.wins}–{standing.losses}
      </Badge>
    {/if}
  </div>

  {#if standing !== null}
    <StatGrid minWidth="7.5rem">
      <StatTile
        label="Record"
        size="md"
        surface="tile"
        value={`${standing.wins}–${standing.losses}`}
      />
      <StatTile
        label="Conf"
        size="md"
        surface="tile"
        value={`${standing.conferenceWins}–${standing.conferenceLosses}`}
      />
      <StatTile
        label="PPG"
        size="md"
        surface="tile"
        value={gamesPlayed === 0 ? '—' : perGameText(standing.pointsFor, gamesPlayed)}
      />
      <StatTile
        label="OPP PPG"
        size="md"
        surface="tile"
        value={gamesPlayed === 0 ? '—' : perGameText(standing.pointsAgainst, gamesPlayed)}
      />
      <StatTile
        label="Diff"
        size="md"
        surface="tile"
        tone={standing.pointDifferential > 0
          ? 'primary'
          : standing.pointDifferential < 0
            ? 'negative'
            : 'muted'}
        value={signed(standing.pointDifferential)}
      />
    </StatGrid>
  {/if}

  <PlayerStatsSection
    surface="none"
    ariaLabel={`${team.displayName} roster and season stats`}
    title="Roster & season stats"
    description={`${playerRows.length} players on the roster.`}
    values={statValues}
    onvalueschange={(value) => (statValues = value)}
    rows={playerRows.length > 0 ? playerRows : null}
    columns={statColumns}
    totalsRow={teamTotalsRow}
    tableClass="min-w-[1080px] text-sm"
    statCellClass="font-mono"
    rowKey={(row) => row.playerId}
    caption={`${team.displayName} player season stats`}
    stickyIdentity
  >
    {#snippet identity(row)}
      <span class="ui-stats-player">
        <FullCourtPortrait player={row} {art} size="sm" />
        <span class="ui-stats-player-text">
          <span class="ui-stats-player-name">{row.displayName}</span>
          <span class="ui-stats-player-meta">{row.positions.slice(0, 2).join('/')}</span>
        </span>
      </span>
    {/snippet}
  </PlayerStatsSection>
</div>
