<script lang="ts">
  import { resolve } from '$app/paths';
  import { Trophy } from '@lucide/svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import HistoryEntryCard from '#lib/components/basketball/HistoryEntryCard.svelte';
  import ActionLink from '#lib/components/ui/ActionLink.svelte';
  import Panel from '#lib/components/ui/Panel.svelte';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { variantLabel } from '#lib/draft-presentation.js';
  import { eraName } from '#lib/branding.js';
  let {
    manifest,
    rows,
    active,
    modeLabel,
    emptyTitle,
    emptyHref,
    emptyCta,
    continueHref,
  }: {
    manifest: HoopRushManifest | null;
    rows: CompletedRunIndex[];
    active: ActiveRunCheckpoint | null;
    modeLabel: string;
    emptyTitle: string;
    emptyHref: '/classic' | '/sandbox';
    emptyCta: string;
    continueHref: string | null;
  } = $props();
  function franchiseName(franchiseId: string | null): string {
    if (!franchiseId) return 'Mixed lineup';
    return (
      manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId)?.displayName ??
      franchiseId
    );
  }
  function franchiseLabel(franchiseId: string | null): string {
    return franchiseId ? franchiseAbbreviation(franchiseId) : 'Mixed';
  }
  function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
  }
  const emptyHrefResolved = $derived(
    emptyHref === '/sandbox' ? resolve('/sandbox') : resolve('/classic'),
  );
  const continueHrefResolved = $derived(
    continueHref === null
      ? null
      : continueHref === '/sandbox/challenge'
        ? resolve('/sandbox/challenge')
        : resolve('/classic/challenge'),
  );
  function resultHref(runId: string, mode: CompletedRunIndex['mode']): string {
    const base = mode === 'classic' ? resolve('/classic/result') : resolve('/sandbox/result');
    return `${base}?runId=${encodeURIComponent(runId)}`;
  }
</script>

{#if rows.length === 0 && !active}
  <div class="mt-8">
    <AsyncState kind="empty" title={emptyTitle}>
      {#snippet actions()}
        <ActionLink href={emptyHrefResolved} size="sm" tone="primary">
          {emptyCta}
        </ActionLink>
      {/snippet}
    </AsyncState>
  </div>
{:else}
  {#if active && active.status === 'active' && continueHrefResolved !== null}
    <Panel
      padding="md"
      class="mt-8 border-line-strong bg-surface-2"
      aria-label={`${modeLabel} active challenge`}
    >
      <p class="font-display text-lg font-extrabold tracking-tight uppercase">Active challenge</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {franchiseName(active.franchiseId)} · {eraName(manifest, active.eraId)} · game
        {(active.gamesPlayed ?? 0) + 1} of 82 · {active.aggregates.team.wins}-
        {active.aggregates.team.losses}
      </p>
      <ActionLink href={continueHrefResolved} tone="primary" class="mt-3">Continue</ActionLink>
    </Panel>
  {/if}

  <ul class="mt-8 flex flex-col gap-3">
    {#each rows as row (row.runId)}
      {@const isClassic = row.mode === 'classic'}
      <HistoryEntryCard href={resultHref(row.runId, row.mode)}>
        {#snippet leading()}
          <span class="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
            <Trophy class="h-5 w-5" />
          </span>
        {/snippet}
        {#snippet title()}
          <span
            class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
          >
            {#if isClassic}
              Classic · {variantLabel(row.variant ?? 'ratings')}
            {:else}
              {franchiseName(row.franchiseId)} · {eraName(manifest, row.eraId)}
            {/if}
          </span>
        {/snippet}
        {#snippet meta()}
          <span class="block">
            {#if isClassic}
              five drafted players
            {:else}
              {row.playerIds.length} players · {franchiseLabel(row.franchiseId)}
            {/if}
          </span>
          <span class="block">{formatTime(row.completedAtIso)}</span>
        {/snippet}
        {#snippet trailing()}
          <span class="font-display text-xl font-extrabold tracking-tight">
            {row.wins}<span class="text-muted-foreground">–</span>{row.losses}
          </span>
        {/snippet}
      </HistoryEntryCard>
    {/each}
  </ul>
{/if}
