<script lang="ts">
  import type {
    DraftDuelCard,
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    DraftDuelSeriesSnapshot,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import GamecastRecap from '#lib/features/multiplayer/gamecast/GamecastRecap.svelte';
  import type {
    GamecastPlayer,
    GamecastVerification,
  } from '#lib/features/multiplayer/gamecast/gamecast-types.js';

  let {
    output,
    series,
    localParticipantId,
    verification,
    readyCountdownMs,
    localReady,
    onready,
    awaitingContinue,
    oncontinue,
    cards = {},
    manifest = null,
  }: {
    output: DraftDuelGameOutput;
    series: DraftDuelSeriesSnapshot;
    localParticipantId: DraftDuelParticipantId;
    verification: GamecastVerification;
    readyCountdownMs: number | null;
    localReady: boolean;
    onready: () => void;
    awaitingContinue: boolean;
    oncontinue: () => void;
    cards?: Record<string, DraftDuelCard>;
    manifest?: HoopRushManifest | null;
  } = $props();

  const players = $derived.by((): Record<string, GamecastPlayer> => {
    const mapped: Record<string, GamecastPlayer> = {};
    for (const card of Object.values(cards)) {
      mapped[card.playerId] = {
        playerId: card.playerId,
        displayName: card.displayName,
        seasonKey: card.seasonKey,
        franchiseId: card.franchiseId,
        playerExternalId: card.playerExternalId,
      };
    }
    return mapped;
  });
</script>

<GamecastRecap
  {output}
  {series}
  {localParticipantId}
  {verification}
  {readyCountdownMs}
  {localReady}
  {onready}
  {awaitingContinue}
  {oncontinue}
  {players}
  {manifest}
/>
