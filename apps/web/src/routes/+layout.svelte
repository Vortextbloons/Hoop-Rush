<script lang="ts">
  import '../app.css';
  import { ModeWatcher } from 'mode-watcher';
  import { Toaster } from 'svelte-sonner';

  let { children } = $props();
</script>

<svelte:head>
  <meta name="color-scheme" content="dark light" />
</svelte:head>

<ModeWatcher />

{@render children()}

<Toaster richColors closeButton theme="system" />
