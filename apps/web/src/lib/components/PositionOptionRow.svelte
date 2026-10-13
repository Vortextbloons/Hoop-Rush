<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    slotLabel,
    ariaLabel,
    disabled = false,
    tone,
    incumbent = null,
    emptyLabel,
    onSelect,
    trailing,
  }: {
    slotLabel: string;
    ariaLabel: string;
    disabled?: boolean;
    tone: 'open' | 'move' | 'self' | 'muted';
    incumbent?: { name: string; meta: string } | null;
    emptyLabel: string;
    onSelect: () => void;
    trailing: Snippet;
  } = $props();
</script>

<button
  type="button"
  aria-label={ariaLabel}
  {disabled}
  onclick={onSelect}
  class="ui-pos-option"
  data-tone={tone}
>
  <span class="ui-pos-badge">{slotLabel}</span>
  <span class="min-w-0 flex-1">
    {#if incumbent !== null}
      <span class="block truncate text-sm font-bold">{incumbent.name}</span>
      <span class="block font-mono text-[10px] text-muted-foreground">{incumbent.meta}</span>
    {:else}
      <span class="block truncate text-sm font-semibold">{emptyLabel}</span>
    {/if}
  </span>
  <span class="flex shrink-0 items-center gap-1.5">
    {@render trailing()}
  </span>
</button>
