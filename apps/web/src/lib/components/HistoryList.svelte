<script lang="ts">import { resolve } from '$app/paths';
import type { RouteId } from '$app/types';
import { Trophy } from '@lucide/svelte';
import type { ActiveRunCheckpoint, CompletedRunIndex } from '@hoop-rush/persistence';
import type { HoopRushManifest } from '@hoop-rush/data-contracts';
import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
import { variantLabel } from '$lib/draft-presentation';
import SeasonTierBadge from '$lib/components/SeasonTierBadge.svelte';
import { seasonTierFromWins } from '$lib/season-tier';
let { manifest, rows, active, modeLabel, emptyTitle, emptyHref, emptyCta, continueHref, resultHrefFor, }: {
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
    if (!franchiseId)
        return 'Mixed lineup';
    return (manifest?.modernFranchiseSlots.find((e) => e.franchiseId === franchiseId)?.displayName ??
        franchiseId);
}
function franchiseLabel(franchiseId: string | null): string {
    return franchiseId ? franchiseAbbreviation(franchiseId) : 'Mixed';
}
function eraName(eraId: string): string {
    return manifest?.eras.find((e) => e.eraId === eraId)?.label ?? eraId;
}
function formatTime(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
</script>

{#if rows.length === 0 && !active}
  <div class="mt-8 rounded-xl border border-border bg-card p-10 text-center">
    <p class="font-mono text-sm text-muted-foreground">{emptyTitle}</p>
    <a
      href={resolve(emptyHref as RouteId)}
      class="mt-4 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
    >
      {emptyCta}
    </a>
  </div>
{:else}
  {#if active && active.status === 'active' && continueHref}
    <div
      class="mt-8 rounded-xl border border-line-strong bg-surface-2 p-5"
      aria-label={`${modeLabel} active challenge`}
    >
      <p class="font-display text-lg font-extrabold tracking-tight uppercase">Active challenge</p>
      <p class="mt-1 text-sm text-muted-foreground">
        {franchiseName(active.franchiseId)} · {eraName(active.eraId)} · game
        {(active.gamesPlayed ?? 0) + 1} of 82 · {active.aggregates.team.wins}-
        {active.aggregates.team.losses}
      </p>
      <a
        href={resolve(continueHref as RouteId)}
        class="mt-3 inline-flex rounded-lg bg-primary px-5 py-2.5 font-semibold text-primary-foreground"
      >
        Continue
      </a>
    </div>
  {/if}

  <ul class="mt-8 flex flex-col gap-3">
    {#each rows as row (row.runId)}
      {@const tier = seasonTierFromWins(row.wins)}
      {@const isClassic = row.mode === 'classic'}
      <li>
        <a
          href={resolve(resultHrefFor(row.runId) as RouteId)}
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card p-4 transition-colors hover:border-line-strong"
        >
          <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg {tier.iconClass}">
            <Trophy class="h-5 w-5" />
          </span>
          <span class="min-w-0 flex-1">
            <span
              class="font-display block truncate text-base font-extrabold tracking-tight uppercase"
            >
              {#if isClassic}
                Classic · {variantLabel(row.variant ?? 'ratings')}
              {:else}
                {franchiseName(row.franchiseId)} · {eraName(row.eraId)}
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
          <SeasonTierBadge wins={row.wins} />
          <span class="w-full font-mono text-[10px] text-muted-foreground sm:w-auto">
            {formatTime(row.completedAtIso)}
          </span>
        </a>
      </li>
    {/each}
  </ul>
{/if}
