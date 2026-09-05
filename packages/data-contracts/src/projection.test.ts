import { describe, expect, it } from 'vitest';
import {
  PROJECTION_MODEL_VERSION,
  PROJECTION_SCHEMA_VERSION,
  RATINGS_VERSION,
  SEASON_DRAFT_CATALOG_VERSION,
  SEASON_DRAFT_CATALOG_V3,
  SEASON_PROJECTION_TARGETS_VERSION,
  SEASON_PROJECTION_VERSION,
  SIMULATION_RATINGS,
  SIMULATION_TENDENCIES,
  baseFiveProjectionSchema,
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  projectionModelArtifactSchema,
  seasonDraftCatalogSchema,
  seasonProjectionSchema,
  seasonProjectionTargetsSchema,
  seasonKeySchema,
  type BaseFiveProjection,
  type ProjectionMatchupArchetype,
  type ProjectionModelArtifact,
  type ProjectionPlayerContribution,
  type ProjectionSide,
  type SeasonDraftCatalog,
  type SeasonProjectionUnitKind,
  type SimulationPlayer,
  type SeasonDraftCandidate,
} from './index.ts';
type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
function buildPlayer(
  index: number,
  positions: Position[],
  displayName = `Player ${String(index)}`,
): SimulationPlayer {
  return {
    playerId: playerIdSchema.parse(`p-proj-${String(index)}`),
    playerVersionId: `pv-${String(index).padStart(32, '0')}`,
    displayName,
    positions,
    heightInches: 78,
    weightLbs: 215,
    ratings: { ...SIMULATION_RATINGS },
    tendencies: { ...SIMULATION_TENDENCIES },
    anchors: {
      gamesPlayed: 70,
      minutesPerGame: 30,
      pointsPerGame: 12,
      reboundsPerGame: 5,
      offensiveReboundsPerGame: 1,
      defensiveReboundsPerGame: 4,
      assistsPerGame: 3,
      stealsPerGame: 1,
      blocksPerGame: 0.5,
      turnoversPerGame: 1.5,
      fieldGoalPct: 0.45,
      threePointPct: 0.35,
      freeThrowPct: 0.78,
      threePointAttemptRate: 0.2,
      freeThrowAttemptRate: 0.2,
    },
  };
}
const SLOTS: Array<'G1' | 'G2' | 'F1' | 'F2' | 'C'> = ['G1', 'G2', 'F1', 'F2', 'C'];
function buildContributions(): ProjectionPlayerContribution[] {
  return SLOTS.map((slot, index) => ({
    slot,
    playerId: playerIdSchema.parse(`p-proj-${String(index + 1)}`),
    playerVersionId: `pv-${String(index + 1).padStart(32, '0')}`,
    displayName: `Player ${String(index + 1)}`,
    usageShare: 0.2,
    initiatorShare: 0.2,
    creationShare: 60,
    spacingContribution: 0.4,
    expectedShots: 16,
    expectedMakes: 7,
    expectedPoints: 20,
    expectedAssists: 4,
    expectedTurnovers: 2,
    expectedRebounds: 8,
    expectedFouls: 3,
    defensiveContribution: 55,
  }));
}
function buildSide(points = 108): ProjectionSide {
  return {
    ledger: {
      possessions: 100,
      turnoverRate: 0.13,
      nonShootingFoulRate: 0.02,
      shotRate: 0.85,
      fieldGoalAttempts: 82,
      fieldGoalMakes: 36,
      twoPointAttempts: 60,
      twoPointMakes: 28,
      threePointAttempts: 22,
      threePointMakes: 8,
      freeThrowAttempts: 20,
      freeThrowMakes: 16,
      fieldGoalPct: 0.439,
      twoPointPct: 0.467,
      threePointPct: 0.364,
      effectiveFieldGoalPct: 0.488,
      trueShootingPct: 0.56,
      freeThrowRate: 0.244,
      points,
      offensiveReboundRate: 0.25,
      defensiveReboundRate: 0.75,
      offensiveRebounds: 12,
      defensiveRebounds: 30,
      turnovers: 13,
      assists: 24,
      steals: 7,
      blocks: 5,
      fouls: 18,
      secondChancePoints: 8,
    },
    spacing: { score: 55, raw: 0.42, shotQualityLift: 0.012, expectedContest: -0.03 },
    creation: {
      score: 60,
      initiatorShare: { G1: 0.4, G2: 0.3, F1: 0.15, F2: 0.1, C: 0.05 },
      primaryShare: 0.4,
      topTwoShare: 0.7,
      actionDiversity: 65,
      assistOpportunity: 24,
      passOpportunity: 40,
    },
    defense: {
      score: 55,
      pressure: 0.68,
      perimeterCoverage: 58,
      interiorCoverage: 52,
      rimProtection: 48,
      stealOpportunity: 40,
      blockOpportunity: 35,
      foulExposure: 55,
      defensiveRebounding: 60,
      expectedOpponentShotQuality: 0.5,
    },
    turnoverCauses: {
      stealShare: 0.35,
      nonStealShare: 0.65,
      expectedSteals: 4.5,
      expectedOther: 8.5,
    },
    actions: {
      isolation: 0.12,
      pickAndRoll: 0.3,
      spotUp: 0.25,
      transition: 0.15,
      postUp: 0.08,
      cut: 0.06,
      pickAndRollRoll: 0.04,
    },
    zones: { rim: 0.35, shortMid: 0.22, longMid: 0.16, cornerThree: 0.1, aboveBreakThree: 0.17 },
    shooters: { G1: 0.28, G2: 0.24, F1: 0.2, F2: 0.16, C: 0.12 },
    players: buildContributions(),
  };
}
function buildBase(offensePoints = 108, defensePoints = 104): BaseFiveProjection {
  return {
    schemaVersion: 1,
    modelVersion: PROJECTION_MODEL_VERSION,
    referenceId: 'ref-1990s-neutral',
    referenceHash: contentHashSchema.parse('a'.repeat(64)),
    eraId: eraIdSchema.parse('1990s'),
    eraProfileVersion: 'era-1990s-v4',
    dataVersion: `m10-${RATINGS_VERSION}`,
    normalizationVersion: PROJECTION_SCHEMA_VERSION,
    inputDigest: 'b'.repeat(32),
    digest: 'c'.repeat(32),
    lineup: SLOTS.map((slot, index) => ({
      slot,
      playerId: playerIdSchema.parse(`p-proj-${String(index + 1)}`),
      playerVersionId: `pv-${String(index + 1).padStart(32, '0')}`,
      displayName: `Player ${String(index + 1)}`,
      positions: index === 4 ? ['C'] : index >= 2 ? ['SF'] : ['PG'],
    })),
    offense: buildSide(offensePoints),
    defense: buildSide(defensePoints),
    ratings: {
      offensiveRating: offensePoints,
      defensiveRatingAllowed: defensePoints,
      netRating: offensePoints - defensePoints,
      expectedPossessions: 100,
    },
    weaknesses: [],
  };
}
function roundTrip<T>(
  schema: {
    parse: (value: unknown) => T;
  },
  value: T,
): T {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}
function buildReference(eraId: string, archetype: ProjectionMatchupArchetype) {
  return {
    referenceId: `ref-${eraId}-${archetype}`,
    archetype,
    eraId: eraIdSchema.parse(eraId),
    referenceHash: contentHashSchema.parse('d'.repeat(64)),
    players: [
      buildPlayer(1, ['PG']),
      buildPlayer(2, ['SG']),
      buildPlayer(3, ['SF']),
      buildPlayer(4, ['PF']),
      buildPlayer(5, ['C']),
    ] as [SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer, SimulationPlayer],
  };
}
function buildModel(): ProjectionModelArtifact {
  return projectionModelArtifactSchema.parse({
    schemaVersion: 1,
    modelVersion: PROJECTION_MODEL_VERSION,
    dataVersion: `m10-${RATINGS_VERSION}`,
    ratingsVersion: RATINGS_VERSION,
    eraProfileVersions: { '1990s': 'era-1990s-v4' },
    references: {
      '1990s': {
        neutral: buildReference('1990s', 'neutral'),
        archetypes: [
          buildReference('1990s', 'perimeter'),
          buildReference('1990s', 'interior'),
          buildReference('1990s', 'pressure'),
          buildReference('1990s', 'size-switch'),
        ],
      },
    },
    scales: {
      creation: { baseline: 50, perPoint: 1, min: 0, max: 100, higherIsBetter: true },
    },
    componentWeights: {
      creation: 1,
      spacing: 1,
      defense: 1,
    },
    weights: { basketballMean: 0.4, rotationMean: 0.35, robustnessMean: 0.25 },
    weaknesses: [
      {
        code: 'creation-critical',
        severity: 'critical',
        threshold: 35,
        weight: 2,
        minSide: true,
        message: 'creation score below the critical floor',
      },
    ],
    search: {
      seedNamespace: 'season-projection-search',
      partialBeamsPerLens: 16,
      completeCandidates: 32,
      startingFives: 16,
      closingFives: 16,
      benchHierarchies: 8,
      minuteTemplates: 4,
      singleRemovals: 'all',
      pairRemovals: 8,
      nodeBudgets: { partial: 100000, complete: 100000, rotation: 50000 },
      closeScenarioWeight: 0.2,
    },
    cohorts: {
      calibrationGames: 2048,
      validationGames: 1024,
      heldOutGames: 2048,
      calibrationSeedFrom: '00000000000000000000000000000000',
      calibrationSeedTo: '000000000000000000000000000007ff',
      validationSeedFrom: '00000000000000000000000000000800',
      validationSeedTo: '00000000000000000000000000000bff',
      heldOutSeedFrom: '00000000000000000000000000000c00',
      heldOutSeedTo: '000000000000000000000000000013ff',
    },
    monotonicGates: [
      {
        code: 'shooting-monotonic',
        driver: 'threePoint',
        output: 'effectiveFieldGoalPct',
        description: 'better shooting must not lower projected eFG%',
      },
    ],
  });
}
describe('projection model artifact schema', () => {
  const era1990s = eraIdSchema.parse('1990s');
  it('round-trips a valid model', () => {
    const model = roundTrip(projectionModelArtifactSchema, buildModel());
    expect(model.modelVersion).toBe(PROJECTION_MODEL_VERSION);
    expect(model.references[era1990s]?.archetypes).toHaveLength(4);
    expect(model.search.closeScenarioWeight).toBe(0.2);
  });
  it('rejects wrong model versions', () => {
    expect(() =>
      projectionModelArtifactSchema.parse({ ...buildModel(), modelVersion: 'projection-model-v2' }),
    ).toThrow();
  });
  it('rejects a missing neutral reference era', () => {
    const model = buildModel();
    Reflect.deleteProperty(model.references, era1990s);
    expect(() => projectionModelArtifactSchema.parse(model)).toThrow();
  });
  it('rejects a model without any references', () => {
    const model = buildModel();
    model.references = {};
    expect(() => projectionModelArtifactSchema.parse(model)).toThrow();
  });
  it('requires all matchup archetypes except neutral', () => {
    const model = buildModel();
    const referenceSet = model.references[era1990s];
    if (referenceSet === undefined) {
      throw new Error('projection fixture is missing its 1990s reference set');
    }
    referenceSet.archetypes = referenceSet.archetypes.slice(0, 3);
    expect(() => projectionModelArtifactSchema.parse(model)).toThrow();
  });
});
describe('base five projection schema', () => {
  it('round-trips a valid projection', () => {
    const projection = roundTrip(baseFiveProjectionSchema, buildBase());
    expect(projection.ratings.netRating).toBe(4);
    expect(projection.weaknesses).toHaveLength(0);
    expect(projection.lineup).toHaveLength(5);
  });
  it('rejects a net rating that does not reconcile', () => {
    const base = buildBase();
    expect(() =>
      baseFiveProjectionSchema.parse({
        ...base,
        ratings: { ...base.ratings, netRating: 9 },
      }),
    ).toThrow();
    expect(() =>
      baseFiveProjectionSchema.parse({
        ...base,
        ratings: { ...base.ratings, offensiveRating: 109 },
      }),
    ).toThrow();
  });
});
describe('season projection schema', () => {
  function buildUnit(unitId: string, kind: SeasonProjectionUnitKind, weight: number) {
    return {
      unitId,
      kind,
      players: [
        'pv-00000000000000000000000000000001',
        'pv-00000000000000000000000000000002',
        'pv-00000000000000000000000000000003',
        'pv-00000000000000000000000000000004',
        'pv-00000000000000000000000000000005',
      ],
      weight,
      base: buildBase(),
    };
  }
  it('round-trips a valid season projection', () => {
    const projection = roundTrip(seasonProjectionSchema, {
      schemaVersion: 1,
      version: SEASON_PROJECTION_VERSION,
      modelVersion: PROJECTION_MODEL_VERSION,
      eraId: eraIdSchema.parse('1990s'),
      eraProfileVersion: 'era-1990s-v4',
      dataVersion: `m10-${RATINGS_VERSION}`,
      inputDigest: 'b'.repeat(32),
      digest: 'c'.repeat(32),
      units: [
        buildUnit('starters', 'starting', 0.7),
        buildUnit('bench-heavy', 'bench-heavy', 0.3),
        buildUnit('contingency-pv-x', 'contingency', 0),
      ],
      minutes: Array.from({ length: 10 }, (_, index) => ({
        playerVersionId: `pv-${String(index + 1).padStart(32, '0')}`,
        targetMinutes: index < 5 ? 32 : 16,
        traceMinutes: index < 5 ? 31 : 17,
        deviation: 1,
      })),
      metrics: {
        offensiveRating: 106,
        defensiveRatingAllowed: 105,
        netRating: 1,
        startingQuality: 60,
        mixedQuality: 55,
        benchQuality: 50,
        closingQuality: 58,
        minuteDeviation: 8,
        creationContinuity: 70,
        spacingContinuity: 65,
        minimumUnitStrength: -4,
        weightedUnitStrength: 1,
        balance: 80,
        positionalCoverage: 100,
        foulResilience: 70,
        contingencyDepth: 75,
        matchupMean: 60,
        matchupWorstCase: 45,
        redundancy: 62,
      },
      weaknesses: [],
    });
    expect(projection.metrics.netRating).toBe(1);
    expect(projection.units).toHaveLength(3);
  });
  it('rejects unit weights that do not sum to one', () => {
    const base = {
      schemaVersion: 1,
      version: SEASON_PROJECTION_VERSION,
      modelVersion: PROJECTION_MODEL_VERSION,
      eraId: '1990s',
      eraProfileVersion: 'era-1990s-v4',
      dataVersion: `m10-${RATINGS_VERSION}`,
      inputDigest: 'b'.repeat(32),
      digest: 'c'.repeat(32),
      units: [buildUnit('starters', 'starting', 0.7), buildUnit('bench-heavy', 'bench-heavy', 0.4)],
      minutes: Array.from({ length: 10 }, (_, index) => ({
        playerVersionId: `pv-${String(index + 1).padStart(32, '0')}`,
        targetMinutes: index < 5 ? 32 : 16,
        traceMinutes: index < 5 ? 31 : 17,
        deviation: 1,
      })),
      metrics: {
        offensiveRating: 106,
        defensiveRatingAllowed: 105,
        netRating: 1,
        startingQuality: 60,
        mixedQuality: 55,
        benchQuality: 50,
        closingQuality: 58,
        minuteDeviation: 8,
        creationContinuity: 70,
        spacingContinuity: 65,
        minimumUnitStrength: -4,
        weightedUnitStrength: 1,
        balance: 80,
        positionalCoverage: 100,
        foulResilience: 70,
        contingencyDepth: 75,
        matchupMean: 60,
        matchupWorstCase: 45,
        redundancy: 62,
      },
      weaknesses: [],
    };
    expect(() => seasonProjectionSchema.parse(base)).toThrow(/sum to 1/);
  });
});
describe('season projection targets schema', () => {
  it('round-trips valid targets', () => {
    const targets = roundTrip(seasonProjectionTargetsSchema, {
      schemaVersion: 1,
      targetsVersion: SEASON_PROJECTION_TARGETS_VERSION,
      cohorts: {
        calibrationRosters: 64,
        validationRosters: 32,
        heldOutRosters: 64,
        gamesPerRoster: 32,
      },
      gates: {
        netRatingMaeMax: 6,
        netRatingBiasMax: 3,
        unitOrderingSpearmanMin: 0.4,
        pairwiseOrderingAccuracyMin: 0.6,
        monotonicPassShareMin: 1,
        heldOutPassShare: 0.95,
      },
      measured: {
        netRatingMae: 4.2,
        netRatingBias: 0.5,
        unitOrderingSpearman: 0.55,
        pairwiseOrderingAccuracy: 0.72,
        monotonicFailures: 0,
        heldOutPassRate: 1,
      },
    });
    expect(targets.gates.netRatingMaeMax).toBe(6);
  });
});
describe('season draft catalog v4', () => {
  function buildCatalog(): SeasonDraftCatalog {
    const candidate = (n: number, positions: [Position, ...Position[]]): SeasonDraftCandidate => ({
      playerVersionId: `pv-${String(n).padStart(32, '0')}`,
      playerId: playerIdSchema.parse(`p-${String(n)}`),
      franchiseId: franchiseIdSchema.parse('lakers'),
      eraId: eraIdSchema.parse('1990s'),
      seasonKey: seasonKeySchema.parse('1995-96'),
      displayName: `Candidate ${String(n)}`,
      playerExternalId: '101',
      positions: {
        primary: positions[0],
        secondary: [],
        playable: positions,
        normalizationVersion: 'position-v3',
      },
      heightInches: 79,
      weightLbs: 215,
      summaryRatings: { overallRating: 80, offenseRating: 82, defenseRating: 74 },
      detailedRatings: { ...SIMULATION_RATINGS },
      tendencies: { ...SIMULATION_TENDENCIES },
      stamina: { rating: 60, historicalMpg: 30, derivationVersion: 'season-stamina-v1' },
      durability: { rating: 60, derivationVersion: 'durability-v1' },
      anchors: {
        gamesPlayed: 70,
        minutesPerGame: 30,
        pointsPerGame: 12,
        reboundsPerGame: 5,
        offensiveReboundsPerGame: 1,
        defensiveReboundsPerGame: 4,
        assistsPerGame: 3,
        stealsPerGame: 1,
        blocksPerGame: 0.5,
        turnoversPerGame: 1.5,
        fieldGoalPct: 0.45,
        threePointPct: 0.35,
        freeThrowPct: 0.78,
        threePointAttemptRate: 0.2,
        freeThrowAttemptRate: 0.2,
      },
    });
    const candidates = [candidate(1, ['PG']), candidate(2, ['SG']), candidate(3, ['SF'])];
    return {
      schemaVersion: 1,
      catalogVersion: SEASON_DRAFT_CATALOG_VERSION,
      dataVersion: `m10-${RATINGS_VERSION}`,
      ratingsVersion: RATINGS_VERSION,
      positionNormalizationVersion: 'position-v3',
      playerVersionIdVersion: 'player-version-id-v1',
      staminaVersion: 'season-stamina-v1',
      durabilityVersion: 'durability-v1',
      pools: [
        {
          franchiseId: franchiseIdSchema.parse('lakers'),
          eraId: eraIdSchema.parse('1990s'),
          playerVersionIds: candidates.map((c) => c.playerVersionId),
        },
      ],
      candidates,
    };
  }
  it('accepts a v4 catalog with anchors', () => {
    const catalog = seasonDraftCatalogSchema.parse(buildCatalog());
    expect(catalog.catalogVersion).toBe(SEASON_DRAFT_CATALOG_VERSION);
    expect(catalog.candidates[0]?.anchors?.pointsPerGame).toBe(12);
  });
  it('rejects a v4 catalog missing anchors', () => {
    const catalog = buildCatalog();
    for (const candidate of catalog.candidates) delete candidate.anchors;
    expect(() => seasonDraftCatalogSchema.parse(catalog)).toThrow(/missing the validated anchors/);
  });
  it('accepts a v3 catalog without anchors', () => {
    const catalog = buildCatalog();
    catalog.catalogVersion = SEASON_DRAFT_CATALOG_V3;
    for (const candidate of catalog.candidates) delete candidate.anchors;
    const parsed = seasonDraftCatalogSchema.parse(catalog);
    expect(parsed.catalogVersion).toBe(SEASON_DRAFT_CATALOG_V3);
  });
  it('accepts a v3 catalog with anchors', () => {
    const catalog = buildCatalog();
    catalog.catalogVersion = SEASON_DRAFT_CATALOG_V3;
    const parsed = seasonDraftCatalogSchema.parse(catalog);
    expect(parsed.candidates[0]?.anchors?.pointsPerGame).toBe(12);
  });
  it('rejects unknown catalog versions', () => {
    const catalog = buildCatalog() as unknown as {
      catalogVersion: string;
    };
    catalog.catalogVersion = 'season-draft-catalog-v9';
    expect(() => seasonDraftCatalogSchema.parse(catalog)).toThrow();
  });
});
