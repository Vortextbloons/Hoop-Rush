<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import SeasonPlayerFace from '$lib/components/season/SeasonPlayerFace.svelte';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  import { formatPositions } from '$lib/player-positions';
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
    <div class="flex min-w-0 items-start gap-2 sm:gap-3">
      {#if face !== null}
        <SeasonPlayerFace {face} {manifest} size="sm" />
      {:else}
        <span
          class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-3 font-display font-extrabold text-muted-foreground"
          aria-hidden="true"
        >
          ?
        </span>
      {/if}
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold leading-snug">{displayName}</p>
        <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
          {#if overall !== null}
            <span
              class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10px] font-bold text-foreground"
            >
              OVR {overall}{#if overallDelta !== null}
                → {overall + overallDelta}{/if}
            </span>
          {/if}
          {#if gearPoints > 0}
            <span
              class="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300 ring-1 ring-amber-400/40"
              title="Attribute points from applied sponsors"
            >
              +{gearPoints} gear
            </span>
          {/if}
          {#if !active}
            <span
              class="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground"
            >
              Inactive
            </span>
          {/if}
          {#if fatigueBadgeClass !== null && fatigueBadgeText !== null}
            <span
              class={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${fatigueBadgeClass}`}
            >
              {fatigueBadgeText}
            </span>
          {/if}
        </div>
        <p class="mt-1 font-mono text-[10px] leading-snug text-muted-foreground">
          {seasonKey}
          {#if playable.length > 0}
            · {formatPositions(playable)}
          {/if}
        </p>
        {#if eraDisplayLabel}
          <p class="mt-0.5 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70">
            {eraDisplayLabel}
          </p>
        {/if}
        {#if recentLoadText !== null}
          <p class="mt-1 font-mono text-[9px] text-muted-foreground/70">
            {recentLoadText}
            {#if lastMinutes !== null}
              · last game {Math.round(lastMinutes)} min
            {/if}
          </p>
        {/if}
      </div>
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
