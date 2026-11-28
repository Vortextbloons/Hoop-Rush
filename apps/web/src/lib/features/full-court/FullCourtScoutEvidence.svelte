<script lang="ts">
  import FullCourtPortrait from './FullCourtPortrait.svelte';
  import type { FullCourtArt, FullCourtArtPlayer } from './full-court-art.ts';
  import { scoutFieldLabel, scoutFieldValue, type ScoutField } from './full-court-scout-labels';

  let {
    items,
    emptyLabel = null,
    art = null,
  }: {
    items: readonly {
      field: ScoutField;
      value: number;
      name?: string;
      player?: FullCourtArtPlayer | null;
    }[];
    emptyLabel?: string | null;
    art?: FullCourtArt | null;
  } = $props();
</script>

{#if items.length === 0}
  {#if emptyLabel !== null}
    <p class="font-mono text-[9px] text-muted-foreground">{emptyLabel}</p>
  {/if}
{:else}
  <ul class="flex flex-wrap gap-1.5">
    {#each items as item, index (index)}
      <li
        class="inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-line-soft bg-surface-2/80 px-2 py-1 text-[11px] text-muted-foreground"
      >
        {#if item.player}
          <FullCourtPortrait player={item.player} {art} size="sm" />
        {/if}
        <span class="min-w-0">
          {#if item.name !== undefined}
            <span class="font-semibold text-foreground">{item.name}</span>
            <span aria-hidden="true"> · </span>
          {/if}
          <span>{scoutFieldLabel(item.field)}</span>
          <span class="font-mono text-[10px] font-bold text-foreground tabular-nums"
            >{scoutFieldValue(item.field, item.value)}</span
          >
        </span>
      </li>
    {/each}
  </ul>
{/if}
