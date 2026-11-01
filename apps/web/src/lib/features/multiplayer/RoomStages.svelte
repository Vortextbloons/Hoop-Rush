<script lang="ts">
  import { Check } from '@lucide/svelte';

  let { labels, current }: { labels: readonly string[]; current: number } = $props();
</script>

<ol class="room-stages" aria-label="Match progress">
  {#each labels as label, i (label)}
    <li
      class:current={i === current}
      class:finished={i < current}
      aria-current={i === current ? 'step' : undefined}
    >
      <span
        >{#if i < current}<Check size={13} aria-hidden="true" />{:else}{i + 1}{/if}</span
      >{label}
    </li>
  {/each}
</ol>
