<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { Snippet } from 'svelte';
  import SeasonPlayerFace from './SeasonPlayerFace.svelte';
  import { formatPositions } from '#lib/player-positions.js';
  import type { SeasonFaceRef } from '#lib/season/season-branding.js';
  let {
    face,
    manifest,
    displayName,
    seasonKey = null,
    positions = [],
    overall = null,
    overallDelta = null,
    eraLabel = null,
    inlineEra = false,
    chipsInline = false,
    chips = null,
    footer = null,
  }: {
    face: SeasonFaceRef | null;
    manifest: HoopRushManifest;
    displayName: string;
    seasonKey?: string | null;
    positions?: readonly string[];
    overall?: number | null;
    overallDelta?: number | null;
    eraLabel?: string | null;
    inlineEra?: boolean;
    chipsInline?: boolean;
    chips?: Snippet | null;
    footer?: Snippet | null;
  } = $props();
  const hasMeta = $derived(
    seasonKey !== null || positions.length > 0 || (inlineEra && eraLabel !== null),
  );
</script>

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
    <div class="flex min-w-0 flex-wrap items-center gap-2">
      <span class="min-w-0 truncate text-sm leading-snug font-semibold">{displayName}</span>
      {#if overall !== null}
        <span class="sr-chip shrink-0">
          OVR {overall}{#if overallDelta !== null}
            → {overall + overallDelta}{/if}
        </span>
      {/if}
      {#if chipsInline && chips !== null}
        {@render chips()}
      {/if}
    </div>
    {#if !chipsInline && chips !== null}
      <div class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
        {@render chips()}
      </div>
    {/if}
    {#if hasMeta}
      <p class="mt-1 truncate font-mono text-[10px] leading-snug text-muted-foreground">
        {#if seasonKey !== null}{seasonKey}{/if}
        {#if positions.length > 0}{seasonKey !== null ? ' · ' : ''}{formatPositions(positions)}{/if}
        {#if inlineEra && eraLabel !== null}{seasonKey !== null || positions.length > 0
            ? ' · '
            : ''}{eraLabel}{/if}
      </p>
    {/if}
    {#if !inlineEra && eraLabel !== null}
      <p class="mt-0.5 line-clamp-2 font-mono text-[9px] leading-snug text-muted-foreground/70">
        {eraLabel}
      </p>
    {/if}
    {#if footer !== null}
      {@render footer()}
    {/if}
  </div>
</div>
