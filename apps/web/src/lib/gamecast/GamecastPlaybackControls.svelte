<script lang="ts">
  import type { Snippet } from 'svelte';
  import Button from '#lib/components/ui/Button.svelte';

  let {
    paused,
    complete,
    ontoggle,
    onskip,
    onreplay = null,
    skipDisabled = false,
    size = 'sm',
    leading = null,
    trailing = null,
  }: {
    paused: boolean;
    complete: boolean;
    ontoggle: () => void;
    onskip: () => void;
    onreplay?: (() => void) | null;
    skipDisabled?: boolean;
    size?: 'sm' | 'md';
    leading?: Snippet | null;
    trailing?: Snippet | null;
  } = $props();
</script>

<div class="flex flex-wrap items-center gap-2">
  {@render leading?.()}
  {#if complete}
    {#if onreplay !== null}
      <Button {size} tone="secondary" onclick={onreplay}>Replay</Button>
    {/if}
  {:else}
    <Button {size} tone="secondary" onclick={ontoggle}>{paused ? 'Resume' : 'Pause'}</Button>
    {@render trailing?.()}
    <Button {size} tone="secondary" disabled={skipDisabled} onclick={onskip}>Skip to final</Button>
  {/if}
</div>
