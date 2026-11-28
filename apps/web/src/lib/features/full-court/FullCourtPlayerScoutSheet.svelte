<script lang="ts">
  import type { FullCourtDraftState } from '@hoop-rush/data-contracts';
  import type { FullCourtCatalogIndex } from '@hoop-rush/engine';
  import PlayerProfileSheet from '#lib/components/PlayerProfileSheet.svelte';
  import type { ProfileTab } from '#lib/components/PlayerProfileSheet.svelte';
  import type { FullCourtArt } from './full-court-art.ts';
  import FullCourtScoutReport from './FullCourtScoutReport.svelte';
  import { fullCourtScoutProfile, fullCourtScoutingOwned } from './full-court-scout-profile.ts';

  let {
    draft,
    index,
    playerId,
    art = null,
    onOpenChange,
  }: {
    draft: FullCourtDraftState;
    index: FullCourtCatalogIndex;
    playerId: string | null;
    art?: FullCourtArt | null;
    onOpenChange: (open: boolean) => void;
  } = $props();

  let tab = $state<ProfileTab>('details');

  const pick = $derived(
    playerId === null
      ? null
      : (draft.picks.find((entry) => entry.player.playerId === playerId) ?? null),
  );
  const scoutingOwned = $derived(fullCourtScoutingOwned(draft));
  const scout = $derived.by(() => {
    if (pick === null) return null;
    return {
      ...fullCourtScoutProfile(index, pick.player, art?.manifest ?? null),
      face: art?.faceFor(pick.player) ?? null,
    };
  });
  const tabs = $derived<ProfileTab[]>([
    'details',
    'tendencies',
    'ratings',
    ...(scoutingOwned ? (['scouting'] as const) : []),
  ]);

  $effect(() => {
    if (playerId === null) tab = 'details';
  });
</script>

{#if scout !== null}
  <PlayerProfileSheet
    profile={scout.profile}
    face={scout.face}
    manifest={art?.manifest ?? null}
    {tabs}
    bind:tab
    open={playerId !== null}
    {onOpenChange}
  >
    {#snippet scouting()}
      <FullCourtScoutReport report={scout.report} />
    {/snippet}
  </PlayerProfileSheet>
{/if}
