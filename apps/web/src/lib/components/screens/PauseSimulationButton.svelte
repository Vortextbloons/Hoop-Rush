<script lang="ts">
  import { X } from '@lucide/svelte';

  let { stopping, onStop }: { stopping: boolean; onStop: () => void } = $props();
</script>

<button
  type="button"
  class="inline-flex min-h-11 items-center gap-2 rounded-xl border border-line-strong px-4 text-sm font-bold outline-none hover:border-negative hover:text-negative focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
  disabled={stopping}
  onclick={onStop}
>
  <X size={15} aria-hidden="true" />
  {stopping ? 'Pausing?' : 'Pause'}
</button>
