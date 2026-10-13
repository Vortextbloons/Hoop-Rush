<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerIdentity from '$lib/components/season/SeasonPlayerIdentity.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';
  let {
    playerVersionId,
    displayName,
    seasonKey,
    franchiseId,
    face,
    manifest,
    eraDisplayLabel,
    eraLogoCandidates,
    teamExternalId,
    teamDisplayName,
    overall,
    overallDelta = null,
    playable,
    role,
    minutes,
    active,
    fatigueBadgeClass,
    fatigueBadgeText,
    recentLoadText,
    lastMinutes,
    gearPoints,
    selectable,
    onSelect,
  }: {
    playerVersionId: string;
    displayName: string;
    seasonKey: string;
    franchiseId: string;
    face: SeasonFaceRef | null;
    manifest: HoopRushManifest;
    eraDisplayLabel: string | null;
    eraLogoCandidates: readonly string[];
    teamExternalId: string;
    teamDisplayName: string;
    overall: number | null;
    overallDelta?: number | null;
    playable: readonly string[];
    role: string;
    minutes: number | string;
    active: boolean;
    fatigueBadgeClass: string | null;
    fatigueBadgeText: string | null;
    recentLoadText: string | null;
    lastMinutes: number | null;
    gearPoints: number;
    selectable: boolean;
    onSelect: (playerVersionId: string) => void;
  } = $props();
  const ariaLabel = $derived(`${displayName}, ${role}, ${minutes} minutes`);
</script>

{#if selectable}
  <button
    type="button"
    onclick={() => onSelect(playerVersionId)}
    aria-label={ariaLabel}
    data-testid={`roster-player-${playerVersionId}`}
    class="block min-h-11 w-full p-3 text-left outline-none transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
  >
    {@render row()}
  </button>
{:else}
  <div class="p-3">
    {@render row()}
  </div>
{/if}

{#snippet row()}
  <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
    <div class="min-w-0 flex-1">
      <SeasonPlayerIdentity
        {face}
        {manifest}
        {displayName}
        {seasonKey}
        positions={playable}
        {overall}
        {overallDelta}
        eraLabel={eraDisplayLabel}
      >
        {#snippet chips()}
          {#if gearPoints > 0}
            <span
              class="sr-badge shrink-0"
              data-tone="warn"
              title="Attribute points from applied sponsors"
            >
              +{gearPoints} gear
            </span>
          {/if}
          {#if !active}
            <span class="sr-chip shrink-0">Inactive</span>
          {/if}
          {#if fatigueBadgeClass !== null && fatigueBadgeText !== null}
            <span
              class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${fatigueBadgeClass}`}
            >
              {fatigueBadgeText}
            </span>
          {/if}
        {/snippet}
        {#snippet footer()}
          {#if recentLoadText !== null}
            <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
              {recentLoadText}
              {#if lastMinutes !== null}
                · last game {Math.round(lastMinutes)} min
              {/if}
            </p>
          {/if}
        {/snippet}
      </SeasonPlayerIdentity>
    </div>
    <div
      class="flex shrink-0 items-center justify-between gap-2 border-t border-border/40 pt-2 sm:flex-col sm:items-end sm:justify-start sm:border-t-0 sm:pt-0"
    >
      <SeasonTeamLogo
        {manifest}
        {franchiseId}
        {teamExternalId}
        logoCandidates={eraLogoCandidates}
        size="sm"
        alt={teamDisplayName}
      />
      <span class="whitespace-nowrap font-mono text-[10px] text-muted-foreground">
        {role} · {minutes} min
      </span>
    </div>
  </div>
{/snippet}
