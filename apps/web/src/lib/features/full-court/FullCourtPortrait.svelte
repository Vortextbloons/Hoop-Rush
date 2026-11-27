<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerFace from '#lib/components/PlayerFace.svelte';
  import { initialsOf } from '#lib/branding.js';
  import {
    loadFullCourtArt,
    type FullCourtArt,
    type FullCourtArtPlayer,
  } from './full-court-art.ts';

  type PortraitSize = 'sm' | 'md' | 'court' | 'xl';

  let {
    player,
    art = null,
    size = 'md',
    eager = false,
  }: {
    player: FullCourtArtPlayer;
    art?: FullCourtArt | null;
    size?: PortraitSize;
    eager?: boolean;
  } = $props();

  let loadedArt = $state.raw<FullCourtArt | null>(null);
  const resolvedArt = $derived(art ?? loadedArt);
  const face = $derived(resolvedArt?.faceFor(player) ?? null);
  const initials = $derived(initialsOf(player.displayName));
  const fallbackClass = $derived(
    size === 'sm'
      ? 'h-9 w-9 rounded-md text-xs'
      : size === 'court'
        ? 'h-12 w-12 rounded-full text-xs lg:h-14 lg:w-14 lg:text-sm'
        : size === 'xl'
          ? 'h-20 w-20 rounded-2xl text-xl md:h-24 md:w-24'
          : 'h-12 w-12 rounded-lg text-sm',
  );

  onMount(() => {
    if (art !== null) return;
    let mounted = true;
    void loadFullCourtArt()
      .then((loaded) => {
        if (mounted) loadedArt = loaded;
      })
      .catch(() => {
        // Portraits are optional; the initials fallback stays visible.
      });
    return () => {
      mounted = false;
    };
  });
</script>

{#if face !== null && resolvedArt !== null}
  <PlayerFace
    player={face}
    manifest={resolvedArt.manifest}
    {size}
    {eager}
    fallbackInitials={initials}
  />
{:else}
  <div class="relative shrink-0 overflow-hidden bg-surface-3 {fallbackClass}" aria-hidden="true">
    <span
      class="absolute inset-0 grid place-items-center font-display font-extrabold text-muted-foreground"
    >
      {initials}
    </span>
  </div>
{/if}
