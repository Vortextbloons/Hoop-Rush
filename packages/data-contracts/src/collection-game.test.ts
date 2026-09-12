import { describe, expect, it } from 'vitest';
import {
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_V1_REPLAY_VERSION,
  COLLECTION_GAME_V1_RULES_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_GAME_WORKER_WIRE_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_REWARD_V1_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_TEAM_VERSION,
  REQUIRED_RATING_KEYS,
  collectionActiveTeamSchema,
  collectionDifficultyProfileSchema,
  collectionGameCommandSchema,
  collectionGameRejectionSchema,
  collectionGameResultSchema,
  collectionGameRewardReceiptSchema,
  collectionGameRulesSchema,
  collectionGameWorkerMessageSchema,
  collectionGameWorkerRequestSchema,
  collectionPlayStateSchema,
  collectionPreparedGameSchema,
  collectionPreparedGameUnionSchema,
  type CollectionActiveTeam,
  type CollectionDifficultyProfile,
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

function cpuTeam(): CollectionActiveTeam {
  const starters = [cardId(11), cardId(12), cardId(13), cardId(14), cardId(15)];
  const bench = [
    cardId(16),
    cardId(17),
    cardId(18),
    cardId(19),
    cardId(20),
    cardId(21),
    cardId(22),
  ];
  return collectionActiveTeamSchema.parse({
    teamVersion: COLLECTION_TEAM_VERSION,
    starters,
    bench,
    targetMinutes: [
      ...starters.map((cardIdEntry) => ({ cardId: cardIdEntry, minutes: 27 })),
      ...bench.map((cardIdEntry) => ({ cardId: cardIdEntry, minutes: 15 })),
    ],
  });
}

function profile(difficultyId: 'street' | 'pro' | 'legend'): CollectionDifficultyProfile {
  const base = {
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    difficultyId,
    displayName: difficultyId,
    specialWeightMultiplierBp: 10_000,
    candidateTeams: 1,
    identityFitWeightBp: 0,
    useGeneratedStarters: true,
    ratingShift: 0,
    rewardMultiplierBp: 10_000,
    rotation: {
      starterWeightBp: 20_000,
      benchWeightBp: 10_000,
      overallBonusFloor: 0,
      overallBonusPerPointBp: 0,
      maxMinutes: 48,
      closingFivePolicy: 'generated-starters' as const,
    },
  };
  const overrides = {
    street: {
      rarityBand: { floor: 'Ember' as const, ceiling: 'Apex' as const },
      rarityWeightsBp: [
        { rarity: 'Ember' as const, weightBp: 7600 },
        { rarity: 'Eruption' as const, weightBp: 2200 },
        { rarity: 'Apex' as const, weightBp: 200 },
      ],
      ratingShift: -2,
    },
    pro: {
      rarityBand: { floor: 'Eruption' as const, ceiling: 'Titan' as const },
      rarityWeightsBp: [
        { rarity: 'Eruption' as const, weightBp: 5200 },
        { rarity: 'Apex' as const, weightBp: 3500 },
        { rarity: 'Titan' as const, weightBp: 1300 },
      ],
      candidateTeams: 4,
      useGeneratedStarters: false,
      rotation: {
        ...base.rotation,
        overallBonusFloor: 75,
        overallBonusPerPointBp: 400,
        maxMinutes: 42,
        closingFivePolicy: 'best-legal-five' as const,
      },
      rewardMultiplierBp: 13_500,
    },
    legend: {
      rarityBand: { floor: 'Apex' as const, ceiling: 'Immortal' as const },
      rarityWeightsBp: [
        { rarity: 'Apex' as const, weightBp: 4200 },
        { rarity: 'Titan' as const, weightBp: 4000 },
        { rarity: 'Eclipse' as const, weightBp: 1600 },
        { rarity: 'Immortal' as const, weightBp: 200 },
      ],
      candidateTeams: 8,
      identityFitWeightBp: 3000,
      useGeneratedStarters: false,
      ratingShift: 2,
      rotation: {
        ...base.rotation,
        starterWeightBp: 30_000,
        benchWeightBp: 5000,
        overallBonusFloor: 80,
        overallBonusPerPointBp: 500,
        maxMinutes: 44,
        closingFivePolicy: 'best-legal-five' as const,
      },
      rewardMultiplierBp: 17_500,
    },
  } as const;
  return collectionDifficultyProfileSchema.parse({ ...base, ...overrides[difficultyId] });
}

function adjustmentFacts(team: CollectionActiveTeam, delta: number) {
  if (delta === 0) return [];
  return [...team.starters, ...team.bench].map((cardIdEntry) => ({
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    mechanism: 'difficulty-rating-shift',
    side: 'away',
    cardId: cardIdEntry,
    requestedDelta: delta,
    ratings: REQUIRED_RATING_KEYS.map((rating) => ({
      rating,
      before: 60,
      after: Math.min(100, Math.max(0, 60 + delta)),
    })),
    boundedRatings: [] as string[],
  }));
}

function objectiveFacts(selectedObjectiveId: string | null) {
  const offers = [
    {
      objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
      objectiveId: 'obj-three-barrage-v1',
      title: 'Three barrage',
      condition: { kind: 'player-team-three-pointers-made' as const, threshold: 12 },
    },
    {
      objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
      objectiveId: 'obj-lock-score-v1',
      title: 'Lock the score',
      condition: { kind: 'cpu-team-points-at-most' as const, threshold: 105 },
    },
    {
      objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
      objectiveId: 'obj-ball-pressure-v1',
      title: 'Ball pressure',
      condition: { kind: 'cpu-team-turnovers-at-least' as const, threshold: 14 },
    },
  ];
  return {
    objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
    seedPath: ['collection', 'objectives', 'street', '0'],
    offers,
    selectedObjectiveId,
    feasibility: { rosterSize: 7, benchPlayerCount: 3, plannedBenchMinutes: 90 },
  };
}

function constructionFacts(team: CollectionActiveTeam) {
  return {
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    identity: 'balanced' as const,
    candidateCount: 1,
    chosenCandidateIndex: 0,
    candidates: [
      {
        candidateIndex: 0,
        score: {
          meanOverallMillionths: 60_000_000,
          fiveCoreMillionths: 60_000_000,
          identityFitMillionths: 58_000_000,
          lineupScoreMillionths: 60_000_000,
          topEightOverallMillionths: 60_000_000,
          rosterScoreMillionths: 60_000_000,
        },
      },
    ],
    rarityCounts: { Ember: 12, Eruption: 0, Apex: 0, Titan: 0, Eclipse: 0, Immortal: 0 },
    specialCount: 0,
    starters: [...team.starters],
    bench: [...team.bench],
    targetMinutes: team.targetMinutes.map((entry) => ({ ...entry })),
    closingFive: [...team.starters],
  };
}

function buildPreparedV2(
  difficultyId: 'street' | 'pro' | 'legend' = 'street',
  selectedObjectiveId: string | null = null,
) {
  const team = validTeam();
  const cpu = cpuTeam();
  const difficulty = profile(difficultyId);
  return {
    gameVersion: 'collection-game-v2',
    teamVersion: COLLECTION_TEAM_VERSION,
    rewardVersion: COLLECTION_REWARD_VERSION,
    replayVersion: COLLECTION_GAME_REPLAY_VERSION,
    rulesVersion: COLLECTION_GAME_RULES_VERSION,
    difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
    objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
    collectionId: 'collection-1',
    gameId: `game-${'2'.repeat(32)}`,
    gameSequence: 0,
    rootSeed: '0'.repeat(32),
    seedPaths: {
      game: ['collection', 'games', '0'],
      cpuTeam: ['collection', 'cpu-teams', 'difficulty', difficultyId, '0'],
      difficulty: ['collection', 'cpu-teams', 'difficulty', difficultyId],
      identity: ['collection', 'cpu-teams', 'difficulty', difficultyId, '0', 'identity'],
      candidate: ['collection', 'cpu-teams', 'difficulty', difficultyId, '0', 'candidate'],
      objectives: ['collection', 'objectives', difficultyId, '0'],
    },
    seed: '1'.repeat(32),
    playerTeam: team,
    cpuTeam: cpu,
    difficulty,
    construction: constructionFacts(cpu),
    adjustments: {
      difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
      mechanism: 'difficulty-rating-shift',
      requestedDelta: difficulty.ratingShift,
      facts: adjustmentFacts(cpu, difficulty.ratingShift),
    },
    objectives: objectiveFacts(selectedObjectiveId),
    firstClearEligible: true,
    environmentEraId: '2020s',
    profileVersion: 'm3-2020s-v1',
    profileHash: 'a'.repeat(64),
    catalogVersion: 'collection-catalog-v1',
    catalogHash: 'b'.repeat(64),
    rulesHash: 'c'.repeat(64),
    homeCourtPolicy: 'neutral-home-court',
    inputDigest: 'd'.repeat(32),
  };
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

describe('collection difficulty contracts', () => {
  it('round-trips every difficulty profile', () => {
    for (const difficultyId of ['street', 'pro', 'legend'] as const) {
      const parsed = collectionDifficultyProfileSchema.parse(profile(difficultyId));
      expect(parsed.difficultyId).toBe(difficultyId);
    }
  });

  it('rejects bad weight sums, out-of-band weights, and inverted bands', () => {
    const street = profile('street');
    expect(
      collectionDifficultyProfileSchema.safeParse({
        ...street,
        rarityWeightsBp: [{ rarity: 'Ember', weightBp: 9000 }],
      }).success,
    ).toBe(false);
    expect(
      collectionDifficultyProfileSchema.safeParse({
        ...street,
        rarityBand: { floor: 'Apex', ceiling: 'Ember' },
      }).success,
    ).toBe(false);
    expect(
      collectionDifficultyProfileSchema.safeParse({
        ...street,
        rarityWeightsBp: [
          { rarity: 'Ember', weightBp: 7600 },
          { rarity: 'Eruption', weightBp: 2200 },
          { rarity: 'Apex', weightBp: 200 },
          { rarity: 'Immortal', weightBp: 0 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('collection game commands and rejections', () => {
  it('round-trips current and legacy game commands', () => {
    const base = {
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      commandId: 'cmd-1',
      collectionId: 'collection-1',
      expectedRevision: 0,
      expectedDigest: '0'.repeat(32),
    };
    const team = validTeam();
    expect(
      collectionGameCommandSchema.parse({
        ...base,
        commandVersion: COLLECTION_GAME_COMMAND_VERSION,
        command: 'set-active-team',
        team,
      }),
    ).toMatchObject({ command: 'set-active-team' });
    expect(
      collectionGameCommandSchema.parse({
        ...base,
        commandVersion: COLLECTION_GAME_COMMAND_VERSION,
        command: 'prepare-basic-game',
        difficultyId: 'pro',
        objectiveId: null,
      }),
    ).toMatchObject({ difficultyId: 'pro' });
    expect(
      collectionGameCommandSchema.parse({
        ...base,
        commandVersion: COLLECTION_COMMAND_V1_VERSION,
        command: 'prepare-basic-game',
      }),
    ).toMatchObject({ command: 'prepare-basic-game' });
    expect(
      collectionGameCommandSchema.safeParse({
        ...base,
        commandVersion: COLLECTION_GAME_COMMAND_VERSION,
        command: 'prepare-basic-game',
      }).success,
    ).toBe(false);
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
      { code: 'unknown-difficulty', difficultyId: 'impossible' },
      { code: 'objective-not-offered', objectiveId: 'obj-three-barrage-v1' },
      { code: 'infeasible-objective', objectiveId: 'obj-bench-spark-v1' },
      { code: 'invalid-adjustment-facts', detail: 'nope' },
      { code: 'invalid-reward-facts', detail: 'nope' },
      { code: 'first-clear-divergence', detail: 'nope' },
    ];
    for (const rejection of cases) {
      expect(collectionGameRejectionSchema.parse(rejection)).toMatchObject({
        code: rejection.code,
      });
    }
  });
});

describe('collection prepared game and play state', () => {
  it('round-trips legacy and current prepared games', () => {
    const team = validTeam();
    const legacy = {
      gameVersion: COLLECTION_GAME_V1_VERSION,
      teamVersion: COLLECTION_TEAM_VERSION,
      rewardVersion: COLLECTION_REWARD_V1_VERSION,
      replayVersion: COLLECTION_GAME_V1_REPLAY_VERSION,
      rulesVersion: COLLECTION_GAME_V1_RULES_VERSION,
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
    };
    expect(collectionPreparedGameUnionSchema.parse(legacy).gameVersion).toBe(
      COLLECTION_GAME_V1_VERSION,
    );
    const current = collectionPreparedGameSchema.parse(buildPreparedV2('legend', null));
    expect(current.difficulty.difficultyId).toBe('legend');
    expect(collectionPreparedGameUnionSchema.parse(current).gameVersion).toBe('collection-game-v2');
  });

  it('rejects v1/v2 mixtures and out-of-order construction facts', () => {
    const current = buildPreparedV2('street', null);
    expect(
      collectionPreparedGameSchema.safeParse({
        ...current,
        gameVersion: COLLECTION_GAME_V1_VERSION,
      }).success,
    ).toBe(false);
    expect(
      collectionPreparedGameSchema.safeParse({
        ...current,
        adjustments: { ...current.adjustments, requestedDelta: 0 },
      }).success,
    ).toBe(false);
    expect(
      collectionPreparedGameSchema.safeParse({
        ...current,
        construction: { ...current.construction, candidateCount: 4 },
      }).success,
    ).toBe(false);
    expect(
      collectionPreparedGameSchema.safeParse({
        ...current,
        objectives: { ...current.objectives, selectedObjectiveId: 'obj-own-glass-v1' },
      }).success,
    ).toBe(false);
  });

  it('accepts a v2 play state with cleared difficulties and a legacy pending game', () => {
    const team = validTeam();
    const state = collectionPlayStateSchema.parse({
      saveVersion: 2,
      schemaVersion: COLLECTION_SCHEMA_VERSION,
      teamVersion: COLLECTION_TEAM_VERSION,
      gameVersion: 'collection-game-v2',
      collectionId: 'collection-1',
      activeTeam: team,
      revision: 2,
      digest: 'e'.repeat(32),
      nextGameSequence: 3,
      pendingGame: collectionPreparedGameSchema.parse(
        buildPreparedV2('street', 'obj-lock-score-v1'),
      ),
      clearedDifficultyIds: ['street', 'pro'],
    });
    expect(state.clearedDifficultyIds).toEqual(['street', 'pro']);
    expect(
      collectionPlayStateSchema.safeParse({
        ...state,
        clearedDifficultyIds: ['street', 'street'],
      }).success,
    ).toBe(false);
    expect(
      collectionPlayStateSchema.safeParse({ ...state, clearedDifficultyIds: ['legend'] }).success,
    ).toBe(true);
  });
});

describe('collection reward and rules contracts', () => {
  it('round-trips a receipt and rejects mismatched totals or duplicate components', () => {
    const receipt = {
      rewardVersion: COLLECTION_REWARD_VERSION,
      difficultyId: 'street',
      gameOutcome: 'completed',
      playerWin: true,
      scoreMargin: 5,
      objectiveId: 'obj-three-barrage-v1',
      objectiveSucceeded: true,
      firstClearEligible: true,
      firstClearGranted: false,
      components: [
        {
          kind: 'outcome',
          reason: 'game-win-reward',
          currency: 'Coins',
          baseAmount: 100,
          multiplierBp: 10_000,
          amount: 100,
          transactionId: `txn-${'1'.repeat(32)}`,
        },
        {
          kind: 'objective',
          reason: 'game-objective-reward',
          currency: 'Coins',
          baseAmount: 30,
          multiplierBp: 10_000,
          amount: 30,
          transactionId: `txn-${'2'.repeat(32)}`,
          objectiveId: 'obj-three-barrage-v1',
        },
      ],
      total: 130,
    };
    expect(collectionGameRewardReceiptSchema.parse(receipt).total).toBe(130);
    expect(collectionGameRewardReceiptSchema.safeParse({ ...receipt, total: 999 }).success).toBe(
      false,
    );
    expect(
      collectionGameRewardReceiptSchema.safeParse({
        ...receipt,
        components: [receipt.components[0], receipt.components[0]],
        total: 200,
      }).success,
    ).toBe(false);
  });

  it('pins the v2 rules artifact shape', () => {
    const street = profile('street');
    const pro = profile('pro');
    const legend = profile('legend');
    const rules = collectionGameRulesSchema.parse({
      rulesVersion: COLLECTION_GAME_RULES_VERSION,
      gameVersion: 'collection-game-v2',
      teamVersion: COLLECTION_TEAM_VERSION,
      rewardVersion: COLLECTION_REWARD_VERSION,
      replayVersion: COLLECTION_GAME_REPLAY_VERSION,
      difficultyVersion: COLLECTION_DIFFICULTY_VERSION,
      objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
      cpuRosterSize: 12,
      eligibleScope: 'full-catalog',
      difficulties: [street, pro, legend],
      objectives: [
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-three-barrage-v1',
          title: 'Three barrage',
          threshold: 12,
        },
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-lock-score-v1',
          title: 'Lock the score',
          threshold: 105,
        },
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-bench-spark-v1',
          title: 'Bench spark',
          threshold: 25,
        },
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-ball-pressure-v1',
          title: 'Ball pressure',
          threshold: 14,
        },
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-own-glass-v1',
          title: 'Own the glass',
          threshold: 10,
        },
        {
          objectiveVersion: COLLECTION_OBJECTIVE_VERSION,
          objectiveId: 'obj-box-score-star-v1',
          title: 'Box-score star',
          threshold: 10,
        },
      ],
      rewardTable: {
        winCoins: 100,
        lossCoins: 10,
        objectiveCoins: 30,
        marginCoinPerPoint: 1,
        marginCapPoints: 20,
        firstClearCoins: { street: 200, pro: 350, legend: 500 },
      },
      environmentEraId: '2020s',
      homeCourtPolicy: 'neutral-home-court',
      engineVersion: 'm3-engine-v21',
      profileVersion: 'm3-2020s-v1',
    });
    expect(rules.difficulties.map((entry) => entry.difficultyId)).toEqual([
      'street',
      'pro',
      'legend',
    ]);
    expect(
      collectionGameRulesSchema.safeParse({
        ...rules,
        difficulties: [pro, street, legend],
      }).success,
    ).toBe(false);
  });
});

describe('collection worker wire', () => {
  it('validates v2 envelopes with both prepared versions', () => {
    const prepared = collectionPreparedGameSchema.parse(buildPreparedV2('pro', null));
    const request = {
      wireVersion: COLLECTION_GAME_WORKER_WIRE_VERSION,
      type: 'collection-game-simulate',
      requestId: 'req-1',
      prepared,
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
