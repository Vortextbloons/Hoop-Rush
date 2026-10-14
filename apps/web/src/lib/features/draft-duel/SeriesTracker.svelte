<script lang="ts">
  import type { DraftDuelParticipantId, DraftDuelSeriesSnapshot } from '@hoop-rush/data-contracts';
  import GamecastSeriesTracker from '$lib/features/multiplayer/gamecast/GamecastSeriesTracker.svelte';

  let {
    series,
    localParticipantId,
  }: {
    series: DraftDuelSeriesSnapshot;
    localParticipantId: DraftDuelParticipantId;
  } = $props();
</script>

<GamecastSeriesTracker {series} {localParticipantId} homeFormat="best-of-2-2-1-1-1" />
