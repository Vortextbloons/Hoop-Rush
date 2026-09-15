<script lang="ts">
  import { onMount } from 'svelte';
  import { Volume2, VolumeX } from '@lucide/svelte';
  import {
    ARENA_MUTED_EVENT,
    arenaConfirm,
    isArenaMuted,
    toggleArenaMuted,
  } from '$lib/arena-sound';

  let { className = '' }: { className?: string } = $props();
  let muted = $state(false);

  function sync() {
    try {
      muted = isArenaMuted();
    } catch {
      muted = false;
    }
  }

  onMount(() => {
    sync();
    const onChange = () => sync();
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'hoop-rush:arena-muted') sync();
    };
    window.addEventListener(ARENA_MUTED_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(ARENA_MUTED_EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  });

  function toggle() {
    const next = toggleArenaMuted();
    muted = next;
    if (!next) {
      try {
        arenaConfirm();
      } catch {}
    }
  }
</script>

<button
  type="button"
  onclick={toggle}
  aria-pressed={!muted}
  title={muted ? 'Unmute arena sound' : 'Mute arena sound'}
  class="inline-flex items-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest uppercase text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring {className}"
>
  {#if muted}
    <VolumeX class="h-3.5 w-3.5" aria-hidden="true" />
    <span>Muted</span>
  {:else}
    <Volume2 class="h-3.5 w-3.5" aria-hidden="true" />
    <span>Sound on</span>
  {/if}
</button>
