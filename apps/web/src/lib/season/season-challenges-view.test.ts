import { describe, expect, it } from 'vitest';
import type { SeasonRun } from '@hoop-rush/data-contracts';
import { challengesViewModel } from './season-challenges-view';

function runWith(challenges: unknown): SeasonRun {
  return { challenges } as unknown as SeasonRun;
}

const DEAL = {
  blockIndex: 0,
  challengeIds: ['protect-glass', 'take-care', 'winning-block'],
  seedDigest: '0'.repeat(32),
  contextDigest: '1'.repeat(32),
  targets: {
    gamesInBlock: 10,
    leaderFranchiseId: null,
    qualifyingOpponentIds: [],
    threePointAttemptFloor: 20,
  },
};

const FACTS = {
  games: 10,
  wins: 6,
  threePointersMade: 30,
  threePointersAttempted: 80,
  threePointPct: 0.375,
  reboundMargin: 4,
  turnovers: 120,
  turnoversPerGame: 12,
  beatLeader: null,
  beatHigher: null,
  sweptBlock: false,
};

describe('challenges view model', () => {
  it('returns null without a run or without challenge state', () => {
    expect(challengesViewModel(null, 0)).toBeNull();
    expect(challengesViewModel(runWith(undefined), 0)).toBeNull();
  });

  it('shows a dealt block as live before evaluation', () => {
    const vm = challengesViewModel(runWith({ deals: { 0: DEAL }, evaluations: [] }), 0);
    expect(vm?.blockIndex).toBe(0);
    expect(vm?.deal?.challengeIds).toEqual(['protect-glass', 'take-care', 'winning-block']);
    expect(vm?.evaluation).toBeNull();
  });

  it('shows completed and missed states after evaluation', () => {
    const vm = challengesViewModel(
      runWith({
        deals: { 0: DEAL },
        evaluations: [
          {
            blockIndex: 0,
            results: [
              { challengeId: 'protect-glass', blockIndex: 0, success: true, facts: FACTS },
              { challengeId: 'take-care', blockIndex: 0, success: false, facts: FACTS },
              { challengeId: 'winning-block', blockIndex: 0, success: true, facts: FACTS },
            ],
          },
        ],
      }),
      0,
    );
    expect(vm?.evaluation?.results.filter((result) => result.success)).toHaveLength(2);
    expect(vm?.evaluation?.results.filter((result) => !result.success)).toHaveLength(1);
  });

  it('reports no challenges for the final block', () => {
    const vm = challengesViewModel(runWith({ deals: {}, evaluations: [] }), 8);
    expect(vm?.blockIndex).toBeNull();
    expect(vm?.deal).toBeNull();
  });
});
