<script lang="ts">
  import { resolveLogoUrls, type HoopRushManifest } from '@hoop-rush/data-contracts';

  let {
    manifest,
    franchiseId,
    teamExternalId,
    alt = '',
    className = '',
  }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    teamExternalId: string;
    alt?: string;
    className?: string;
  } = $props();

  const urls = $derived(resolveLogoUrls(manifest, franchiseId, teamExternalId));
  let attempt = $state(0);

  let lastKey = '';
  $effect(() => {
    const key = `${franchiseId}:${teamExternalId}`;
    if (key !== lastKey) {
      lastKey = key;
      attempt = 0;
    }
  });

  const src = $derived(urls[attempt] ?? '');

  function onError() {
    if (attempt < urls.length - 1) {
      attempt += 1;
      return;
    }
    attempt = urls.length;
  }
</script>

{#if src}
  {#key src}
    <img
      {src}
      {alt}
      width="20"
      height="20"
      class="h-5 w-5 shrink-0 object-contain {className}"
      loading="lazy"
      crossorigin="anonymous"
      referrerpolicy="no-referrer"
      onerror={onError}
    />
  {/key}
{/if}
