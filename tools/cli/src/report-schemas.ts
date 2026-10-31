import { z } from 'zod';
import { reconstructionHoldoutSchema, reconstructionPriorsSchema } from '@hoop-rush/data-contracts';
import { DRAFT_FIT_REFINE_MAX } from '@hoop-rush/engine';

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
  pass: z.boolean(),
});
const benchmarkRegressionSchema = z.object({
  metric: z.enum(['medianMs', 'p95Ms']),
  measurement: z.string().min(1).max(64),
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

const capRushBenchmarkPhasesSchema = z.object({
  seasonSimulate: timingStatsSchema,
  seasonAccept: timingStatsSchema,
  leagueSimulate: timingStatsSchema,
  leagueAccept: timingStatsSchema,
  seasonFinalize: timingStatsSchema,
  standings: timingStatsSchema,
  postseasonStep: timingStatsSchema,
  postseasonSimulate: timingStatsSchema,
  postseasonAccept: timingStatsSchema,
  postseasonFinalize: timingStatsSchema,
  seasonTotal: timingStatsSchema,
  postseasonTotal: timingStatsSchema,
  total: timingStatsSchema,
});

export const capRushBenchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('cap-rush benchmark'),
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
  bracketHash: z.string().min(1).max(128),
  fixture: z.string().min(1).max(64),
  samples: z.number().int().positive(),
  policies: z.array(
    z.object({
      policy: z.enum(['balanced', 'premium']),
      payrollDollars: z.number().int().nonnegative(),
      payrollStatus: z.enum(['under-cap', 'first-apron', 'second-apron']),
      counts: z.object({
        userSeasonGames: z.number().int().nonnegative(),
        leagueGames: z.number().int().nonnegative(),
        standingsGames: z.number().int().nonnegative(),
        postseasonUserGames: z.number().int().nonnegative(),
        postseasonAiGames: z.number().int().nonnegative(),
        postseasonSteps: z.number().int().nonnegative(),
        postseasonRounds: z.number().int().nonnegative(),
      }),
      phases: capRushBenchmarkPhasesSchema,
      markers: z.object({
        championTeamId: z.string().nullable(),
        userOutcome: z.string(),
        seasonLastResultDigest: z.string(),
        isolations: z.number().int().nonnegative(),
        strikes: z.number().int().nonnegative(),
        consistentAcrossSamples: z.boolean(),
      }),
      auditFailures: z.number().int().nonnegative(),
    }),
  ),
  baselineComparison: benchmarkBaselineComparisonSchema,
});
export type CapRushBenchmarkReport = z.infer<typeof capRushBenchmarkReportSchema>;
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
