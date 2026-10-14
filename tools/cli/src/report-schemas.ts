import { z } from 'zod';
import { reconstructionHoldoutSchema, reconstructionPriorsSchema } from '@hoop-rush/data-contracts';
import { DRAFT_FIT_REFINE_MAX } from '@hoop-rush/engine';

const calibrationCohortFields = {
  calibrationSeeds: z.number().int().nonnegative(),
  validationSeeds: z.number().int().nonnegative(),
};
const calibrationCohortPositiveFields = {
  calibrationSeeds: z.number().int().positive(),
  validationSeeds: z.number().int().positive(),
};
const targetsArtifactFields = {
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
};
export const simGameReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim game'),
  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  fixture: z.string().min(1).max(64),
  result: z.unknown(),
  invariants: z.array(z.string()),
  timingMs: z.number().nonnegative(),
});
export const simBatchReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim batch'),
  fixture: z.string().min(1).max(64),
  seedFrom: z.number().int(),
  seedTo: z.number().int(),
  workers: z.number().int().min(1),
  engineVersion: z.string().min(1).max(64),
  games: z.number().int().nonnegative(),
  homeWins: z.number().int().nonnegative(),
  awayWins: z.number().int().nonnegative(),
  overtimeGames: z.number().int().nonnegative(),
  homeWinRate: z.number(),
  averagePoints: z.number(),
  averagePossessions: z.number(),
  averageMargin: z.number(),
  invariantFailures: z.number().int().nonnegative(),
});
export const simDiagnoseReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim diagnose'),
  fixture: z.string().min(1).max(64),
  samples: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  players: z.array(
    z.object({
      playerId: z.string().min(1).max(64),
      displayName: z.string().min(1).max(96),
      archetype: z.string().min(1).max(32),
      games: z.number().int().nonnegative(),
      pointsPerGame: z.number(),
      usagePerGame: z.number(),
      usageShare: z.number(),
      teamId: z.string().min(1).max(64),
      side: z.enum(['home', 'away']),
      fieldGoalPct: z.number(),
      threePointRate: z.number(),
      freeThrowRate: z.number(),
      assistsPerGame: z.number(),
      assistConversion: z.number(),
      assistOpportunitiesPerGame: z.number(),
      offensiveReboundPct: z.number(),
      defensiveReboundPct: z.number(),
      contestedPerGame: z.number(),
      stealsPerGame: z.number(),
      turnoversPerGame: z.number(),
      topZone: z.string().min(1).max(32),
      zoneMix: z.array(
        z.object({
          zone: z.string().min(1).max(16),
          attempts: z.number().int(),
          makes: z.number().int(),
          pct: z.number(),
        }),
      ),
    }),
  ),
  team: z.object({
    averagePointsPerGame: z.number(),
    averagePossessionsPerGame: z.number(),
    averageTeamMissesPerGame: z.number(),
  }),
  spread: z.object({ topToLastUsageRatio: z.number() }),
});
export const simSeasonReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim season'),
  fixture: z.string().min(1).max(64),
  seasons: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  varianceRatioBand: z.tuple([z.number(), z.number()]),
  rows: z.array(
    z.object({
      season: z.number().int().positive(),
      players: z.array(
        z.object({
          playerId: z.string().min(1).max(64),
          displayName: z.string().min(1).max(96),
          games: z.number().int().nonnegative(),
          pointsPerGame: z.number(),
          fieldGoalPct: z.number(),
          threePointPct: z.number(),
          freeThrowPct: z.number(),
          assistsPerGame: z.number(),
          reboundsPerGame: z.number(),
          turnoversPerGame: z.number(),
          usagePerGame: z.number(),
          variance: z.object({
            fieldGoalRatio: z.number(),
            freeThrowRatio: z.number(),
          }),
        }),
      ),
    }),
  ),
});
export const replayReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('replay'),
  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  identical: z.boolean(),
  firstDifference: z.string().nullable(),
  expectedValue: z.unknown().nullable(),
  actualValue: z.unknown().nullable(),
});
const calibrationMetricStatusSchema = z.enum(['pass', 'fail', 'skippedInsufficientSample']);
export const calibrationMetricSchema = z.object({
  key: z.string().min(1).max(64),
  target: z.number(),
  tolerance: z.number(),
  observed: z.number(),
  status: calibrationMetricStatusSchema,
  pass: z.boolean(),
  sample: z.number().int().nonnegative(),
  minimumSample: z.number().int().nonnegative(),
});
export const calibrateRunReportSchema = z.object({
  schemaVersion: z.literal(2),
  command: z.literal('calibrate run'),
  profileVersion: z.string().min(1).max(64),
  eraId: z.string().min(1).max(24),
  samples: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  pass: z.boolean(),
  metrics: z.array(calibrationMetricSchema),
  openingOpponentWinRateVsStrongUser: z.number().nullable(),
  bracketDistribution: z
    .array(
      z.object({
        opponentId: z.string().min(1).max(64),
        recordedWinRate: z.number().min(0).max(1),
        observedWinRate: z.number().min(0).max(1),
        recordedPercentile: z.number().min(0).max(1),
      }),
    )
    .nullable(),
  bracketMedianObservedWinRate: z.number().nullable(),
  perfectRunRate: z.number().nullable(),
  challengeRuns: z.number().int().nonnegative(),
  invariantFailures: z.number().int().nonnegative(),
});
const sensitivityMetricSchema = z.object({
  family: z.string().min(1).max(64),
  direction: z.string().min(1).max(64),
  baseValue: z.number(),
  changedValue: z.number(),
  relativeShift: z.number(),
  pass: z.boolean(),
});
export const calibrateSensitivityReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('calibrate sensitivity'),
  samples: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  pass: z.boolean(),
  metrics: z.array(sensitivityMetricSchema),
});
export const threePointCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('calibrate three-point'),
  artifactVersion: z.string().min(1).max(64),
  written: z.boolean(),
  artifactPath: z.string().min(1),
  cohortSize: z.object({
    rows: z.number().int().nonnegative(),
    accuracyRows: z.number().int().nonnegative(),
    attemptRows: z.number().int().nonnegative(),
  }),
  gates: z.object({
    meanBiasNonPositiveAccuracy: z.boolean(),
    meanBiasNonPositiveTranslatedAttemptRate: z.boolean(),
    floorBelowEstablished: z.boolean(),
  }),
  floors: z.object({
    floor: z.number().min(0).max(1),
    zoneFloors: z.object({
      cornerThree: z.number().min(0).max(1),
      aboveBreakThree: z.number().min(0).max(1),
    }),
  }),
  ratingMapping: z.object({
    points: z
      .array(z.object({ accuracy: z.number().min(0).max(1), rating: z.number().min(0).max(100) }))
      .min(2),
    clampMin: z.number().min(0).max(100),
    clampMax: z.number().min(0).max(100),
  }),
  regularization: z.object({
    lambda: z.number().nonnegative(),
    maxIterations: z.number().int().positive(),
    convergenceTolerance: z.number().positive(),
  }),
  priors: reconstructionPriorsSchema,
  fitCohort: z.object({
    seasons: z.array(z.string().min(1).max(16)).length(5),
    description: z.string().min(1).max(256),
  }),
  holdout: reconstructionHoldoutSchema,
  generatedBy: z.string().min(1).max(256),
});
export const simChallengeReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim challenge'),
  lineup: z.string().min(1).max(320),
  seed: z.string().min(1).max(64),
  eraId: z.string().min(1).max(64),
  chosenSeed: z.string().min(1).max(64),
  attempts: z.number().int().positive(),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  record: z.object({
    wins: z.number().int().nonnegative(),
    losses: z.number().int().nonnegative(),
    gamesPlayed: z.number().int().nonnegative(),
  }),
  outcome: z.enum(['perfect', 'eliminated']),
  firstLossGameNumber: z.number().int().min(1).max(82).nullable(),
  playerTotals: z.array(
    z.object({
      playerId: z.string().min(1).max(64),
      gamesPlayed: z.number().int().nonnegative(),
      minutes: z.number().int().nonnegative(),
      points: z.number().int().nonnegative(),
      rebounds: z.number().int().nonnegative(),
      assists: z.number().int().nonnegative(),
      steals: z.number().int().nonnegative(),
      blocks: z.number().int().nonnegative(),
      turnovers: z.number().int().nonnegative(),
      fouls: z.number().int().nonnegative(),
      fieldGoals: z.object({
        made: z.number().int().nonnegative(),
        attempted: z.number().int().nonnegative(),
      }),
      threes: z.object({
        made: z.number().int().nonnegative(),
        attempted: z.number().int().nonnegative(),
      }),
      freeThrows: z.object({
        made: z.number().int().nonnegative(),
        attempted: z.number().int().nonnegative(),
      }),
    }),
  ),
  teamPossessions: z.number().int().nonnegative(),
  timingMs: z.number().nonnegative(),
  invariantFailures: z.number().int().nonnegative(),
});
const cliSpreadSchema = z.object({
  mean: z.number().nonnegative(),
  min: z.number().nonnegative(),
  max: z.number().nonnegative(),
  stddev: z.number().nonnegative(),
});
const madeAttemptedSpreadSchema = z.object({
  made: cliSpreadSchema,
  attempted: cliSpreadSchema,
});
export const simChallengeAverageReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim challenge-average'),
  lineup: z.string().min(1).max(320),
  seed: z.string().min(1).max(64),
  eraId: z.string().min(1).max(64),
  attempts: z.number().int().positive(),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  outcomes: z.object({
    perfect: z.number().int().nonnegative(),
    eliminated: z.number().int().nonnegative(),
  }),
  record: z.object({
    wins: cliSpreadSchema,
    losses: cliSpreadSchema,
    gamesPlayed: cliSpreadSchema,
  }),
  teamPossessions: cliSpreadSchema,
  playerAverages: z.array(
    z.object({
      playerId: z.string().min(1).max(64),
      gamesPlayed: cliSpreadSchema,
      minutes: cliSpreadSchema,
      points: cliSpreadSchema,
      rebounds: z.object({
        total: cliSpreadSchema,
        offensive: cliSpreadSchema,
        defensive: cliSpreadSchema,
      }),
      assists: cliSpreadSchema,
      steals: cliSpreadSchema,
      blocks: cliSpreadSchema,
      turnovers: cliSpreadSchema,
      fouls: cliSpreadSchema,
      fieldGoals: madeAttemptedSpreadSchema,
      threes: madeAttemptedSpreadSchema,
      freeThrows: madeAttemptedSpreadSchema,
    }),
  ),
  timingMs: z.number().nonnegative(),
  invariantFailures: z.number().int().nonnegative(),
});
export const bracketAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('bracket audit'),
  dataVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  generationSeed: z.string().min(1).max(64),
  generationVersion: z.string().min(1).max(64),
  difficultyProfileVersion: z.string().min(1).max(64),
  opponents: z.array(
    z.object({
      opponentId: z.string().min(1).max(64),
      teamId: z.string().min(1).max(64),
      winRate: z.number().min(0).max(1),
      percentile: z.number().min(0).max(1),
      sampleCount: z.number().int().positive(),
    }),
  ),
  schedulePreview: z.array(z.string().min(1)).nullable(),
  leagueMedianPercentile: z.number().min(0).max(1),
  minPercentile: z.number().min(0).max(1),
  maxPercentile: z.number().min(0).max(1),
  teamPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  leagueMedianPercentileBand: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
  openingOpponentUnchanged: z.boolean(),
  pass: z.boolean(),
});
const benchmarkRegressionSchema = z.object({
  metric: z.enum(['medianMs', 'p95Ms']),
  measurement: z.enum(['poolCold', 'poolCached', 'singleGame', 'challenge82']),
  baselineMs: z.number().nonnegative(),
  currentMs: z.number().nonnegative(),
  noiseAllowanceMs: z.number().nonnegative(),
});
const benchmarkBaselineComparisonSchema = z.object({
  status: z.enum(['not-requested', 'matched', 'skipped-fingerprint', 'regressed']),
  fingerprintMatched: z.boolean(),
  baselineFingerprint: z.string().nullable(),
  regressions: z.array(benchmarkRegressionSchema),
});
const timingStatsSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  medianMs: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  minMs: z.number().nonnegative(),
  maxMs: z.number().nonnegative(),
});
export const benchmarkReportSchema = z.object({
  schemaVersion: z.literal(2),
  command: z.literal('benchmark'),
  environment: z.object({
    node: z.string().min(1).max(64),
    platform: z.string().min(1).max(64),
    arch: z.string().min(1).max(64),
    cpus: z.number().int().positive(),
    fingerprint: z.string().min(1).max(256),
  }),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  fixture: z.string().min(1).max(64),
  samples: z.number().int().nonnegative(),
  workers: z.number().int().min(1),
  poolCold: timingStatsSchema,
  poolCached: timingStatsSchema,
  singleGame: timingStatsSchema,
  challenge82: timingStatsSchema,
  heapUsedMb: z.number().nonnegative(),
  heap: z.object({
    beforeMb: z.number().nonnegative(),
    afterMb: z.number().nonnegative(),
    deltaMb: z.number(),
  }),
  baselineComparison: benchmarkBaselineComparisonSchema,
});
export type BenchmarkReport = z.infer<typeof benchmarkReportSchema>;
const draftFitBenchmarkPlayerSchema = z.object({
  slot: z.enum(['PG', 'SG', 'SF', 'PF', 'C']),
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  overall: z.number().int().min(0).max(100),
});
const draftFitBenchmarkMetricSchema = z.object({
  wins: z.number().int().nonnegative(),
  games: z.number().int().positive(),
  winRate: z.number().min(0).max(1),
});
const draftFitBenchmarkPickSchema = z.object({
  pick: z.number().int().positive(),
  playerId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  overall: z.number().int().min(0).max(100),
  recommendedSlot: z.enum(['PG', 'SG', 'SF', 'PF', 'C']).nullable(),
  netDelta: z.number().nullable(),
  worstNetDelta: z.number().nullable(),
  tier: z.enum(['best', 'strong', 'solid', 'situational', 'poor']),
  refined: z.boolean(),
});
export const draftFitBenchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('benchmark draft-fit'),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  rolls: z.number().int().positive(),
  gamesPerBenchmark: z.number().int().positive(),
  refineTopN: z.number().int().nonnegative().max(DRAFT_FIT_REFINE_MAX),
  eligiblePools: z.number().int().positive(),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  modelVersion: z.string().min(1).max(64),
  rows: z.array(
    z.object({
      roll: z.number().int().positive(),
      franchiseId: z.string().min(1).max(64),
      eraId: z.string().min(1).max(64),
      baseline: z.object({
        lineup: z.array(draftFitBenchmarkPlayerSchema).length(5),
        metric: draftFitBenchmarkMetricSchema,
      }),
      suggested: z.object({
        lineup: z.array(draftFitBenchmarkPlayerSchema).length(5),
        picks: z.array(draftFitBenchmarkPickSchema).length(5),
        metric: draftFitBenchmarkMetricSchema,
      }),
      deltaWinRate: z.number(),
      winner: z.enum(['highest-overall', 'suggested', 'tie']),
    }),
  ),
  summary: z.object({
    highestOverall: draftFitBenchmarkMetricSchema.extend({ averageRollWinRate: z.number() }),
    suggested: draftFitBenchmarkMetricSchema.extend({ averageRollWinRate: z.number() }),
    suggestedBetterRolls: z.number().int().nonnegative(),
    highestOverallBetterRolls: z.number().int().nonnegative(),
    tiedRolls: z.number().int().nonnegative(),
    averageWinRateDelta: z.number(),
    winner: z.enum(['highest-overall', 'suggested', 'tie']),
  }),
});
export const bracketGenerateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('bracket generate'),
  seed: z.string().min(1).max(64),
  generationVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  bracketVersion: z.string().min(1).max(64),
  scheduleVersion: z.string().min(1).max(64),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  opponents: z.array(
    z.object({
      opponentId: z.string().min(1).max(64),
      teamId: z.string().min(1).max(64),
      winRate: z.number().min(0).max(1),
      percentile: z.number().min(0).max(1),
      players: z.array(z.string().min(1).max(64)),
    }),
  ),
  schedule: z.array(z.string().min(1).max(64)),
});
const overallsDistributionBandSchema = z.object({
  label: z.string().min(1),
  targetPercent: z.number().min(0).max(100),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  median: z.number().min(0).max(100).nullable(),
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
});
const overallsDistributionEraSchema = z.object({
  count: z.number().int().nonnegative(),
  bands: z.array(overallsDistributionBandSchema),
});
export const overallsDistributionReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('data overalls-distribution'),
  dataVersion: z.string().min(1).max(64),
  cohortVersion: z.string().min(1).max(64),
  total: z.number().int().nonnegative(),
  overall: z.object({
    median: z.number().min(0).max(100).nullable(),
    range: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
    sample: z.number().int().nonnegative(),
  }),
  bands: z.array(overallsDistributionBandSchema),
  perEra: z.record(z.string().min(1), overallsDistributionEraSchema),
});
const defenseBpmEraSchema = z.object({
  eraId: z.string().min(1),
  sample: z.number().int().nonnegative(),
  correlation: z.number().min(-1).max(1).nullable(),
});
export const defenseBpmCorrelationReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('data defense-bpm-correlation'),
  dataVersion: z.string().min(1).max(64),
  totalRows: z.number().int().nonnegative(),
  sample: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  correlation: z.number().min(-1).max(1).nullable(),
  pass: z.boolean(),
  perEra: z.array(defenseBpmEraSchema),
});
export const collectionPackAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection pack-audit'),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  economyVersion: z.string().min(1).max(64),
  packRulesVersion: z.string().min(1).max(64),
  packs: z.array(
    z.object({
      packId: z.string().min(1).max(64),
      priceCurrency: z.string().min(1).max(32),
      priceAmount: z.number().int().nonnegative(),
      cardCount: z.number().int().min(1).max(10),
      atLeastOne: z.record(z.string(), z.number().min(0).max(1)),
      expectedExchangeFullDuplicate: z.number().nonnegative(),
      maxDuplicatePayout: z.number().int().nonnegative(),
    }),
  ),
});
export const collectionPullReproduceReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection pull-reproduce'),
  pullSequence: z.number().int().nonnegative(),
  kind: z.enum(['welcome', 'pack']),
  ok: z.boolean(),
  failures: z.array(z.string().min(1)),
});
export const collectionPackCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection pack-calibrate'),
  ordinarySamples: z.number().int().nonnegative(),
  starterSeeds: z.number().int().nonnegative(),
  heldOutSamples: z.number().int().nonnegative(),
  gates: z.record(z.string(), z.boolean()),
  ...targetsArtifactFields,
  durationMs: z.number().nonnegative(),
});
const collectionGameAuditDifficultySchema = z.object({
  difficultyId: z.string().min(1).max(32),
  games: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  cpuSequences: z.number().int().nonnegative(),
  meanRosterScoreMillionths: z.number().int().nonnegative(),
  meanSpecialCount: z.number().nonnegative(),
  adjustmentFacts: z.number().int().nonnegative(),
  boundedRatingCount: z.number().int().nonnegative(),
  firstClearEligibleGames: z.number().int().nonnegative(),
  firstClearGranted: z.number().int().nonnegative(),
  objectiveEvaluations: z.number().int().nonnegative(),
  objectiveSuccesses: z.number().int().nonnegative(),
  maxReward: z.number().int().nonnegative(),
});
const collectionGameAuditObjectiveSchema = z.object({
  objectiveId: z.string().min(1).max(64),
  threshold: z.number().int(),
  offered: z.number().int().nonnegative(),
  selected: z.number().int().nonnegative(),
  evaluated: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  minActualValue: z.number().int().nullable(),
  maxActualValue: z.number().int().nullable(),
});
export const collectionGameAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection game-audit'),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  rulesVersion: z.string().min(1).max(64),
  rulesHash: z.string().regex(/^[0-9a-f]{64}$/),
  profileVersion: z.string().min(1).max(64),
  fixedGames: z.number().int().nonnegative(),
  heldOutGames: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  rarityCounts: z.record(z.string(), z.number().int().nonnegative()),
  shortHandedGames: z.number().int().nonnegative(),
  overtimeGames: z.number().int().nonnegative(),
  foulLimitExceptions: z.number().int().nonnegative(),
  difficulties: z.array(collectionGameAuditDifficultySchema).length(3),
  objectives: z.array(collectionGameAuditObjectiveSchema),
  v1Reproductions: z.number().int().nonnegative(),
  v2Reproductions: z.number().int().nonnegative(),
  selectionInvariantGames: z.number().int().nonnegative(),
  deterministicIds: z.number().int().nonnegative(),
  adjustmentChecks: z.number().int().nonnegative(),
  rewardChecks: z.number().int().nonnegative(),
});
export const collectionGameReproduceReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection game-reproduce'),
  gameId: z.string().min(1).max(64),
  gameSequence: z.number().int().nonnegative(),
  gameVersion: z.string().min(1).max(64),
  difficultyId: z.string().min(1).max(32).nullable(),
  objectiveSuccess: z.boolean().nullable(),
  ok: z.boolean(),
  eventDigest: z.string().regex(/^[0-9a-f]{32}$/),
  resultDigest: z.string().regex(/^[0-9a-f]{32}$/),
  rewardVersion: z.string().min(1).max(64),
  rewardReason: z.string().min(1).max(64),
  rewardAmount: z.number().int().nonnegative(),
  rewardTotal: z.number().int().nonnegative(),
  rewardTransactionId: z.string().min(1).max(128),
  failures: z.array(z.string().min(1)),
});
export const collectionGameCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection game-calibrate'),
  status: z.enum(['scaffold', 'frozen']),
  rulesVersion: z.string().min(1).max(64),
  rulesHash: z.string().regex(/^[0-9a-f]{64}$/),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  workers: z.number().int().positive(),
  ...calibrationCohortFields,
  projection: z.object({
    calibrationGames: z.number().int().nonnegative(),
    validationGames: z.number().int().nonnegative(),
    chunkInvariant: z.boolean(),
    difficulties: z.array(
      z.object({
        difficultyId: z.string().min(1).max(32),
        games: z.number().int().nonnegative(),
        meanRosterScoreMillionths: z.number().int().nonnegative(),
        meanSpecialCount: z.number().nonnegative(),
        legalityFailures: z.number().int().nonnegative(),
      }),
    ),
  }),
  gates: z.record(z.string(), z.boolean()),
  blockers: z.array(z.string().min(1)),
  targetsWritten: z.literal(false),
  targetsPath: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});
const collectionProgressionAuditChallengeSchema = z.object({
  challengeId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(48),
  difficultyId: z.string().min(1).max(32),
  requirementKind: z.enum(['era-core', 'franchise-core', 'set-family-core']),
  requirementId: z.string().min(1).max(64),
  minimumRosterCount: z.number().int().min(1).max(12),
  minimumStarterCount: z.number().int().min(1).max(5),
  firstClearCoins: z.number().int().positive(),
  repeatWinCoins: z.number().int().positive(),
  matchingPlayerCount: z.number().int().nonnegative(),
  matchingCardCount: z.number().int().nonnegative(),
  feasible: z.boolean(),
  feasibilityFailures: z.array(z.string().min(1)),
});
const collectionProgressionAuditTargetSchema = z.object({
  playerId: z.string().min(1).max(64),
  packs: z.array(
    z.object({
      packId: z.string().min(1).max(32),
      eligibleCardCount: z.number().int().nonnegative(),
      atLeastOneTarget: z.number().min(0).max(1),
      perSlot: z.array(z.number().min(0).max(1)),
    }),
  ),
});
const collectionProgressionAuditSetSchema = z.object({
  setId: z.string().min(1).max(32),
  title: z.string().min(1).max(96),
  ownedCount: z.number().int().nonnegative(),
  requiredCount: z.number().int().positive(),
  complete: z.boolean(),
  claimed: z.boolean(),
  missingCardIds: z.array(z.string().min(1)),
  rewardCurrency: z.literal('Exchange'),
  rewardAmount: z.number().int().positive(),
});
const collectionProgressionAuditStateSchema = z.object({
  collectionId: z.string().min(1).max(64),
  revision: z.number().int().nonnegative(),
  activeTargetPlayerId: z.string().nullable(),
  claimedSetIds: z.array(z.string().min(1)),
  sets: z.array(collectionProgressionAuditSetSchema),
  failures: z.array(z.string().min(1)),
  firstClearFailures: z.array(z.string().min(1)),
});
export const collectionProgressionAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection progression-audit'),
  catalogVersion: z.string().min(1).max(64),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  progressionVersion: z.string().min(1).max(64),
  progressionHash: z.string().regex(/^[0-9a-f]{64}$/),
  targetMultiplierBp: z.number().int().positive(),
  challenges: z.array(collectionProgressionAuditChallengeSchema),
  targets: z.array(collectionProgressionAuditTargetSchema),
  state: collectionProgressionAuditStateSchema.nullable(),
  pass: z.boolean(),
});
export const collectionProgressionCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('collection progression-calibrate'),
  catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
  progressionRulesHash: z.string().regex(/^[0-9a-f]{64}$/),
  rulesHash: z.string().regex(/^[0-9a-f]{64}$/),
  engineVersion: z.string().min(1).max(64),
  workers: z.number().int().positive(),
  ...calibrationCohortPositiveFields,
  ordinarySlotDraws: z.number().int().nonnegative(),
  gates: z.record(z.string().min(1).max(160), z.boolean()),
  fixtures: z.array(
    z.object({
      fixtureId: z.string().min(1).max(64),
      collectionHash: z.string().regex(/^[0-9a-f]{32}$/),
    }),
  ),
  ...targetsArtifactFields,
  pinned: z.boolean(),
  durationMs: z.number().nonnegative(),
});
const overallsAuditFlagSchema = z.object({
  displayName: z.string().min(1).max(96),
  playerExternalId: z.string().min(1).max(64),
  seasonKey: z.string().min(1).max(16),
  franchiseId: z.string().min(1).max(64),
  eraId: z.string().min(1).max(24),
  overall: z.number().int().min(0).max(100),
  rawOverallScore: z.number().nullable(),
  canonicalOverall: z.number().int().min(0).max(100).nullable(),
  minutes: z.number().int().nonnegative(),
  games: z.number().int().nonnegative(),
  productionScore: z.number().nullable(),
  productionWeight: z.number().nullable(),
  productionConfidence: z.string().min(1).max(16).nullable(),
});
const overallsAuditYoyFlagSchema = overallsAuditFlagSchema.extend({
  previousSeasonKey: z.string().min(1).max(16),
  previousOverall: z.number().int().min(0).max(100),
  delta: z.number().int(),
});
export const overallsAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('data overalls-audit'),
  dataVersion: z.string().min(1).max(64),
  total: z.number().int().nonnegative(),
  rowsWithoutRawOverall: z.number().int().nonnegative(),
  raw: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    mean: z.number().nullable(),
    median: z.number().nullable(),
    p10: z.number().nullable(),
    p25: z.number().nullable(),
    p75: z.number().nullable(),
    p90: z.number().nullable(),
    p95: z.number().nullable(),
    p99: z.number().nullable(),
  }),
  floorViolations: z.array(overallsAuditFlagSchema),
  lowConfidenceTop: z.array(overallsAuditFlagSchema),
  canonStretch: z.array(overallsAuditFlagSchema.extend({ stretch: z.number().int() })),
  yoyCliffs: z.array(overallsAuditYoyFlagSchema),
});
export const positionsCoverageReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('data positions-coverage'),
  dataVersion: z.string().min(1).max(64),
  total: z.number().int().nonnegative(),
  primary: z.record(z.string().min(1), z.number().int().nonnegative()),
  playable: z.record(z.string().min(1), z.number().int().nonnegative()),
  sourceLabels: z.record(z.string().min(1), z.number().int().nonnegative()),
  perEra: z.record(
    z.string().min(1),
    z.object({
      count: z.number().int().nonnegative(),
      primary: z.record(z.string().min(1), z.number().int().nonnegative()),
    }),
  ),
});
