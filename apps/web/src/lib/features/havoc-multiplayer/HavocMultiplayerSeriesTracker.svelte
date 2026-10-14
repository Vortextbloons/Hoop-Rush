<script lang="ts">
  import type {
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import GamecastSeriesTracker from '$lib/features/multiplayer/gamecast/GamecastSeriesTracker.svelte';
  import { havocMultiplayerGamecastSeries } from './havoc-multiplayer-room-view';

  let {
    series,
    localParticipantId,
  }: {
    series: HavocMultiplayerSeriesSnapshot;
    localParticipantId: HavocMultiplayerParticipantId;
  } = $props();

  const mapped = $derived(havocMultiplayerGamecastSeries(series));
</script>

{#if mapped}
  <GamecastSeriesTracker series={mapped} {localParticipantId} homeFormat="best-of-2-2-1-1-1" />
{/if}
