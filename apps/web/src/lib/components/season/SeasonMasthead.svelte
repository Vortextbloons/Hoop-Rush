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

<header class="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
  <div class="flex min-w-0 items-center gap-4">
    {#if manifest !== null}
      <SeasonTeamLogo {manifest} {franchiseId} {teamExternalId} size="lg" eager alt={displayName} />
    {/if}
    <div class="min-w-0">
      <p class="sr-eyebrow">Season Run</p>
      <h1 class="sr-page-title mt-1 max-w-full break-words">
        {displayName}
      </h1>
    </div>
  </div>
  <div
    class="flex items-end gap-4 border-border/70 sm:ml-auto sm:border-l sm:pl-5"
    aria-label={`Record ${recordLabel}; ${positionLabel}`}
  >
    <div class="text-right">
      <p class="sr-eyebrow text-right">Record</p>
      <p
        class="sr-number mt-0.5 text-4xl leading-none font-extrabold text-paper sm:text-5xl"
        style="color: var(--sr-paper)"
      >
        {recordLabel}
      </p>
    </div>
    <span class="sr-badge" data-tone="hardwood">{positionLabel}</span>
  </div>
</header>
