<script lang="ts">
  import type { Snippet } from 'svelte';
  import '$lib/components/havoc/havoc.css';
  let { children }: { children: Snippet } = $props();
</script>

<div class="havoc-world">{@render children()}</div>
