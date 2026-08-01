<script lang="ts">
  import { isNbaCdnHeadshotUrl, resolveHeadshotUrls, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import type { FranchiseEraPool } from '@hoop-rush/data-contracts';

  type PeakPlayer = FranchiseEraPool['players'][number];

  let {
    player,
    manifest,
    size = 'md',
    fallbackInitials,
  }: {
    player: PeakPlayer;
    manifest: HoopRushManifest;
    size?: 'sm' | 'md';
    fallbackInitials: string;
  } = $props();

  const urls = $derived(resolveHeadshotUrls(manifest, player));
  let attempt = $state(0);

  let lastPlayerId = '';
  $effect(() => {
    if (player.playerId !== lastPlayerId) {
      lastPlayerId = player.playerId;
      attempt = 0;
    }
  });

  const src = $derived(urls[attempt] ?? '');
  const showInitials = $derived(!src || attempt >= urls.length);
  const useAnonymousCors = $derived(src !== '' && !isNbaCdnHeadshotUrl(src));

  function onError() {
    if (attempt < urls.length - 1) {
      attempt += 1;
      return;
    }
    attempt = urls.length;
  }

  const faceClass = $derived(
    size === 'sm' ? 'h-9 w-9 rounded-md text-xs' : 'h-12 w-12 rounded-lg text-sm',
  );
</script>

<div class="relative shrink-0 overflow-hidden bg-surface-3 {faceClass}">
  {#if src && !showInitials}
    {#key src}
      <img
        {src}
        alt=""
        width={size === 'sm' ? 36 : 48}
        height={size === 'sm' ? 36 : 48}
        class="h-full w-full origin-top scale-[1.2] object-cover object-top"
        loading="lazy"
        crossorigin={useAnonymousCors ? 'anonymous' : undefined}
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
