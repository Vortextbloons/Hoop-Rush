<script lang="ts">
  import { resolveLogoUrlsWithHistorical, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseAbbreviation } from '@hoop-rush/data-contracts';

  /**
   * Seasonal wrapper around the shared TeamLogo: uniform sizing, reserved
   * dimensions (no layout shift), lazy loading for offscreen marks, and a
   * franchise-abbreviation fallback when every logo candidate fails. The
   * human masthead is always rendered eagerly (`eager`).
   */

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
    /** Verified historical logo candidates (era-scoped); tried before the modern chain. */
    logoCandidates?: readonly string[];
    alt?: string;
    size?: 'sm' | 'md' | 'lg';
    eager?: boolean;
  } = $props();

  const abbreviation = $derived(franchiseAbbreviation(franchiseId));

  const urls = $derived(
    resolveLogoUrlsWithHistorical(manifest, franchiseId, teamExternalId, [...logoCandidates]),
  );
  let attempt = $state(0);

  let lastKey = '';
  $effect(() => {
    const key = `${franchiseId}:${teamExternalId}:${logoCandidates.join('|')}`;
    if (key !== lastKey) {
      lastKey = key;
      attempt = 0;
    }
  });

  const src = $derived(urls[attempt] ?? '');
  const failed = $derived(attempt >= urls.length);

  function onError() {
    if (attempt < urls.length - 1) {
      attempt += 1;
      return;
    }
    attempt = urls.length;
  }

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
  class="inline-flex shrink-0 items-center justify-center overflow-hidden bg-surface-2 text-muted-foreground {boxClass}"
  role={alt === '' ? undefined : 'img'}
  aria-label={alt === '' ? undefined : alt}
  aria-hidden={alt === '' ? 'true' : undefined}
>
  {#if src && !failed}
    <img
      {src}
      alt=""
      width={size === 'lg' ? 80 : size === 'md' ? 40 : 28}
      height={size === 'lg' ? 80 : size === 'md' ? 40 : 28}
      class="h-full w-full object-contain {imgClass}"
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={onError}
    />
  {:else}
    <span class="grid h-full w-full place-items-center font-display font-extrabold">
      {abbreviation}
    </span>
  {/if}
</span>
