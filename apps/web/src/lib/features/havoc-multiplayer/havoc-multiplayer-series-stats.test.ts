import { describe, expect, it } from 'vitest';
import type { HavocBattleResult } from '@hoop-rush/data-contracts';
import { buildHavocGameResult } from '@hoop-rush/test-fixtures';
import { havocMultiplayerSeriesStats } from './havoc-multiplayer-series-stats';

describe('Havoc championship stats', () => {
  const first = buildHavocGameResult();
  const owner = first.home.participants[0];
  if (!owner) throw new Error('Missing fixture player');
  const rollup: HavocBattleResult['rollups'][number] = {
    ownerInstanceId: owner.instanceId,
    mutationId: 'possession-refund',
    side: 'home',
    triggers: 2,
    pointsDelta: -3,
    freeThrowsGranted: 0,
    turnoversCancelled: 2,
    extraPossessionsEarned: 0,
    extraPossessionsUsed: 0,
    extraPossessionsExpired: 0,
    swapPoints: 0,
    swapSeconds: 0,
    capSeconds: 0,
    activeSeconds: 0,
    ratingChanges: 0,
  };
  const result = { home: first.home, away: first.away, rollups: [rollup] };
  const games = [
    { gameNumber: 1, status: 'verified' as const, homeParticipantId: 'p1' as const },
    { gameNumber: 2, status: 'verified' as const, homeParticipantId: 'p2' as const },
  ];
  const outputs = {
    1: { result },
    2: {
      result: {
        home: { ...first.away, side: 'home' as const },
        away: { ...first.home, side: 'away' as const },
        rollups: [{ ...rollup, side: 'away' as const }],
      },
    },
  };

  it('keeps each participant together when home court changes and sums recorded effects', () => {
    const stats = havocMultiplayerSeriesStats({ games }, outputs, 'p1');
    expect(stats.games).toBe(2);
    expect(stats.boxes.map((box) => box.score)).toEqual([200, 180]);
    expect(stats.boxes[0]?.lines).toHaveLength(first.home.participants.length);
    expect(stats.abilities).toHaveLength(1);
    expect(stats.abilities[0]).toMatchObject({
      side: 'home',
      displayName: owner.displayName,
      triggers: 4,
      pointsDelta: -6,
      turnoversCancelled: 4,
    });
    expect(
      havocMultiplayerSeriesStats({ games }, outputs, 'p2').boxes.map((box) => box.score),
    ).toEqual([180, 200]);
    expect(first.home.points).toBe(100);
    expect(rollup.triggers).toBe(2);
  });

  it('excludes missing and unverified games instead of treating them as zero-stat games', () => {
    const stats = havocMultiplayerSeriesStats(
      { games: [...games, { gameNumber: 3, status: 'mismatch', homeParticipantId: 'p1' }] },
      { 1: outputs[1], 3: outputs[1] },
      'p1',
    );
    expect(stats.games).toBe(1);
    expect(stats.boxes[0]?.score).toBe(100);
    expect(stats.abilities[0]?.triggers).toBe(2);
    expect(havocMultiplayerSeriesStats({ games }, {}, 'p1').games).toBe(0);
  });

  it('computes shooting totals from attempts, preserving weighted percentages', () => {
    const participant = { ...owner, points: 4, fieldGoals: { made: 2, attempted: 10 } };
    const firstResult = { ...result, home: { ...first.home, participants: [participant] } };
    const secondResult = {
      ...result,
      home: {
        ...first.home,
        participants: [{ ...participant, fieldGoals: { made: 1, attempted: 1 } }],
      },
    };
    const stats = havocMultiplayerSeriesStats(
      {
        games: [
          { ...games[0], gameNumber: 1, status: 'verified', homeParticipantId: 'p1' },
          { gameNumber: 2, status: 'verified', homeParticipantId: 'p1' },
        ],
      },
      { 1: { result: firstResult }, 2: { result: secondResult } },
      'p1',
    );
    expect(stats.boxes[0]?.lines[0]).toMatchObject({
      fieldGoalsMade: 3,
      fieldGoalsAttempted: 11,
      points: 8,
    });
  });
});
