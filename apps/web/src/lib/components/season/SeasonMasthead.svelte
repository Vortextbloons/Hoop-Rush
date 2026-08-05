<script lang="ts">
  import type { HoopRushManifest } from '@hoop-rush/data-contracts';
  import { franchiseIdentityOf } from '$lib/season/season-branding';
  import SeasonTeamLogo from '$lib/components/season/SeasonTeamLogo.svelte';

  /**
   * Season Run masthead (M2.3.5): the human franchise's modern identity,
   * record, and provisional conference position. Rendered by the run shell
   * layout above the tab rail; pages must not re-render it.
   */

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

<header class="flex flex-wrap items-center gap-4">
  {#if manifest !== null}
    <SeasonTeamLogo {manifest} {franchiseId} {teamExternalId} size="lg" eager alt={displayName} />
  {/if}
  <div class="min-w-0">
    <p class="font-mono text-xs tracking-[0.16em] text-primary uppercase">Season Run</p>
    <h1 class="font-display mt-1 text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
      {displayName}
    </h1>
  </div>
  <div
    class="ml-auto flex shrink-0 items-baseline gap-3 font-mono text-xs text-muted-foreground"
    aria-label={`Record ${recordLabel}; ${positionLabel}`}
  >
    <span class="text-2xl font-extrabold tracking-tight text-foreground">{recordLabel}</span>
    <span>{positionLabel}</span>
  </div>
</header>
