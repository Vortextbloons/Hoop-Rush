<script lang="ts">
  import {
    CAP_RUSH_CONFERENCE_NAMES,
    CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import type {
    FullCourtAwardsBoard,
    FullCourtPlayerSeasonRow,
    FullCourtStandings,
  } from '@hoop-rush/engine';
  import { onMount } from 'svelte';
  import ConferenceStandingsTable from '#lib/components/basketball/ConferenceStandingsTable.svelte';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import type { PlayerStatColumn } from '#lib/components/player-stats-table.js';
  import { seasonStatColumns } from '#lib/components/season-stat-columns.js';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import { getManifest } from '#lib/data.js';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtAwardsPanel from './FullCourtAwardsPanel.svelte';
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import { trueShootingPct, usagePossessions } from '#lib/format.js';

  let {
    awards,
    rosterStats,
    userTeamId,
    standings,
    art = null,
  }: {
    awards: FullCourtAwardsBoard;
    rosterStats: readonly FullCourtPlayerSeasonRow[];
    userTeamId: string;
    standings: FullCourtStandings;
    art?: FullCourtArt | null;
  } = $props();

  let manifest = $state.raw<HoopRushManifest | null>(null);
  onMount(() => {
    let mounted = true;
    void getManifest()
      .then((loaded) => {
        if (mounted) manifest = loaded;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  });

  const teamUsage = $derived(
    rosterStats.reduce((sum, row) => sum + usagePossessions(row.fga, row.fta, row.turnovers), 0),
  );

  const statColumns = $derived(
    seasonStatColumns<FullCourtPlayerSeasonRow>({
      games: (row) => row.games,
      points: (row) => row.ppg.toFixed(1),
      rebounds: (row) => row.rpg.toFixed(1),
      assists: (row) => row.apg.toFixed(1),
      steals: (row) => row.spg.toFixed(1),
      blocks: (row) => row.bpg.toFixed(1),
      turnovers: (row) => row.topg.toFixed(1),
      fgPct: (row) => (row.fgPct === null ? '—' : row.fgPct.toFixed(1)),
      threePct: (row) => (row.tpPct === null ? '—' : row.tpPct.toFixed(1)),
      tsPct: (row) => trueShootingPct(row.points, row.fga, row.fta),
      usagePct: (row) =>
        teamUsage === 0
          ? '—'
          : `${((usagePossessions(row.fga, row.fta, row.turnovers) / teamUsage) * 100).toFixed(1)}`,
    }),
  );

  const teamRows = $derived([...rosterStats].sort((left, right) => right.mpg - left.mpg));
</script>

<FullCourtAwardsPanel {awards} rosterStats={teamRows} {userTeamId} {art} />

<Panel as="section" padding="md" aria-label="Team statistics">
  <SectionHeading
    eyebrow="The box score"
    title="Season averages"
    level={2}
    size="sm"
    description="Regular-season per-game averages for your roster, taken from the saved game results."
  />
  {#if teamRows.length === 0}
    <p class="mt-3 text-xs text-muted-foreground">No player statistics were saved for this run.</p>
  {:else}
    <div class="ui-stats-scroll mt-3">
      <PlayerStatsTable
        columns={statColumns}
        rows={teamRows}
        rowKey={(row) => row.playerId}
        caption="Your roster's regular-season averages"
        tableClass="min-w-[720px] text-xs"
        headClass="border-b border-line-soft font-mono text-[9px] tracking-[0.08em] text-muted-foreground uppercase"
        rowClass={() => 'border-b border-line-soft/50'}
        playerCellClass="px-2 py-1.5 text-left font-semibold"
        playerHeadCellClass="px-2 py-1 text-left font-medium"
        headCellClass="px-2 py-1 text-right font-medium"
        statCellClass="px-2 py-1.5 text-right font-mono tabular-nums"
      >
        {#snippet identity(row)}
          <div class="flex min-w-40 items-center gap-2">
            <FullCourtPortrait player={row} {art} size="xs" />
            <span class="min-w-0">
              <span class="block truncate">{row.displayName}</span>
              <span class="font-mono text-[9px] text-muted-foreground">
                {row.positions.join('/')} · {row.starts} starts
              </span>
            </span>
          </div>
        {/snippet}
      </PlayerStatsTable>
    </div>
  {/if}
</Panel>

<Panel as="section" padding="md" aria-label="Final standings">
  <SectionHeading
    eyebrow="League"
    title="Final standings"
    level={2}
    size="sm"
    description={`Top ${String(CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS)} in each conference reached the bracket.`}
  >
    {#snippet actions()}
      <Badge>30 franchises</Badge>
    {/snippet}
  </SectionHeading>
  <div class="mt-3 grid gap-4 lg:grid-cols-2">
    <ConferenceStandingsTable
      conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.west}
      caption="West final standings"
      rows={standings.west}
      {userTeamId}
      {manifest}
    />
    <ConferenceStandingsTable
      conferenceLabel={CAP_RUSH_CONFERENCE_NAMES.east}
      caption="East final standings"
      rows={standings.east}
      {userTeamId}
      {manifest}
    />
  </div>
</Panel>
