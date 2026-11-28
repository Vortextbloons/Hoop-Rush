<script lang="ts">
  import { resolve } from '$app/paths';
  import { Trophy } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Badge from '#lib/components/ui/Badge.svelte';
  import EmptyState from '#lib/components/ui/EmptyState.svelte';
  import PageHeader from '#lib/components/ui/PageHeader.svelte';
  import PageShell from '#lib/components/ui/PageShell.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import StatGrid from '#lib/components/ui/StatGrid.svelte';
  import StatTile from '#lib/components/ui/StatTile.svelte';
  import { errorMessageOf } from '#lib/errors.js';
  import FullCourtPortrait from '#lib/features/full-court/FullCourtPortrait.svelte';
  import FullCourtRating from '#lib/features/full-court/FullCourtRating.svelte';
  import {
    presentFullCourtHistoryEntry,
    type FullCourtHistoryEntryView,
  } from '#lib/features/full-court/full-court-history-presentation.js';
  import { getPersistence } from '#lib/persistence.js';

  let loading = $state(true);
  let error = $state<string | null>(null);
  let entries = $state.raw<FullCourtHistoryEntryView[]>([]);

  onMount(() => {
    let active = true;
    void getPersistence()
      .fullCourtHistoryRepository.list()
      .then((records) => {
        if (!active) return;
        entries = records.map(presentFullCourtHistoryEntry);
      })
      .catch((cause) => {
        if (!active) return;
        error = errorMessageOf(cause);
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
</script>

<svelte:head>
  <title>Full Court History · Hoop Rush</title>
</svelte:head>

<PageShell as="section" width="lg" padding="md" aria-label="Full Court history">
  <PageHeader
    eyebrow="Full Court · History"
    title="Completed seasons."
    description="Finished Full Court runs with their variant, roster, coaching strategy, economy, playoff finish, and achievements."
  >
    {#snippet actions()}
      <ActionLink href={resolve('/full-court')} tone="secondary">Full Court home</ActionLink>
      <ActionLink href={resolve('/profile')} tone="secondary">Profile</ActionLink>
    {/snippet}
  </PageHeader>

  <div class="mt-4">
    {#if loading}
      <EmptyState
        kind="loading"
        title="Loading history"
        message="Reading your completed Full Court runs…"
      />
    {:else if error !== null && entries.length === 0}
      <EmptyState kind="error" title="History unavailable" message={error} />
    {:else if entries.length === 0}
      <EmptyState
        kind="empty"
        title="No completed Full Court runs yet"
        message="Complete the 82-game regular season and playoffs in Full Court to archive a run here."
      >
        {#snippet actions()}
          <ActionLink href={resolve('/full-court')}>Open Full Court</ActionLink>
        {/snippet}
      </EmptyState>
    {:else}
      <ul class="flex flex-col gap-4">
        {#each entries as entry (entry.runId)}
          <Panel as="li" padding="md">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-display text-3xl font-extrabold tracking-tight tabular-nums">
                    {entry.regularRecordLabel}
                  </span>
                  <Badge tone={entry.variant === 'roulette' ? 'accent' : 'neutral'}>
                    {entry.variantLabel}
                  </Badge>
                  <Badge tone={entry.playoffTone}>{entry.playoffLabel}</Badge>
                  <Badge class={entry.capStatusClass}>{entry.capStatusLabel}</Badge>
                </div>
                <p class="mt-1 text-sm font-semibold">
                  {entry.teamName}
                  <span class="font-normal text-muted-foreground">
                    · {entry.completedDateLabel} · Champion: {entry.championName}
                  </span>
                </p>
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
              <StatTile
                label="Series won"
                size="sm"
                surface="tile"
                value={String(entry.seriesWon)}
              />
              <StatTile label="Payroll" size="sm" surface="tile" value={entry.payrollLabel} />
              <StatTile
                label="Budget left"
                size="sm"
                surface="tile"
                value={entry.warChestRemainingLabel}
              />
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
                      <FullCourtRating
                        value={player.overall}
                        size="sm"
                        layout="inline"
                        align="right"
                      />
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
        {/each}
      </ul>
    {/if}
  </div>
</PageShell>
