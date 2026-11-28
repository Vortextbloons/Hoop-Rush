import { expect, test } from 'bun:test';
import {
  FULL_COURT_DEFAULT_COACHING_PLAN,
  type FullCourtPlayoffAdaptation,
  type FullCourtSeasonCheckpoint,
  type FullCourtSeasonScore,
} from '@hoop-rush/data-contracts';
import type { FullCourtSeasonLock, FullCourtSeasonSlotOutcome } from '@hoop-rush/engine';
import {
  fullCourtNextReviewSlot,
  fullCourtNextUserFixture,
  fullCourtPlayoffAdjustmentChanged,
  fullCourtRegularSeasonInjuryStop,
  fullCourtSlotOptions,
  fullCourtUserSeries,
  type FullCourtPinnedGamePlan,
} from './progression.ts';

function lock(): FullCourtSeasonLock {
  return {
    digest: 'a'.repeat(32),
    season: {
      runId: 'run',
      runSeed: 'a'.repeat(32),
      userTeamId: 'user',
      teams: [
        { teamId: 'user', displayName: 'User' },
        { teamId: 'opponent', displayName: 'Opponent' },
      ],
      games: [
        {
          gameId: 'game-1',
          slot: 1,
          dayOffset: 3,
          homeTeamId: 'user',
          awayTeamId: 'opponent',
        },
        {
          gameId: 'game-2',
          slot: 2,
          dayOffset: 5,
          homeTeamId: 'opponent',
          awayTeamId: 'user',
        },
      ],
    },
  } as unknown as FullCourtSeasonLock;
}

function checkpoint(completedThroughSlot: number): FullCourtSeasonCheckpoint {
  return {
    schemaVersion: 1,
    runId: 'run',
    lockDigest: 'a'.repeat(32),
    completedThroughSlot,
    healthByTeam: {},
  } as FullCourtSeasonCheckpoint;
}

function simulatedStep(injuries: readonly unknown[], completedThroughSlot = 1) {
  return {
    kind: 'simulated',
    checkpoint: checkpoint(completedThroughSlot),
    scores: [] as readonly FullCourtSeasonScore[],
    userGame: { kind: 'played', injuries },
  } as unknown as Extract<FullCourtSeasonSlotOutcome, { kind: 'simulated' }>;
}

function pinned(overrides: Partial<FullCourtPinnedGamePlan> = {}): FullCourtPinnedGamePlan {
  return {
    restGameId: null,
    restingPlayerIds: [],
    matchupGameId: null,
    matchupOpponentId: null,
    matchupAssignments: [],
    ...overrides,
  };
}

test('reads the next review slot and stops after the last review', () => {
  expect(fullCourtNextReviewSlot(0)).toBe(20);
  expect(fullCourtNextReviewSlot(19)).toBe(20);
  expect(fullCourtNextReviewSlot(20)).toBe(41);
  expect(fullCourtNextReviewSlot(61)).toBe(82);
  expect(fullCourtNextReviewSlot(82)).toBeNull();
});

test('labels the next regular-season and unavailable fixtures', () => {
  const base = lock();
  expect(fullCourtNextUserFixture(base, checkpoint(0), null)).toMatchObject({
    gameId: 'game-1',
    phase: 'regular',
    dayOffset: 3,
    userSide: 'home',
  });
  expect(fullCourtNextUserFixture(base, checkpoint(1), null)).toMatchObject({
    gameId: 'game-2',
    dayOffset: 5,
    userSide: 'away',
  });
  expect(fullCourtNextUserFixture(base, checkpoint(82), null)).toBeNull();
});

test('only reports injuries that affect the next fixture', () => {
  const base = lock();
  const actionable = fullCourtRegularSeasonInjuryStop(
    simulatedStep([
      { teamId: 'user', playerId: 'out-now', availableFromDay: 6 },
      { teamId: 'opponent', playerId: 'other-team', availableFromDay: 9 },
    ]),
    base,
  );
  expect(actionable).toEqual({
    kind: 'injury',
    slot: 1,
    playerIds: ['out-now'],
    availableFromDay: 6,
  });

  expect(
    fullCourtRegularSeasonInjuryStop(
      simulatedStep([{ teamId: 'user', playerId: 'back-soon', availableFromDay: 5 }]),
      base,
    ),
  ).toBeNull();
  expect(fullCourtRegularSeasonInjuryStop(simulatedStep([]), base)).toBeNull();
});

test('applies rest and matchup pins only to the captured game', () => {
  const plan = pinned({
    restGameId: 'game-1',
    restingPlayerIds: ['player-1'],
    matchupGameId: 'game-1',
    matchupOpponentId: 'opponent',
    matchupAssignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'player-2' }],
  });

  const matching = fullCourtSlotOptions({
    coaching: FULL_COURT_DEFAULT_COACHING_PLAN,
    pinned: plan,
    userGameId: 'game-1',
    acceptForfeit: true,
    record: true,
  });
  expect(matching.restingPlayerIds).toEqual(['player-1']);
  expect(matching.defensiveMatchups).toEqual({
    gameId: 'game-1',
    opponentTeamId: 'opponent',
    assignments: [{ opponentPlayerId: 'opp-1', defenderPlayerId: 'player-2' }],
  });
  expect(matching.acceptForfeit).toBe(true);
  expect(matching.record).toBe(true);

  const different = fullCourtSlotOptions({
    coaching: FULL_COURT_DEFAULT_COACHING_PLAN,
    pinned: plan,
    userGameId: 'game-2',
    acceptForfeit: false,
    record: false,
  });
  expect(different.restingPlayerIds).toBeUndefined();
  expect(different.defensiveMatchups).toBeUndefined();
});

test('finds the latest user series and detects defense changes', () => {
  const series = [
    { seriesId: 's1', highTeamId: 'user', lowTeamId: 'a' },
    { seriesId: 's2', highTeamId: 'b', lowTeamId: 'c' },
    { seriesId: 's3', highTeamId: 'd', lowTeamId: 'user' },
  ];
  expect(fullCourtUserSeries(series as never, 'user')?.seriesId).toBe('s3');

  const pressure: FullCourtPlayoffAdaptation = {
    defense: 'pressure',
    reason: 'persistent-inside-scoring',
    observedShareBps: 5_000,
    thresholdShareBps: 4_500,
    sampleGames: 3,
    windowGames: 5,
  };
  const paint: FullCourtPlayoffAdaptation = { ...pressure, defense: 'protect-paint' };
  expect(fullCourtPlayoffAdjustmentChanged(undefined, pressure)).toBe(true);
  expect(fullCourtPlayoffAdjustmentChanged(pressure, pressure)).toBe(false);
  expect(fullCourtPlayoffAdjustmentChanged(pressure, paint)).toBe(true);
  expect(fullCourtPlayoffAdjustmentChanged(pressure, undefined)).toBe(false);
});
