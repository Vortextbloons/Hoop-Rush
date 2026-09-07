<script lang="ts">
  import { sponsorBrandTileOf } from '$lib/season/sponsor-brand-meta';
  let {
    family,
    displayName,
    logoUrl = null,
    size = 'md',
    accentColor = null,
  }: {
    family: string;
    displayName: string;
    logoUrl?: string | null;
    size?: 'sm' | 'md' | 'lg';
    accentColor?: string | null;
  } = $props();
  const initials = $derived(
    displayName
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length > 0)
      .slice(0, 2)
      .map((word) => (word[0] ?? '').toUpperCase())
      .join('') || '?',
  );
  let failed = $state(false);
  const dims = $derived(
    size === 'sm' ? 'h-9 w-9 text-sm' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-12 w-12 text-base',
  );
  const ring = $derived(accentColor === null ? '' : `box-shadow: inset 0 0 0 2px ${accentColor};`);
  const tileBg = $derived(sponsorBrandTileOf(family) === 'dark' ? 'bg-[#141a24]' : 'bg-[#e9edf3]');
</script>

<span
  class={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 ${dims}`}
  aria-hidden="true"
  style={ring}
>
  <span class="font-display font-extrabold text-muted-foreground">{initials}</span>
  {#if logoUrl !== null && !failed}
    <img
      src={logoUrl}
      alt=""
      loading="lazy"
      onerror={() => {
        failed = true;
      }}
      style={ring}
      class={`absolute inset-0 h-full w-full object-contain p-1 ring-1 ring-inset ring-black/20 ${tileBg}`}
    />
  {/if}
  <span class="sr-only">{displayName} ({family})</span>
</span>
