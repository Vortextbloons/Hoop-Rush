import type {
  HavocBattleResult,
  HavocMultiplayerParticipantId,
  HavocMultiplayerSeriesGame,
} from '@hoop-rush/data-contracts';
import {
  havocMultiplayerFinalBoxes,
  type HavocMultiplayerParticipantLine,
  type HavocMultiplayerSideBox,
} from './havoc-multiplayer-playback-view';

type SeriesResult = Pick<HavocBattleResult, 'home' | 'away' | 'rollups'>;
type Ability = HavocBattleResult['rollups'][number];

export function havocMultiplayerSeriesStats(
  series: {
    games: readonly Pick<
      HavocMultiplayerSeriesGame,
      'gameNumber' | 'status' | 'homeParticipantId'
    >[];
  },
  outputs: Readonly<Record<number, { result: SeriesResult }>>,
  localParticipantId: HavocMultiplayerParticipantId,
) {
  const boxes: HavocMultiplayerSideBox[] = (['home', 'away'] as const).map((side) => ({
    side,
    displayName: side === 'home' ? 'You' : 'Opponent',
    score: 0,
    bonusPoints: 0,
    lines: [],
  }));
  const players = new Map<string, HavocMultiplayerParticipantLine>();
  const abilities = new Map<
    string,
    {
      key: string;
      side: 'home' | 'away';
      displayName: string;
      mutationId: Ability['mutationId'];
      triggers: number;
      pointsDelta: number;
      freeThrowsGranted: number;
      turnoversCancelled: number;
      extraPossessionsEarned: number;
      extraPossessionsUsed: number;
      activeSeconds: number;
      ratingChanges: number;
    }
  >();
  let games = 0;
  for (const game of series.games) {
    const output = outputs[game.gameNumber];
    if (game.status !== 'verified' || !output) continue;
    games += 1;
    const localSide = game.homeParticipantId === localParticipantId ? 'home' : 'away';
    for (const box of havocMultiplayerFinalBoxes(output.result)) {
      const side = box.side === localSide ? 'home' : 'away';
      const target = boxes.find((entry) => entry.side === side);
      if (!target) continue;
      target.score += box.score;
      target.bonusPoints += box.bonusPoints;
      for (const line of box.lines) {
        const key = `${side}:${line.kind}:${line.slot}:${line.sourcePlayerId ?? line.instanceId}`;
        const existing = players.get(key);
        if (!existing) {
          const combined = { ...line, instanceId: key };
          players.set(key, combined);
          target.lines.push(combined);
        } else {
          for (const stat of [
            'points',
            'adjustments',
            'fieldGoalsMade',
            'fieldGoalsAttempted',
            'freeThrowsMade',
            'freeThrowsAttempted',
            'rebounds',
            'assists',
            'steals',
            'blocks',
            'turnovers',
            'fouls',
          ] as const)
            existing[stat] += line[stat];
        }
      }
    }
    for (const rollup of output.result.rollups) {
      if (rollup.triggers === 0) continue;
      const owner = output.result[rollup.side].participants.find(
        (line) => line.instanceId === rollup.ownerInstanceId,
      );
      const side = rollup.side === localSide ? 'home' : 'away';
      const key = `${side}:${owner?.sourcePlayerId ?? rollup.ownerInstanceId}:${owner?.slot ?? ''}:${rollup.mutationId}`;
      let combined = abilities.get(key);
      if (!combined) {
        combined = {
          key,
          side,
          displayName: owner?.displayName ?? 'Unknown player',
          mutationId: rollup.mutationId,
          triggers: 0,
          pointsDelta: 0,
          freeThrowsGranted: 0,
          turnoversCancelled: 0,
          extraPossessionsEarned: 0,
          extraPossessionsUsed: 0,
          activeSeconds: 0,
          ratingChanges: 0,
        };
        abilities.set(key, combined);
      }
      for (const stat of [
        'triggers',
        'pointsDelta',
        'freeThrowsGranted',
        'turnoversCancelled',
        'extraPossessionsEarned',
        'extraPossessionsUsed',
        'activeSeconds',
        'ratingChanges',
      ] as const)
        combined[stat] += rollup[stat];
    }
  }
  return { boxes, games, abilities: [...abilities.values()] };
}
