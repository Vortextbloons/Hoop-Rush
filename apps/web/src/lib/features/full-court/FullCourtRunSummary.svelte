<script lang="ts">
  import { Trophy } from '@lucide/svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import FullCourtPortrait from '#lib/features/full-court/FullCourtPortrait.svelte';
  import FullCourtRating from '#lib/features/full-court/FullCourtRating.svelte';
  import type { FullCourtHistoryEntryView } from './full-court-history-presentation.js';

  let { entry, showHeadline = true }: { entry: FullCourtHistoryEntryView; showHeadline?: boolean } =
    $props();
</script>

<Panel as="article" padding="md">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        {#if showHeadline}
          <span class="font-display text-3xl font-extrabold tracking-tight tabular-nums">
            {entry.regularRecordLabel}
          </span>
        {/if}
        <Badge tone={entry.variant === 'roulette' ? 'accent' : 'neutral'}>
          {entry.variantLabel}
        </Badge>
        <Badge tone={entry.playoffTone}>{entry.playoffLabel}</Badge>
        <Badge class={entry.capStatusClass}>{entry.capStatusLabel}</Badge>
      </div>
      <h2 class="mt-1 text-sm font-semibold">
        {entry.teamName}
        <span class="font-normal text-muted-foreground">
          · {entry.completedDateLabel} · Champion: {entry.championName}
        </span>
      </h2>
    </div>
    {#if entry.achievements.length > 0}
      <div class="flex flex-wrap gap-1.5" aria-label="Achievements">
        {#each entry.achievements as achievement (achievement.id)}
          <Badge tone="accent" class="inline-flex items-center gap-1">
            <Trophy size={12} aria-hidden="true" />
            {achievement.name}
          </Badge>
        {/each}
      </div>
    {/if}
  </div>

  <StatGrid class="mt-4" columns={4} mobile={2} gap="sm">
    <StatTile label="Point diff" size="sm" surface="tile" value={entry.pointDiffLabel} />
    <StatTile label="Series won" size="sm" surface="tile" value={String(entry.seriesWon)} />
    <StatTile label="Payroll" size="sm" surface="tile" value={entry.payrollLabel} />
    <StatTile label="Budget left" size="sm" surface="tile" value={entry.warChestRemainingLabel} />
  </StatGrid>

  <div class="mt-4 grid gap-3 sm:grid-cols-2">
    <div class="rounded-xl border border-line-soft bg-surface-1 p-3">
      <p class="ui-label" data-tone="muted">Strategy</p>
      <p class="mt-1 text-sm font-medium">{entry.strategySummary}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {entry.customRotation ? 'Custom rotation & minute targets' : 'Auto rotation'}
      </p>
    </div>
    <div class="rounded-xl border border-line-soft bg-surface-1 p-3">
      <p class="ui-label" data-tone="muted">Economy</p>
      <p class="mt-1 text-sm font-medium">
        Budget spent: {entry.warChestSpentLabel} · Left: {entry.warChestRemainingLabel}
      </p>
      <p class="mt-1 text-xs text-muted-foreground">
        Scouting: {entry.scoutingSpentLabel} · Roulette spins: {entry.spinSpentLabel}
      </p>
    </div>
  </div>

  {#if entry.benchSummaryLabel !== null || entry.benchBestGameLabel !== null}
    <div class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3">
      <p class="ui-label" data-tone="muted">Bench</p>
      {#if entry.benchSummaryLabel !== null}
        <p class="mt-1 text-sm font-medium">{entry.benchSummaryLabel}</p>
      {/if}
      {#if entry.benchBestGameLabel !== null}
        <p class="mt-1 text-xs text-muted-foreground">{entry.benchBestGameLabel}</p>
      {/if}
    </div>
  {/if}

  <div class="mt-3 rounded-xl border border-line-soft bg-surface-1 p-3">
    <p class="ui-label" data-tone="muted">
      Roster ({entry.roster.length})
    </p>
    <ul class="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
      {#each entry.roster as player (player.playerId)}
        <li
          class="flex items-center justify-between gap-2 rounded-lg border border-line-soft bg-background px-2.5 py-1.5 text-xs"
        >
          <div class="flex min-w-0 items-center gap-2">
            <FullCourtPortrait {player} size="sm" />
            <div class="min-w-0">
              <p class="truncate font-semibold" title={player.displayName}>
                {player.displayName}
              </p>
              <p class="text-muted-foreground">
                {player.teamAbbreviation} · {player.seasonKey} · {player.position}{player.starter
                  ? ' · Starter'
                  : ''}
              </p>
            </div>
          </div>
          <div class="shrink-0 text-right">
            <FullCourtRating value={player.overall} size="sm" layout="inline" align="right" />
            <p class="font-mono text-[10px] tabular-nums text-muted-foreground">
              {player.salaryLabel}
              {#if player.minutesTarget !== null}
                · {player.minutesTarget}m
              {/if}
            </p>
          </div>
        </li>
      {/each}
    </ul>
  </div>
</Panel>
