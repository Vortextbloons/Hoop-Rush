<script lang="ts">
  import PauseSimulationButton from './PauseSimulationButton.svelte';
  import SimulationProgress from './SimulationProgress.svelte';

  let {
    label,
    progress,
    stopping,
    onStop,
    class: className = '',
  }: {
    label: string;
    progress: { readonly completed: number; readonly total: number } | null;
    stopping: boolean;
    onStop?: () => void;
    class?: string;
  } = $props();
</script>

<div class={className}>
  <div class="flex flex-wrap items-center gap-2">
    {#if onStop}
      <PauseSimulationButton {stopping} {onStop} />
    {/if}
    <p class="text-[11px] text-muted-foreground" role="status">
      {#if stopping}
        Saving the current game
      {:else if progress && progress.total > 1}
        Simulating {progress.completed} of {progress.total} games
      {:else}
        Simulating
      {/if}
    </p>
  </div>
  <SimulationProgress class="mt-3" {label} {progress} />
</div>
