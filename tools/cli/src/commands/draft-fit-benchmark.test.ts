import { playerIdSchema, type Position } from '@hoop-rush/data-contracts';
import { buildPlayerSeason } from '@hoop-rush/test-fixtures';
import { describe, expect, it } from 'vitest';
import { highestOverallLineup } from './draft-fit-benchmark.ts';

function player(id: string, position: Position, rating: number) {
  return buildPlayerSeason({
    playerId: playerIdSchema.parse(id),
    displayName: id,
    positions: {
      primary: position,
      secondary: [],
      playable: [position],
      sourceLabels: [position],
      normalizationVersion: 'position-v3',
    },
    summaryRatings: {
      overallRating: rating,
      offenseRating: rating,
      defenseRating: rating,
    },
  });
}

describe('draft-fit benchmark lineup baselines', () => {
  it('chooses the highest-Overall legal five instead of an illegal top five', () => {
    const lineup = highestOverallLineup([
      player('p-1', 'C', 100),
      player('p-2', 'C', 99),
      player('p-3', 'PG', 98),
      player('p-4', 'SG', 97),
      player('p-5', 'SF', 96),
      player('p-6', 'PF', 95),
    ]);

    expect(lineup?.map((entry) => entry.playerId)).toEqual(['p-3', 'p-4', 'p-5', 'p-6', 'p-1']);
  });
});
