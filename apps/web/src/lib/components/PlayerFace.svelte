<script lang="ts">
  import {
    resolveHeadshotUrls,
    shouldStallTimeoutHeadshot,
    type HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import type { PeakPlayerSeason } from '@hoop-rush/data-contracts';

  type HeadshotPlayer = Pick<PeakPlayerSeason, 'playerId' | 'playerExternalId' | 'altIds'>;

  /** Seconds before a pending headshot request is treated as stalled. */
  const HEADSHOT_TIMEOUT_MS = 15000;

  let {
    player,
    manifest,
    size = 'md',
    eager = false,
    fallbackInitials,
  }: {
    player: HeadshotPlayer;
    manifest: HoopRushManifest;
    size?: 'sm' | 'md' | 'court';
    eager?: boolean;
    fallbackInitials: string;
  } = $props();

  const urls = $derived(resolveHeadshotUrls(manifest, player));
  let attempt = $state(0);
  let imgEl = $state<HTMLImageElement | null>(null);

  const candidateKey = $derived(`${player.playerId}\0${urls.join('\0')}`);
  let lastCandidateKey = '';
  $effect(() => {
    if (candidateKey !== lastCandidateKey) {
      lastCandidateKey = candidateKey;
      attempt = 0;
    }
  });

  const src = $derived(urls[attempt] ?? '');
  const showInitials = $derived(!src || attempt >= urls.length);
  const applyStallTimeout = $derived(shouldStallTimeoutHeadshot(src, urls, attempt, player));

  /**
   * A request that hangs (e.g. a reset connection that never errors) would
   * otherwise stall the fallback chain; advance past any src that has not
   * completed within the timeout. Confirmed NBA headshots are exempt when
   * the only remaining fallback is a wiki action photo.
   */
  $effect(() => {
    const current = src;
    // A lazy image may intentionally remain unrequested while offscreen.
    // Starting the stall clock here would exhaust valid candidates before
    // the browser ever tries them. Lazy requests still advance on `error`;
    // reserve the timeout recovery for eager, immediately requested faces.
    if (!eager || !current || !applyStallTimeout) return;
    const timer = setTimeout(() => {
      if (imgEl && !imgEl.complete && imgEl.naturalWidth === 0) {
        onError();
      }
    }, HEADSHOT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  });

  function onError() {
    if (attempt < urls.length - 1) {
      attempt += 1;
      return;
    }
    attempt = urls.length;
  }

  const faceClass = $derived(
    size === 'sm'
      ? 'h-9 w-9 rounded-md text-xs'
      : size === 'court'
        ? 'h-12 w-12 rounded-full text-xs lg:h-14 lg:w-14 lg:text-sm'
        : 'h-12 w-12 rounded-lg text-sm',
  );
</script>

<div class="relative shrink-0 overflow-hidden bg-surface-3 {faceClass}">
  {#if src && !showInitials}
    {#key src}
      <img
        {src}
        bind:this={imgEl}
        alt=""
        width={size === 'sm' ? 36 : 48}
        height={size === 'sm' ? 36 : 48}
        class="h-full w-full origin-top scale-[1.2] object-cover object-top"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        referrerpolicy="no-referrer"
        onerror={onError}
      />
    {/key}
  {/if}
  {#if showInitials}
    <span
      class="absolute inset-0 grid place-items-center font-display font-extrabold text-muted-foreground"
    >
      {fallbackInitials}
    </span>
  {/if}
</div>
