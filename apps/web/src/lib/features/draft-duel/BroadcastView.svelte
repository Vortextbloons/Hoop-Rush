<script lang="ts">
  import type {
    DraftDuelCard,
    DraftDuelGameOutput,
    DraftDuelParticipantId,
    HoopRushManifest,
  } from '@hoop-rush/data-contracts';
  import type { GamecastVisibleState } from '#lib/gamecast/gamecast-playback.js';
  import type { DraftDuelFeedLine } from '#lib/features/draft-duel/draft-duel-broadcast-view.js';
  import GamecastBroadcast from '#lib/gamecast/GamecastBroadcast.svelte';
  import type { GamecastPlayer } from '#lib/gamecast/gamecast-types.js';

  let {
    output,
    visible,
    progress,
    localParticipantId,
    feed,
    cards = {},
    manifest = null,
  }: {
    output: DraftDuelGameOutput;
    visible: GamecastVisibleState;
    progress: number;
    localParticipantId: DraftDuelParticipantId;
    feed: DraftDuelFeedLine[];
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

<GamecastBroadcast {output} {visible} {progress} {localParticipantId} {feed} {players} {manifest} />
