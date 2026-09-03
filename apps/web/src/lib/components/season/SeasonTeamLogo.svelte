<script lang="ts">
  import { resolveLogoUrlsWithHistorical, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';
  import { useImageFallback } from '$lib/use-image-fallback.svelte';
  let {
    manifest,
    franchiseId,
    teamExternalId,
    logoCandidates = [],
    alt = '',
    size = 'md',
    eager = false,
  }: {
    manifest: HoopRushManifest;
    franchiseId: string;
    teamExternalId: string;
    logoCandidates?: readonly string[];
    alt?: string;
    size?: 'sm' | 'md' | 'lg';
    eager?: boolean;
  } = $props();
  const abbreviation = $derived(franchiseAbbreviation(franchiseId));
  const urls = $derived(
    resolveLogoUrlsWithHistorical(manifest, franchiseId, teamExternalId, [...logoCandidates]),
  );
  const fallback = useImageFallback({
    urls: () => urls,
    key: () => `${franchiseId}:${teamExternalId}:${logoCandidates.join('|')}`,
  });
  const boxClass = $derived(
    size === 'lg'
      ? 'h-16 w-16 rounded-2xl md:h-20 md:w-20'
      : size === 'md'
        ? 'h-10 w-10 rounded-xl'
        : 'h-7 w-7 rounded-lg',
  );
  const imgClass = $derived(size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-base' : 'text-xs');
</script>

<span
  class="inline-flex shrink-0 items-center justify-center overflow-hidden text-muted-foreground {boxClass}"
  role={alt === '' ? undefined : 'img'}
  aria-label={alt === '' ? undefined : alt}
  aria-hidden={alt === '' ? 'true' : undefined}
>
  {#if fallback.src && !fallback.failed}
    <img
      src={fallback.src}
      alt=""
      width={size === 'lg' ? 80 : size === 'md' ? 40 : 28}
      height={size === 'lg' ? 80 : size === 'md' ? 40 : 28}
      class="h-full w-full object-contain {imgClass}"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={fallback.onError}
    />
  {:else}
    <span class="grid h-full w-full place-items-center font-display font-extrabold">
      {abbreviation}
    </span>
  {/if}
</span>
