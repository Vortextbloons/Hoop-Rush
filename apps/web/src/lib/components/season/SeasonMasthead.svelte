<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';
  let {
    manifest,
    franchiseId,
    recordLabel,
    positionLabel,
  }: {
    manifest: HoopRushManifest | null;
    franchiseId: string;
    recordLabel: string;
    positionLabel: string;
  } = $props();
  const identity = $derived(manifest === null ? null : franchiseIdentityOf(manifest, franchiseId));
  const displayName = $derived(identity?.displayName ?? franchiseId);
  const teamExternalId = $derived(identity?.teamExternalId ?? '');
</script>

<header class="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
  <div class="flex min-w-0 items-center gap-3">
    {#if manifest !== null}
      <SeasonTeamLogo {manifest} {franchiseId} {teamExternalId} size="lg" eager alt={displayName} />
    {/if}
    <div class="min-w-0">
      <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run</p>
      <h1
        class="font-display mt-1 text-2xl font-extrabold tracking-tight break-words uppercase sm:text-3xl md:text-4xl"
      >
        {displayName}
      </h1>
    </div>
  </div>
  <div
    class="flex items-baseline gap-3 font-mono text-xs text-muted-foreground sm:ml-auto"
    aria-label={`Record ${recordLabel}; ${positionLabel}`}
  >
    <span class="text-2xl font-extrabold tracking-tight text-foreground">{recordLabel}</span>
    <span class="min-w-0">{positionLabel}</span>
  </div>
</header>
