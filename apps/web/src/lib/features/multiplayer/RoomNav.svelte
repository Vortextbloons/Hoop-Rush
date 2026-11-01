<script lang="ts">
  import { resolve } from '$app/paths';
  import { ArrowLeft } from '@lucide/svelte';
  import ArenaSoundToggle from '#lib/components/ArenaSoundToggle.svelte';

  let { target, label }: { target: 'multiplayer/' | 'draft-duel/'; label: string } = $props();
</script>

<div class="room-nav">
  <a href={resolve(target)}>
    <ArrowLeft size={15} aria-hidden="true" />
    {label}
  </a>

  <ArenaSoundToggle />
</div>

<style>
  a:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 4px;
  }
</style>
