<script lang="ts">
  let {
    family,
    displayName,
    logoUrl = null,
    size = 'md',
  }: {
    family: string;
    displayName: string;
    logoUrl?: string | null;
    size?: 'sm' | 'md';
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
  const dims = $derived(size === 'sm' ? 'h-9 w-9 text-sm' : 'h-12 w-12 text-base');
</script>

<span
  class={`relative grid shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-3 ${dims}`}
  aria-hidden="true"
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
      class="absolute inset-0 h-full w-full bg-surface-1 object-contain p-1"
    />
  {/if}
  <span class="sr-only">{displayName} ({family})</span>
</span>
