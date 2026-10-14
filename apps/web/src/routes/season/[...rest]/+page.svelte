<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';

  const homeHref = resolve('/');

  onMount(() => {
    void goto(homeHref, { replaceState: true });
  });
</script>

<svelte:head>
  <meta http-equiv="refresh" content="0; url={homeHref}" />
</svelte:head>
