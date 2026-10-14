<script lang="ts">
  import { resolve } from '$app/paths';
  import type { RouteId } from '$app/types';
  import { Trophy } from '@lucide/svelte';
  import AsyncState from '#lib/components/AsyncState.svelte';
  import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { variantLabel } from '#lib/draft-presentation.js';
  import { eraName } from '#lib/season/season-branding.js';
  let {
    manifest,
    rows,
    active,
    modeLabel,
    emptyTitle,
    emptyHref,
    emptyCta,
    continueHref,
    resultHrefFor,
  }: {
    manifest: HoopRushManifest | null;
    rows: CompletedRunIndex[];
    active: ActiveRunCheckpoint | null;
    modeLabel: string;
    emptyTitle: string;
    emptyHref: string;
    emptyCta: string;
    continueHref: string | null;
    resultHrefFor: (runId: string) => string;
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
</script>

{#if rows.length === 0 && !active}
  <div class="mt-8">
    <AsyncState kind="empty" title={emptyTitle}>
      {#snippet actions()}
        <a
          href={resolve(emptyHref as any)}
          class="ui-btn ui-btn--sm bg-primary text-primary-foreground"
        >
          {emptyCta}
        </a>
      {/snippet}
    </AsyncState>
  </div>
{:else}
  {#if active && active.status === 'active' && continueHref}
    <div
      class="mt-8 rounded-xl border border-line-strong bg-surface-2 p-5"
      aria-label={`${modeLabel} active challenge`}
    >
      <p class="font-display text-lg font-extrabold tracking-tight uppercase">Active challenge</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {franchiseName(active.franchiseId)} · {eraName(manifest, active.eraId)} · game
        {(active.gamesPlayed ?? 0) + 1} of 82 · {active.aggregates.team.wins}-
        {active.aggregates.team.losses}
      </p>
      <a
        href={resolve(continueHref as any)}
        class="mt-3 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
      >
        Continue
      </a>
    </div>
  {/if}

  <ul class="mt-8 flex flex-col gap-3">
    {#each rows as row (row.runId)}
      {@const isClassic = row.mode === 'classic'}
      <li>
        <a
          href={resolve(resultHrefFor(row.runId) as any)}
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-line-strong"
        >
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary"
          >
            <Trophy class="h-5 w-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
            >
              {#if isClassic}
                Classic · {variantLabel(row.variant ?? 'ratings')}
              {:else}
                {franchiseName(row.franchiseId)} · {eraName(manifest, row.eraId)}
              {/if}
            </span>
            <span class="block font-mono text-[10px] text-muted-foreground">
              {#if isClassic}
                five drafted players
              {:else}
                {row.playerIds.length} players · {franchiseLabel(row.franchiseId)}
              {/if}
            </span>
          </span>
          <span class="font-display text-xl font-extrabold tracking-tight">
            {row.wins}<span class="text-muted-foreground">–</span>{row.losses}
          </span>
          <span class="w-full font-mono text-[10px] text-muted-foreground sm:w-auto">
            {formatTime(row.completedAtIso)}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
