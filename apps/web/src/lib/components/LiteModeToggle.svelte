<script lang="ts">
  import { onMount } from 'svelte';
  import { Zap } from '@lucide/svelte';
  import {
    LITE_TOGGLE_EVENT,
    isLiteMode,
    readLiteModePreference,
    setLiteModePreference,
    type LiteModePreference,
  } from '$lib/device-capabilities';

  let { className = '' }: { className?: string } = $props();
  let active = $state(false);

  function sync() {
    try {
      active = isLiteMode();
    } catch {
      active = false;
    }
  }

  onMount(() => {
    sync();
    const onChange = () => sync();
    window.addEventListener(LITE_TOGGLE_EVENT, onChange);
    return () => window.removeEventListener(LITE_TOGGLE_EVENT, onChange);
  });

  function toggle() {
    const next: LiteModePreference = active ? 'off' : 'on';
    setLiteModePreference(next);
    active = next === 'on';
  }

  const label = $derived(active ? 'Lite mode on' : 'Lite mode off');
</script>

<button
  type="button"
  onclick={toggle}
  aria-pressed={active}
  aria-label={`${label}. Toggles reduced effects for lower-end devices.`}
  title={`${label} — reduces animations, blur and shadows`}
  class="inline-flex min-w-10 items-center justify-center gap-1.5 rounded-full border border-line-soft bg-card px-3 py-1.5 font-mono text-[11px] font-bold tracking-widest uppercase outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:min-w-[6.5rem] {active
    ? 'text-accent'
    : 'text-muted-foreground'} {className}"
>
  <Zap class="h-3.5 w-3.5" aria-hidden="true" />
  <span class="hidden sm:inline">{active ? 'Lite on' : 'Lite off'}</span>
</button>
