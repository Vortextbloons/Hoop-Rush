import { describe, expect, it } from 'vitest';
import {
  COLLECTION_COMMAND_VERSION,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_TEAM_VERSION,
  collectionActiveTeamSchema,
  collectionGameCommandSchema,
  collectionGameRejectionSchema,
  collectionGameResultSchema,
  collectionGameRulesSchema,
  collectionGameWorkerMessageSchema,
  collectionGameWorkerRequestSchema,
  collectionPlayStateSchema,
  collectionPreparedGameSchema,
  type CollectionActiveTeam,
} from './index.ts';

function cardId(n: number): string {
  return `card-${n.toString(16).padStart(32, '0')}`;
}

function validTeam(): CollectionActiveTeam {
  const starters = [cardId(1), cardId(2), cardId(3), cardId(4), cardId(5)];
  const bench = [cardId(6), cardId(7)];
  return collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters,
    bench,
    targetMinutes: [
      ...starters.map((cardIdEntry) => ({ cardId: cardIdEntry, minutes: 30 })),
      ...bench.map((cardIdEntry) => ({ cardId: cardIdEntry, minutes: 45 })),
    ],
  });
}

describe('collection active team', () => {
  it('accepts a valid 7-card team totaling 240 with starter minutes', () => {
    expect(validTeam().targetMinutes.reduce((sum, entry) => sum + entry.minutes, 0)).toBe(240);
  });

  it('rejects minute totals other than 240', () => {
    const team = validTeam();
    const bad = {
      ...team,
      targetMinutes: team.targetMinutes.map((entry) => ({ ...entry, minutes: 10 })),
    };
    expect(collectionActiveTeamSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a starter with zero minutes', () => {
    const team = validTeam();
    const bad = {
      ...team,
      targetMinutes: team.targetMinutes.map((entry, index) =>
        index === 0 ? { ...entry, minutes: 0 } : entry,
      ),
    };
    expect(collectionActiveTeamSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects duplicate cards and minutes for unrostered cards', () => {
    const team = validTeam();
    expect(
      collectionActiveTeamSchema.safeParse({ ...team, bench: [...team.bench, team.starters[0]] })
        .success,
    ).toBe(false);
    expect(
      collectionActiveTeamSchema.safeParse({
        ...team,
        targetMinutes: [...team.targetMinutes, { cardId: cardId(99), minutes: 0 }],
      }).success,
    ).toBe(false);
  });
});

describe('collection game commands and rejections', () => {
  it('round-trips every game command', () => {
    const base = {
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandVersion: COLLECTION_COMMAND_VERSION,
      commandId: 'cmd-1',
      collectionId: 'collection-1',
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
    };
    const team = validTeam();
    expect(
      collectionGameCommandSchema.parse({ ...base, command: 'set-active-team', team }),
    ).toMatchObject({ command: 'set-active-team' });
    expect(
      collectionGameCommandSchema.parse({ ...base, command: 'prepare-basic-game' }),
    ).toMatchObject({ command: 'prepare-basic-game' });
    expect(
      collectionGameCommandSchema.parse({
        ...base,
        command: 'abandon-basic-game',
        gameId: `game-${'1'.repeat(32)}`,
      }),
    ).toMatchObject({ command: 'abandon-basic-game' });
  });

  it('round-trips every rejection code', () => {
    const cases = [
      { code: 'collection-mismatch', expectedCollectionId: 'collection-1' },
      { code: 'duplicate-command', commandId: 'cmd-1' },
      {
        code: 'stale-state',
        expectedRevision: 0,
        expectedDigest: '0'.repeat(32),
        currentRevision: 1,
        currentDigest: '1'.repeat(32),
      },
      { code: 'conflicting-command-reuse', commandId: 'cmd-1' },
      { code: 'unowned-card', cardId: cardId(1) },
      { code: 'unknown-card', cardId: cardId(1) },
      { code: 'duplicate-card', cardId: cardId(1) },
      { code: 'duplicate-player', cardId: cardId(1), playerId: 'p1' },
      { code: 'illegal-starters', detail: 'nope' },
      { code: 'invalid-minutes', detail: 'nope' },
      { code: 'too-few-cards', count: 4 },
      { code: 'too-many-cards', count: 13 },
      { code: 'pending-game-conflict', gameId: 'game-x' },
      { code: 'no-pending-game' },
      { code: 'pending-game-mismatch', gameId: 'game-x' },
      { code: 'missing-content', detail: 'nope' },
      { code: 'incompatible-content', detail: 'nope' },
      { code: 'invalid-result', detail: 'nope' },
      { code: 'no-legal-five', detail: 'nope' },
      { code: 'arithmetic-overflow', detail: 'nope' },
    ];
    for (const rejection of cases) {
      expect(collectionGameRejectionSchema.parse(rejection)).toMatchObject({
        code: rejection.code,
      });
    }
  });
});

describe('collection prepared game and play state', () => {
  it('round-trips a prepared game with a null pending slot', () => {
    const team = validTeam();
    const prepared = collectionPreparedGameSchema.parse({
      gameVersion: COLLECTION_GAME_VERSION,
      teamVersion: COLLECTION_TEAM_VERSION,
      rewardVersion: COLLECTION_REWARD_VERSION,
      replayVersion: COLLECTION_GAME_REPLAY_VERSION,
      rulesVersion: COLLECTION_GAME_RULES_VERSION,
      collectionId: 'collection-1',
      gameId: `game-${'2'.repeat(32)}`,
      gameSequence: 0,
      rootSeed: '0'.repeat(32),
      seedPaths: { game: ['collection', 'games', '0'], cpuTeam: ['collection', 'cpu-teams', '0'] },
      seed: '1'.repeat(32),
      playerTeam: team,
      cpuTeam: team,
      environmentEraId: '2020s',
      profileVersion: 'm3-2020s-v1',
      profileHash: 'a'.repeat(64),
      catalogVersion: 'collection-catalog-v1',
      catalogHash: 'b'.repeat(64),
      rulesHash: 'c'.repeat(64),
      homeCourtPolicy: 'neutral-home-court',
      inputDigest: 'd'.repeat(32),
    });
    const state = collectionPlayStateSchema.parse({
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      teamVersion: COLLECTION_TEAM_VERSION,
      gameVersion: COLLECTION_GAME_VERSION,
      collectionId: 'collection-1',
      activeTeam: team,
      revision: 0,
      digest: 'e'.repeat(32),
      nextGameSequence: 1,
      pendingGame: prepared,
    });
    expect(state.pendingGame?.gameId).toBe(prepared.gameId);
    expect(collectionPlayStateSchema.parse({ ...state, pendingGame: null }).pendingGame).toBeNull();
  });
});

describe('collection game rules and worker wire', () => {
  it('pins the frozen v1 rules', () => {
    const rules = collectionGameRulesSchema.parse({
      rulesVersion: COLLECTION_GAME_RULES_VERSION,
      gameVersion: COLLECTION_GAME_VERSION,
      teamVersion: COLLECTION_TEAM_VERSION,
      rewardVersion: COLLECTION_REWARD_VERSION,
      replayVersion: COLLECTION_GAME_REPLAY_VERSION,
      cpuRosterSize: 12,
      eligibleScope: 'full-catalog',
      cpuRarityWeights: {
        Ember: 70,
        Eruption: 23,
        Apex: 5,
        Titan: 1.7,
        Eclipse: 0.29,
        Immortal: 0.01,
      },
      environmentEraId: '2020s',
      homeCourtPolicy: 'neutral-home-court',
      winRewardCoins: 100,
      lossRewardCoins: 10,
      engineVersion: 'm3-engine-v21',
      profileVersion: 'm3-2020s-v1',
    });
    expect(rules.cpuRosterSize).toBe(12);
  });

  it('validates worker request/result envelopes strictly', () => {
    const request = {
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-simulate',
      requestId: 'req-1',
      prepared: collectionPreparedGameSchema.parse({
        gameVersion: COLLECTION_GAME_VERSION,
        teamVersion: COLLECTION_TEAM_VERSION,
        rewardVersion: COLLECTION_REWARD_VERSION,
        replayVersion: COLLECTION_GAME_REPLAY_VERSION,
        rulesVersion: COLLECTION_GAME_RULES_VERSION,
        collectionId: 'collection-1',
        gameId: `game-${'3'.repeat(32)}`,
        gameSequence: 0,
        rootSeed: '0'.repeat(32),
        seedPaths: { game: ['a'], cpuTeam: ['b'] },
        seed: '1'.repeat(32),
        playerTeam: validTeam(),
        cpuTeam: validTeam(),
        environmentEraId: '2020s',
        profileVersion: 'm3-2020s-v1',
        profileHash: 'a'.repeat(64),
        catalogVersion: 'collection-catalog-v1',
        catalogHash: 'b'.repeat(64),
        rulesHash: 'c'.repeat(64),
        homeCourtPolicy: 'neutral-home-court',
        inputDigest: 'd'.repeat(32),
      }),
      catalogUrl: 'collection/catalog.json',
      catalogHash: 'b'.repeat(64),
      profileUrl: 'era-sim/2020s.json',
      profileHash: 'a'.repeat(64),
    };
    expect(collectionGameWorkerRequestSchema.parse(request).type).toBe('collection-game-simulate');
    expect(collectionGameWorkerRequestSchema.safeParse({ ...request, extraField: 1 }).success).toBe(
      false,
    );
    expect(
      collectionGameWorkerMessageSchema.safeParse({
        wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
        type: 'collection-game-error',
        requestId: 'req-1',
        gameId: null,
        code: 'internal',
        message: 'boom',
        seed: null,
      }).success,
    ).toBe(true);
    expect(collectionGameResultSchema.safeParse({ outcome: 'completed' }).success).toBe(false);
  });
});
