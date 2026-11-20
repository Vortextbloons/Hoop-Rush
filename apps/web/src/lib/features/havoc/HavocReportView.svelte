<script lang="ts">
  import type { HavocReport } from '@hoop-rush/data-contracts';
  import type { HavocComparison, HavocStatLine } from '@hoop-rush/data-contracts';
  import HavocComparisonView from './HavocComparisonView.svelte';
  import HavocMvpCard from './HavocMvpCard.svelte';
  import HavocTierBadge from './HavocTierBadge.svelte';
  import { trueShootingPct, trueShootingRate, usagePct, usagePossessions } from '#lib/format.js';
  import type { PlayerStatColumn, PlayerStatsTotals } from '#lib/components/player-stats-table.js';
  import PlayerStatsTable from '#lib/components/PlayerStatsTable.svelte';
  import {
    havocParticipantKindLabel,
    havocRecordLabel,
    mutationNameOf,
  } from './havoc-presentation';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';

  let { report }: { report: HavocReport } = $props();
  const comparison = $derived(report.comparison);

  function signed(value: number): string {
    return value >= 0 ? `+${String(value)}` : String(value);
  }
  const havocTeamUsage = $derived(
    (comparison?.slots ?? []).reduce(
      (total, slot) =>
        total +
        usagePossessions(
          slot.havoc.combined.fieldGoals.attempted,
          slot.havoc.combined.freeThrows.attempted,
          slot.havoc.combined.turnovers,
        ),
      0,
    ),
  );
  const normalTeamUsage = $derived(
    (comparison?.slots ?? []).reduce(
      (total, slot) =>
        total +
        usagePossessions(
          slot.normal.combined.fieldGoals.attempted,
          slot.normal.combined.freeThrows.attempted,
          slot.normal.combined.turnovers,
        ),
      0,
    ),
  );
  function trueShooting(line: HavocStatLine): string {
    return trueShootingPct(line.points, line.fieldGoals.attempted, line.freeThrows.attempted);
  }
  function usageShare(line: HavocStatLine, teamUsage: number): string {
    return usagePct(
      usagePossessions(line.fieldGoals.attempted, line.freeThrows.attempted, line.turnovers),
      teamUsage,
    );
  }
  function trueShootingDelta(havoc: HavocStatLine, normal: HavocStatLine): string {
    const havocRate = trueShootingRate(
      havoc.points,
      havoc.fieldGoals.attempted,
      havoc.freeThrows.attempted,
    );
    const normalRate = trueShootingRate(
      normal.points,
      normal.fieldGoals.attempted,
      normal.freeThrows.attempted,
    );
    if (havocRate === null || normalRate === null) return '—';
    const delta = (havocRate - normalRate) * 100;
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`;
  }
  function usageOf(line: HavocStatLine): number {
    return usagePossessions(line.fieldGoals.attempted, line.freeThrows.attempted, line.turnovers);
  }
  function usageDelta(havoc: HavocStatLine, normal: HavocStatLine): string {
    if (havocTeamUsage <= 0 || normalTeamUsage <= 0) return '—';
    const delta = (usageOf(havoc) / havocTeamUsage - usageOf(normal) / normalTeamUsage) * 100;
    return `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`;
  }
  type ParticipantRow = HavocComparison['slots'][number]['havoc']['lines'][number];
  type CombinedRow = {
    key: 'havoc' | 'normal' | 'delta';
    label: string;
  };
  const comparisonRows: readonly CombinedRow[] = [
    { key: 'havoc', label: 'Havoc combined' },
    { key: 'normal', label: 'Normal combined' },
    { key: 'delta', label: 'Delta' },
  ];
  const lineColumns: readonly PlayerStatColumn<ParticipantRow>[] = [
    { key: 'points', label: 'Pts', value: (line) => line.line.points },
    {
      key: 'fieldGoals',
      label: 'FG',
      value: (line) => `${line.line.fieldGoals.made}/${line.line.fieldGoals.attempted}`,
    },
    { key: 'trueShooting', label: 'TS%', value: (line) => trueShooting(line.line) },
    { key: 'usage', label: 'USG%', value: (line) => usageShare(line.line, havocTeamUsage) },
    { key: 'rebounds', label: 'Reb', value: (line) => line.line.rebounds.total },
    { key: 'assists', label: 'Ast', value: (line) => line.line.assists },
    { key: 'steals', label: 'Stl', value: (line) => line.line.steals },
    { key: 'blocks', label: 'Blk', value: (line) => line.line.blocks },
    { key: 'turnovers', label: 'TO', value: (line) => line.line.turnovers },
    { key: 'fouls', label: 'PF', value: (line) => line.line.fouls },
  ];
  function combinedTotal(
    slot: HavocComparison['slots'][number],
  ): PlayerStatsTotals<ParticipantRow> {
    return {
      label: 'Combined (slot total)',
      value: (column) => {
        const line = slot.havoc.combined;
        switch (column.key) {
          case 'points':
            return line.points;
          case 'fieldGoals':
            return `${line.fieldGoals.made}/${line.fieldGoals.attempted}`;
          case 'trueShooting':
            return trueShooting(line);
          case 'usage':
            return usageShare(line, havocTeamUsage);
          case 'rebounds':
            return line.rebounds.total;
          case 'assists':
            return line.assists;
          case 'steals':
            return line.steals;
          case 'blocks':
            return line.blocks;
          case 'turnovers':
            return line.turnovers;
          case 'fouls':
            return line.fouls;
          default:
            return '—';
        }
      },
    };
  }
  function comparisonColumns(
    slot: HavocComparison['slots'][number],
  ): readonly PlayerStatColumn<CombinedRow>[] {
    function sideOf(row: CombinedRow): HavocStatLine {
      return row.key === 'normal' ? slot.normal.combined : slot.havoc.combined;
    }
    return [
      {
        key: 'points',
        label: 'Pts',
        value: (row) => (row.key === 'delta' ? signed(slot.deltas.points) : sideOf(row).points),
      },
      {
        key: 'fieldGoals',
        label: 'FG',
        value: (row) =>
          row.key === 'delta'
            ? `${signed(slot.deltas.fieldGoalsMade)}/${signed(slot.deltas.fieldGoalAttempts)}`
            : `${sideOf(row).fieldGoals.made}/${sideOf(row).fieldGoals.attempted}`,
      },
      {
        key: 'trueShooting',
        label: 'TS%',
        value: (row) =>
          row.key === 'delta'
            ? trueShootingDelta(slot.havoc.combined, slot.normal.combined)
            : trueShooting(sideOf(row)),
      },
      {
        key: 'usage',
        label: 'USG%',
        value: (row) =>
          row.key === 'delta'
            ? usageDelta(slot.havoc.combined, slot.normal.combined)
            : usageShare(sideOf(row), row.key === 'normal' ? normalTeamUsage : havocTeamUsage),
      },
      {
        key: 'rebounds',
        label: 'Reb',
        value: (row) =>
          row.key === 'delta' ? signed(slot.deltas.rebounds) : sideOf(row).rebounds.total,
      },
      {
        key: 'assists',
        label: 'Ast',
        value: (row) => (row.key === 'delta' ? signed(slot.deltas.assists) : sideOf(row).assists),
      },
      {
        key: 'steals',
        label: 'Stl',
        value: (row) => (row.key === 'delta' ? signed(slot.deltas.steals) : sideOf(row).steals),
      },
      {
        key: 'blocks',
        label: 'Blk',
        value: (row) => (row.key === 'delta' ? signed(slot.deltas.blocks) : sideOf(row).blocks),
      },
      {
        key: 'turnovers',
        label: 'TO',
        value: (row) =>
          row.key === 'delta' ? signed(slot.deltas.turnovers) : sideOf(row).turnovers,
      },
      {
        key: 'fouls',
        label: 'PF',
        value: (row) => (row.key === 'delta' ? signed(slot.deltas.fouls) : sideOf(row).fouls),
      },
    ];
  }
</script>

<div class="flex min-w-0 flex-col gap-4" data-havoc-report>
  <Panel as="section" padding="md" aria-labelledby="havoc-report-heading">
    <SectionHeading
      eyebrow={`Havoc Report · ${report.runId}`}
      headingId="havoc-report-heading"
      align="end"
    >
      {#snippet title()}
        {havocRecordLabel(report.havoc.wins, report.havoc.losses)}
        {#if report.perfectSeason}
          <span class="text-primary">· 82–0</span>
        {/if}
      {/snippet}
      {#snippet actions()}
        <span
          class="rounded-full border px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.12em] uppercase {report.status ===
          'complete'
            ? 'border-primary text-primary'
            : 'border-border text-muted-foreground'}"
        >
          {report.status === 'complete' ? 'Comparison complete' : 'Comparison pending'}
        </span>
      {/snippet}
    </SectionHeading>
    <StatGrid class="mt-3" columns={4} mobile={2} gap="md">
      <StatTile
        label="Points for"
        size="sm"
        valueClass="font-mono"
        value={report.havoc.pointsFor}
      />
      <StatTile
        label="Points against"
        size="sm"
        valueClass="font-mono"
        value={report.havoc.pointsAgainst}
      />
      <StatTile
        label="Differential"
        size="sm"
        valueClass="font-mono"
        value={report.havoc.differential}
      />
      <StatTile
        label="Direct mutation points"
        size="sm"
        valueClass="font-mono"
        value={report.directMutationPoints}
        data-havoc-direct-mutation-points
      />
    </StatGrid>
    <details class="mt-3">
      <summary
        class="cursor-pointer font-mono text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Version identifiers
      </summary>
      <dl class="mt-2 grid gap-1 font-mono text-[11px] text-muted-foreground sm:grid-cols-2">
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Schema</dt>
          <dd>{report.versions.schemaVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Rules</dt>
          <dd>{report.versions.rulesVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Mutations</dt>
          <dd>{report.versions.mutationCatalogVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Seeds</dt>
          <dd>{report.versions.seedDerivationVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Engine</dt>
          <dd>{report.versions.engineVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Profile</dt>
          <dd>{report.versions.profileVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Data</dt>
          <dd>{report.versions.dataVersion}</dd>
        </div>
        <div class="flex gap-2">
          <dt class="font-bold uppercase">Catalog</dt>
          <dd class="break-all">{report.versions.catalogVersion}</dd>
        </div>
      </dl>
    </details>
  </Panel>

  <Panel as="section" padding="md" aria-labelledby="havoc-report-lineup">
    <SectionHeading
      title="Drafted lineup & packages"
      headingId="havoc-report-lineup"
      level={3}
      size="sm"
    />
    <ul class="mt-3 flex flex-col gap-2">
      {#each report.lineup as entry (entry.slot)}
        <li class="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
          <span class="w-8 shrink-0 font-mono text-xs font-bold text-muted-foreground uppercase">
            {entry.slot}
          </span>
          <div class="min-w-0 flex-1">
            <p class="flex flex-wrap items-center gap-2">
              <span class="font-display text-sm font-extrabold tracking-tight uppercase">
                {entry.nickname}
              </span>
              <HavocTierBadge tier={entry.tier} size="sm" />
            </p>
            <p class="text-xs text-muted-foreground">{entry.displayName}</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {entry.mutations.map((mutation) => mutationNameOf(mutation.mutationId)).join(', ')}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </Panel>

  {#if report.mvp !== null && comparison !== null}
    <HavocMvpCard {comparison} />
  {/if}

  <div class="grid gap-4 lg:grid-cols-2">
    <Panel as="section" padding="md" aria-labelledby="havoc-report-gains">
      <SectionHeading title="Top gains" headingId="havoc-report-gains" level={3} size="sm" />
      {#if report.topGains.length === 0}
        <EmptyState class="mt-2" title="Available after the comparison completes" surface="none" />
      {:else}
        <ul class="mt-2 flex flex-col gap-1 text-xs">
          {#each report.topGains as difference (difference.gameNumber)}
            <li class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span class="min-w-0 text-muted-foreground"
                >Game {difference.gameNumber} vs {difference.opponentId}</span
              >
              <span class="shrink-0 font-mono">
                {difference.humanScore}–{difference.opponentScore}
                <span class="font-bold text-primary">+{difference.pointsDelta}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Panel>

    <Panel as="section" padding="md" aria-labelledby="havoc-report-losses">
      <SectionHeading title="Top losses" headingId="havoc-report-losses" level={3} size="sm" />
      {#if report.topLosses.length === 0}
        <EmptyState class="mt-2" title="Available after the comparison completes" surface="none" />
      {:else}
        <ul class="mt-2 flex flex-col gap-1 text-xs">
          {#each report.topLosses as difference (difference.gameNumber)}
            <li class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
              <span class="min-w-0 text-muted-foreground"
                >Game {difference.gameNumber} vs {difference.opponentId}</span
              >
              <span class="shrink-0 font-mono">
                {difference.humanScore}–{difference.opponentScore}
                <span class="font-bold text-destructive">{difference.pointsDelta}</span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </Panel>
  </div>

  <Panel as="section" padding="md" aria-labelledby="havoc-report-wildest">
    <SectionHeading
      title="Wildest recorded games"
      headingId="havoc-report-wildest"
      level={3}
      size="sm"
    />
    {#if report.wildestGames.length === 0}
      <EmptyState class="mt-2" title="No games recorded yet" surface="none" />
    {:else}
      <ul class="mt-2 flex flex-col gap-1.5 text-xs">
        {#each report.wildestGames as game (game.gameNumber)}
          <li class="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
            <span class="min-w-0 text-muted-foreground"
              >Game {game.gameNumber} vs {game.opponentId}</span
            >
            <span class="shrink-0 font-mono">
              {game.humanScore}–{game.opponentScore} · margin {game.absoluteMargin} · adjustments
              {game.adjustments}
            </span>
          </li>
        {/each}
      </ul>
    {/if}
  </Panel>

  {#if comparison !== null}
    <Panel as="section" padding="md" aria-labelledby="havoc-report-lines">
      <SectionHeading
        title="Starter, clone, and replacement lines"
        headingId="havoc-report-lines"
        level={3}
        size="sm"
        description="Clone and replacement production belongs to its originating draft slot for the comparison and awards, but each line stays visible."
      />
      <div class="mt-3 flex flex-col gap-3">
        {#each comparison.slots as slot (slot.slot)}
          <div class="min-w-0 rounded-lg bg-surface-2 p-3">
            <p class="flex items-center gap-2 text-sm font-semibold">
              <span class="font-mono text-xs text-muted-foreground uppercase">{slot.slot}</span>
              {slot.displayName}
            </p>
            <div class="havoc-scroll-x mt-2 overflow-x-auto">
              <PlayerStatsTable
                columns={lineColumns}
                rows={slot.havoc.lines}
                rowKey={(line) => line.instanceId}
                caption={`Participant lines for the ${slot.slot} draft slot`}
                playerLabel="Line"
                totals={combinedTotal(slot)}
                tableClass="min-w-[38rem] text-xs"
                statCellClass="font-mono"
                totalCellClass="font-mono"
              >
                {#snippet identity(line)}
                  <span class="block max-w-44 truncate text-left font-semibold">
                    {line.displayName}
                    <span class="ml-1 font-mono text-[10px] font-normal text-muted-foreground">
                      {havocParticipantKindLabel(line.kind)}
                    </span>
                  </span>
                {/snippet}
              </PlayerStatsTable>
              <PlayerStatsTable
                columns={comparisonColumns(slot)}
                rows={comparisonRows}
                rowKey={(row) => row.key}
                caption={`Matched normal and havoc totals for the ${slot.slot} draft slot`}
                playerLabel="Season"
                tableClass="mt-2 min-w-[38rem] text-xs"
                statCellClass="font-mono"
              >
                {#snippet identity(row)}
                  <span class="font-semibold">{row.label}</span>
                {/snippet}
              </PlayerStatsTable>
            </div>
            <p class="mt-2 font-mono text-[10px] text-muted-foreground">
              Production index {slot.productionIndex.havoc} vs {slot.productionIndex.normal} · gain {signed(
                slot.productionIndex.gain,
              )}
            </p>
          </div>
        {/each}
      </div>
    </Panel>

    <HavocComparisonView {comparison} />
  {:else}
    <Panel as="section" padding="md">
      <SectionHeading title="Matched comparison" level={3} size="sm" />
      <EmptyState
        class="mt-2"
        title="Matched comparison unavailable"
        message="The normal season is not final yet. Baseline numbers, the paired chart, and the MVP stay hidden until all 82 normal games are accepted."
        surface="none"
      />
    </Panel>
  {/if}
</div>
