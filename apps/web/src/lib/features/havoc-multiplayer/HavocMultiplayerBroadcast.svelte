<script lang="ts">
  import type {
    HavocMultiplayerParticipantId,
    HavocMultiplayerSeriesSnapshot,
  } from '@hoop-rush/data-contracts';
  import type { HavocMultiplayerGameOutput } from '@hoop-rush/persistence';
  import type {
    GamecastBattleAbilityLine,
    GamecastBattleFeedLine,
    GamecastBattleVisibleState,
  } from '#lib/gamecast/gamecast-battle-playback.js';
  import GamecastBattleBroadcast from '#lib/gamecast/GamecastBattleBroadcast.svelte';
  import { havocMultiplayerLocalSide } from './havoc-multiplayer-room-view';
  let {
    output,
    visible,
    feed,
    abilities = undefined,
    abilityCount = undefined,
    progress,
    localParticipantId,
    series,
    minimal = false,
  }: {
    output: HavocMultiplayerGameOutput;
    visible: GamecastBattleVisibleState;
    feed: readonly GamecastBattleFeedLine[];
    abilities?: readonly GamecastBattleAbilityLine[];
    abilityCount?: number;
    progress: number;
    localParticipantId: HavocMultiplayerParticipantId;
    series: HavocMultiplayerSeriesSnapshot | null;
    minimal?: boolean;
  } = $props();
  const localSide = $derived(
    havocMultiplayerLocalSide(series, output.gameNumber, localParticipantId),
  );
</script>

<GamecastBattleBroadcast
  result={output.result}
  gameNumber={output.gameNumber}
  {visible}
  {feed}
  {abilities}
  {abilityCount}
  {progress}
  {localSide}
  {minimal}
/>
