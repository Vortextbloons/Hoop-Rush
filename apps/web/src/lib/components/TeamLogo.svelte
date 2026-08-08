<script lang="ts">
  import { resolveLogoUrlsWithHistorical, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import { useImageFallback } from '$lib/use-image-fallback.svelte';

  let {
    manifest,
    franchiseId,
    teamExternalId,
    logoCandidates = [],
    alt = '',
    className = '',
  }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    teamExternalId: string;
    /** Verified historical logo candidates (era-scoped); tried before the modern chain. */
    logoCandidates?: string[];
    alt?: string;
    className?: string;
  } = $props();

  const urls = $derived(
    resolveLogoUrlsWithHistorical(manifest, franchiseId, teamExternalId, logoCandidates),
  );

  const fallback = useImageFallback({
    urls: () => urls,
    key: () => `${franchiseId}:${teamExternalId}:${logoCandidates.join('|')}`,
  });
</script>

<!-- Always reserve the sized box so missing/loading/failed logos cannot collapse
     flex/grid neighbors (important during the paced challenge reveal). -->
<span class="inline-flex shrink-0 items-center justify-center {className || 'h-5 w-5'}">
  {#if fallback.src}
    <img
      src={fallback.src}
      {alt}
      width="20"
      height="20"
      class="h-full w-full object-contain"
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={fallback.onError}
    />
  {/if}
</span>
