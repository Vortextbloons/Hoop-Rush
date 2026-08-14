<script lang="ts">
  import { resolveHeadshotUrls, type HoopRushManifest } from '@hoop-rush/data-contracts';
  import PlayerFace from '$lib/components/PlayerFace.svelte';
  import type { SeasonFaceRef } from '$lib/season/season-branding';

  let {
    face,
    manifest,
    size = 'md',
    eager = false,
  }: {
    face: SeasonFaceRef;
    manifest: HoopRushManifest;
    size?: 'sm' | 'md' | 'court';
    eager?: boolean;
  } = $props();

  const hasPrimaryId = $derived(face.playerExternalId.length > 0);
  const urls = $derived(hasPrimaryId ? resolveHeadshotUrls(manifest, face) : []);
</script>

{#if urls.length > 0}
  <PlayerFace {manifest} player={face} {size} {eager} fallbackInitials={face.initials} />
{:else}
  <div
    class="relative grid shrink-0 place-items-center overflow-hidden bg-surface-3 font-display font-extrabold text-muted-foreground {size ===
    'sm'
      ? 'h-9 w-9 rounded-md text-xs'
      : size === 'court'
        ? 'h-12 w-12 rounded-full text-xs lg:h-14 lg:w-14 lg:text-sm'
        : 'h-12 w-12 rounded-lg text-sm'}"
  >
    <span>{face.initials}</span>
  </div>
{/if}
