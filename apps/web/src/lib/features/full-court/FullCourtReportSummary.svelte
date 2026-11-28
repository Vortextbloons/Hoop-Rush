<script lang="ts">
  import type {
    FullCourtAwardsBoard,
    FullCourtNotableMoment,
    FullCourtPlayerSeasonRow,
    FullCourtStandingsRow,
  } from '@hoop-rush/engine';
  import { Dices, Gauge, Shield, TrendingUp, Users } from '@lucide/svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import SectionHeading from '#lib/components/ui/SectionHeading.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.ts';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtGameMomentsStrip from './FullCourtGameMomentsStrip.svelte';
  import FullCourtReportHardware from './FullCourtReportHardware.svelte';

  let {
    entry,
    rosterStats,
    userRow,
    awards,
    art = null,
    topMoments = [],
  }: {
    entry: FullCourtHistoryEntryView;
    rosterStats: readonly FullCourtPlayerSeasonRow[];
    userRow: FullCourtStandingsRow | null;
    awards: FullCourtAwardsBoard;
    art?: FullCourtArt | null;
    topMoments?: readonly FullCourtNotableMoment[];
  } = $props();

  const leader = $derived(
    [...rosterStats].sort((left, right) => right.ppg - left.ppg).at(0) ?? null,
  );
  const record = $derived(entry.regularRecordLabel.split('–'));
  const wins = $derived(Number(record[0] ?? 0));
  const losses = $derived(Number(record[1] ?? 0));
  const winPct = $derived(
    wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 1000) / 10,
  );
</script>

<FullCourtReportHardware {awards} {art} />

<Panel as="section" padding="md" aria-label="Season results">
  <SectionHeading
    eyebrow="The season"
    title="How the run finished"
    level={2}
    size="sm"
    description={entry.playoffLabel}
  />

  <StatGrid class="mt-3" columns={4} mobile={2} gap="sm">
    <StatTile label="Record" size="md" surface="tile" value={entry.regularRecordLabel} />
    <StatTile label="Win rate" size="md" surface="tile" value={`${String(winPct)}%`} />
    <StatTile label="Point diff" size="md" surface="tile" value={entry.pointDiffLabel} />
    <StatTile label="Series won" size="md" surface="tile" value={String(entry.seriesWon)} />
  </StatGrid>

  {#if userRow !== null}
    <div class="summary-strip mt-3">
      <span class="summary-chip">
        <TrendingUp size={12} aria-hidden="true" />
        #{userRow.seed} seed · {userRow.conference === 'east' ? 'East' : 'West'}
      </span>
      <span class="summary-chip">
        <Shield size={12} aria-hidden="true" />
        {userRow.pointsFor} scored · {userRow.pointsAgainst} allowed
      </span>
      {#if leader !== null}
        <span class="summary-chip">
          <Users size={12} aria-hidden="true" />
          {leader.displayName} · {leader.ppg.toFixed(1)} PPG
        </span>
      {/if}
    </div>
  {/if}
</Panel>

<div class="grid gap-3 sm:grid-cols-2">
  <Panel as="section" padding="md" aria-label="Strategy">
    <div class="flex items-center gap-2">
      <Gauge size={14} class="text-primary" aria-hidden="true" />
      <p class="ui-label">Strategy</p>
    </div>
    <p class="mt-2 text-sm font-semibold">{entry.strategySummary}</p>
    <p class="mt-1 text-xs text-muted-foreground">
      {entry.customRotation ? 'Custom rotation & minute targets' : 'Auto rotation'}
    </p>
  </Panel>

  <Panel as="section" padding="md" aria-label="Economy">
    <div class="flex items-center gap-2">
      <Dices size={14} class="text-primary" aria-hidden="true" />
      <p class="ui-label">Economy</p>
    </div>
    <p class="mt-2 text-sm font-semibold">
      {entry.warChestSpentLabel} spent · {entry.warChestRemainingLabel} left
    </p>
    <p class="mt-1 text-xs text-muted-foreground">
      Scouting {entry.scoutingSpentLabel}
    </p>
  </Panel>
</div>

<Panel as="section" padding="md" aria-label="Bench">
  <SectionHeading eyebrow="Bench" title="Second unit" level={2} size="sm" />
  {#if entry.benchSummaryLabel !== null}
    <p class="mt-2 text-sm font-semibold">{entry.benchSummaryLabel}</p>
  {:else}
    <p class="mt-2 text-xs text-muted-foreground">
      Bench totals were not recorded for this archive.
    </p>
  {/if}
  {#if entry.benchBestGameLabel !== null}
    <p class="mt-1 text-xs text-muted-foreground">{entry.benchBestGameLabel}</p>
  {/if}
</Panel>

{#if topMoments.length > 0}
  <Panel as="section" padding="md" aria-label="Run notable moments">
    <SectionHeading eyebrow="Highlights" title="Signature performances" level={2} size="sm" />
    <FullCourtGameMomentsStrip moments={topMoments} {art} label="Signature performances" />
  </Panel>
{/if}

<style>
  .summary-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .summary-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--color-line-soft);
    border-radius: 999px;
    background: var(--color-surface-2);
    color: var(--color-muted-foreground);
    font-family: var(--font-mono);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
