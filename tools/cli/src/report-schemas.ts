import { z } from 'zod';
import {
  franchiseIdSchema,
  playerVersionIdSchema,
  seasonFoulOutSchema,
  seasonForfeitTriggerSchema,
  seasonRotationDeviationReasonSchema,
  seasonRotationDeviationSchema,
  seasonRotationPresetSchema,
  seasonSubstitutionSchema,
  seasonUnitStintSchema,
} from '@hoop-rush/data-contracts';

/**
 * Versioned CLI report payloads (spec/09). Every command emits a
 * runtime-validated, versioned JSON payload alongside the existing compact
 * CliReport; exit codes stay 0 (pass), 1 (failed checks), 2 (usage/data
 * error). Text output is a projection; JSON carries the full payload.
 */

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
export type SimGameReport = z.infer<typeof simGameReportSchema>;

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
export type SimBatchReport = z.infer<typeof simBatchReportSchema>;

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
export type SimDiagnoseReport = z.infer<typeof simDiagnoseReportSchema>;

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
export type SimSeasonReport = z.infer<typeof simSeasonReportSchema>;

export const replayReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('replay'),
  seed: z.string().min(1).max(64),
  engineVersion: z.string().min(1).max(64),
  identical: z.boolean(),
  /** First structured difference as a path, e.g. "home.box.points". */
  firstDifference: z.string().nullable(),
  expectedValue: z.unknown().nullable(),
  actualValue: z.unknown().nullable(),
});
export type ReplayReport = z.infer<typeof replayReportSchema>;

export const calibrationMetricStatusSchema = z.enum(['pass', 'fail', 'skippedInsufficientSample']);
export type CalibrationMetricStatus = z.infer<typeof calibrationMetricStatusSchema>;

export const calibrationMetricSchema = z.object({
  key: z.string().min(1).max(64),
  target: z.number(),
  tolerance: z.number(),
  observed: z.number(),
  /**
   * Three-state gate result: 'pass' (in range), 'fail' (out of range), or
   * 'skippedInsufficientSample' (sample below the gate's minimum). A skipped
   * gate is never reported as passing.
   */
  status: calibrationMetricStatusSchema,
  /** Derived from status: true only for 'pass'. */
  pass: z.boolean(),
  sample: z.number().int().nonnegative(),
  minimumSample: z.number().int().nonnegative(),
});
export type CalibrationMetric = z.infer<typeof calibrationMetricSchema>;

export const calibrateRunReportSchema = z.object({
  schemaVersion: z.literal(2),
  command: z.literal('calibrate run'),
  profileVersion: z.string().min(1).max(64),
  eraId: z.string().min(1).max(24),
  samples: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  pass: z.boolean(),
  metrics: z.array(calibrationMetricSchema),
  /** Informational (not gated): opening opponent win rate vs a strong user lineup. */
  openingOpponentWinRateVsStrongUser: z.number().nullable(),
  /** Informational: every bracket opponent remeasured against the benchmark matrix. */
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
  /** Informational: median observed win rate across the bracket. */
  bracketMedianObservedWinRate: z.number().nullable(),
  /** Informational until an explicit range is approved and frozen (spec/06). */
  perfectRunRate: z.number().nullable(),
  /** Number of complete 82-game runs used for the perfect-run probe. */
  challengeRuns: z.number().int().nonnegative(),
  invariantFailures: z.number().int().nonnegative(),
});
export type CalibrateRunReport = z.infer<typeof calibrateRunReportSchema>;

export const sensitivityMetricSchema = z.object({
  family: z.string().min(1).max(64),
  direction: z.string().min(1).max(64),
  baseValue: z.number(),
  changedValue: z.number(),
  relativeShift: z.number(),
  pass: z.boolean(),
});
export type SensitivityMetric = z.infer<typeof sensitivityMetricSchema>;

export const calibrateSensitivityReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('calibrate sensitivity'),
  samples: z.number().int().nonnegative(),
  engineVersion: z.string().min(1).max(64),
  pass: z.boolean(),
  metrics: z.array(sensitivityMetricSchema),
});
export type CalibrateSensitivityReport = z.infer<typeof calibrateSensitivityReportSchema>;

export const simChallengeReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim challenge'),
  lineup: z.string().min(1).max(96),
  seed: z.string().min(1).max(64),
  /** Run seed of the chosen best-of-N attempt (the authoritative replay seed). */
  chosenSeed: z.string().min(1).max(64),
  /** Number of whole-run attempts simulated and compared. */
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
      points: z.number().int().nonnegative(),
      rebounds: z.number().int().nonnegative(),
      assists: z.number().int().nonnegative(),
      steals: z.number().int().nonnegative(),
      blocks: z.number().int().nonnegative(),
      turnovers: z.number().int().nonnegative(),
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
export type SimChallengeReport = z.infer<typeof simChallengeReportSchema>;

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
export type BracketAuditReport = z.infer<typeof bracketAuditReportSchema>;

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
export type BracketGenerateReport = z.infer<typeof bracketGenerateReportSchema>;

export const seasonScheduleGenerateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season schedule generate'),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  scheduleVersion: z.string().min(1).max(64),
  formulaVersion: z.string().min(1).max(64),
  leagueVersion: z.string().min(1).max(64),
  rounds: z.number().int().positive(),
  games: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  wrote: z.boolean(),
  outPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonScheduleGenerateReport = z.infer<typeof seasonScheduleGenerateReportSchema>;

export const seasonScheduleAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season schedule audit'),
  scheduleVersion: z.string().min(1).max(64),
  formulaVersion: z.string().min(1).max(64),
  leagueVersion: z.string().min(1).max(64),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  rounds: z.number().int().positive(),
  games: z.number().int().positive(),
  auditFailures: z.number().int().nonnegative(),
  regenerationIdentical: z.boolean(),
  /** Null when the manifest carries no season artifact references. */
  manifestVerified: z.boolean().nullable(),
  pass: z.boolean(),
});
export type SeasonScheduleAuditReport = z.infer<typeof seasonScheduleAuditReportSchema>;

/** Season Run draft command replay report (M2.1). */
export const seasonDraftReproduceReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season draft reproduce'),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  catalogVersion: z.string().min(1).max(64),
  commandCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  rejectedCount: z.number().int().nonnegative(),
  finalRevision: z.number().int().nonnegative(),
  finalStatus: z.string().min(1).max(32),
  finalDigest: z.string().regex(/^[0-9a-f]{32}$/),
  expectedDigest: z
    .string()
    .regex(/^[0-9a-f]{32}$/)
    .nullable(),
  /** True when the final digest matches the expected digest. */
  identical: z.boolean(),
  rolls: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: z.string().min(1).max(64),
      eraId: z.string().min(1).max(24),
      attemptIndex: z.number().int().nonnegative(),
      usable: z.boolean(),
    }),
  ),
  claims: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: z.string().min(1).max(64),
      eraId: z.string().min(1).max(24),
    }),
  ),
  picks: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      round: z.number().int().min(1).max(10),
      playerVersionId: z.string().min(1).max(64),
    }),
  ),
  rejections: z.array(
    z.object({
      commandId: z.string().min(1).max(64),
      errorCode: z.string().min(1).max(64),
      message: z.string().min(1).max(512),
    }),
  ),
  divergences: z.array(z.string().min(1)),
  pass: z.boolean(),
});
export type SeasonDraftReproduceReport = z.infer<typeof seasonDraftReproduceReportSchema>;

/** Season Run AI roster generation report (M2.1). */
export const seasonRostersGenerateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season rosters generate'),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  teams: z.number().int().positive(),
  ownershipRows: z.number().int().positive(),
  digest: z.string().regex(/^[0-9a-f]{32}$/),
  diagnostics: z.object({
    teamsGenerated: z.number().int().nonnegative(),
    teamsRepaired: z.number().int().nonnegative(),
    backtracks: z.number().int().nonnegative(),
    nodesVisited: z.number().int().nonnegative(),
  }),
  wrote: z.boolean(),
  outPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonRostersGenerateReport = z.infer<typeof seasonRostersGenerateReportSchema>;

/** Season Run roster audit report (M2.1). */
export const seasonRostersAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season rosters audit'),
  input: z.string().min(1),
  teams: z.number().int().positive(),
  ownershipRows: z.number().int().positive(),
  quotaFailures: z.number().int().nonnegative(),
  identityFailures: z.number().int().nonnegative(),
  legalityFailures: z.number().int().nonnegative(),
  roleCoverageFailures: z.number().int().nonnegative(),
  rotationFailures: z.number().int().nonnegative(),
  versionFailures: z.number().int().nonnegative(),
  digestVerified: z.boolean(),
  auditFailures: z.number().int().nonnegative(),
  pass: z.boolean(),
});
export type SeasonRostersAuditReport = z.infer<typeof seasonRostersAuditReportSchema>;

/** One distribution entry in the calibration report. */
const distributionEntrySchema = z.object({
  median: z.number().min(0).max(100),
  range: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]),
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
  sample: z.number().int().nonnegative(),
});

/** Season Run AI roster calibration report (M2.1). */
export const seasonRostersCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season rosters calibrate'),
  calibrationSeeds: z.number().int().positive(),
  validationSeeds: z.number().int().positive(),
  failures: z.number().int().nonnegative(),
  repairRate: z.number().min(0).max(1),
  backtrackRate: z.number().min(0).max(1),
  durationMs: z.number().nonnegative(),
  bands: z.object({
    contender: distributionEntrySchema,
    playoff: distributionEntrySchema,
    average: distributionEntrySchema,
    weaker: distributionEntrySchema,
  }),
  identities: z.record(z.string().min(1), distributionEntrySchema),
  gates: z.object({
    orderedBandMedians: z.boolean(),
    quotas: z.boolean(),
    roleCoverage: z.boolean(),
    identities: z.boolean(),
    zeroIllegal: z.boolean(),
    heldOutPassShare: z.number().min(0).max(1),
    heldOutPass: z.boolean(),
  }),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonRostersCalibrateReport = z.infer<typeof seasonRostersCalibrateReportSchema>;

/**
 * Overall cohort percentile bands (spec: percentile Overall normalization).
 * `range` is the value envelope of the band; median may be null for the
 * 40-71 band when its values are spread across the whole envelope.
 */
export const overallsDistributionBandSchema = z.object({
  label: z.string().min(1),
  targetPercent: z.number().min(0).max(100),
  count: z.number().int().nonnegative(),
  percentage: z.number().min(0).max(100),
  median: z.number().min(0).max(100).nullable(),
  min: z.number().min(0).max(100),
  max: z.number().min(0).max(100),
});

/** Per-era Overall percentile band breakdown (spec: percentile normalization). */
export const overallsDistributionEraSchema = z.object({
  count: z.number().int().nonnegative(),
  bands: z.array(overallsDistributionBandSchema),
});

/** `data overalls-distribution` report payload (spec: cohort percentile check). */
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
export type OverallsDistributionReport = z.infer<typeof overallsDistributionReportSchema>;

/** One era entry in the defense-vs-BPM correlation report. */
export const defenseBpmEraSchema = z.object({
  eraId: z.string().min(1),
  sample: z.number().int().nonnegative(),
  correlation: z.number().min(-1).max(1).nullable(),
});

/** `data defense-bpm-correlation` report payload (spec: defensive BPM audit). */
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
export type DefenseBpmCorrelationReport = z.infer<typeof defenseBpmCorrelationReportSchema>;

/** One per-player actual-vs-target minute row in a Season game report. */
const seasonGamePlayerMinutesSchema = z.object({
  side: z.enum(['home', 'away']),
  playerVersionId: playerVersionIdSchema,
  actualSeconds: z.number().int().nonnegative(),
  targetSeconds: z.number().int().nonnegative(),
  deviationSeconds: z.number().int(),
  reasons: z.array(seasonRotationDeviationReasonSchema),
});

/** M2.2 `season game simulate` report payload (spec/2.0/04). */
export const seasonGameSimulateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season game simulate'),
  fixtureId: z.string().min(1).max(64),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  outcome: z.enum(['completed', 'forfeit', 'no-legal-five-both']),
  winner: z.enum(['home', 'away']).nullable(),
  home: z.object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    score: z.number().int().nonnegative().nullable(),
  }),
  away: z.object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    score: z.number().int().nonnegative().nullable(),
  }),
  overtimePeriods: z.number().int().nonnegative(),
  forfeit: z
    .object({
      losingFranchiseId: franchiseIdSchema,
      trigger: seasonForfeitTriggerSchema,
    })
    .nullable(),
  engineVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  gameVersion: z.string().min(1).max(64),
  rotationVersion: z.string().min(1).max(64),
  playerMinutes: z.array(seasonGamePlayerMinutesSchema),
  substitutions: z.array(seasonSubstitutionSchema),
  unitStints: z.array(seasonUnitStintSchema),
  foulOuts: z.array(seasonFoulOutSchema),
  deviations: z.array(seasonRotationDeviationSchema),
  invariantFailures: z.array(z.string().min(1)),
  pass: z.boolean(),
});
export type SeasonGameSimulateReport = z.infer<typeof seasonGameSimulateReportSchema>;

/** Per-fixture calibration stats plus failure counts (calibration cohort). */
const seasonGameFixtureStatsSchema = z.object({
  fixtureId: z.string().min(1).max(64),
  preset: seasonRotationPresetSchema.nullable(),
  /** Completed calibration-cohort games contributing to the medians. */
  sample: z.number().int().nonnegative(),
  starterSecondsMedian: z.number().nonnegative(),
  benchSecondsMedian: z.number().nonnegative(),
  benchRoleMedianSeconds: z.array(z.number().nonnegative()).length(5),
  failures: z.object({
    /** Calibration games with any check failure or determinism divergence. */
    games: z.number().int().nonnegative(),
    /** Total checkSeasonGameResult failure strings over the calibration cohort. */
    checks: z.number().int().nonnegative(),
    /** Calibration games whose double-run results diverged. */
    determinism: z.number().int().nonnegative(),
  }),
});

/** M2.2 `season game calibrate` report payload (spec/2.0/04). */
export const seasonGameCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season game calibrate'),
  fixtures: z.array(
    z.object({
      fixtureId: z.string().min(1).max(64),
      preset: seasonRotationPresetSchema.nullable(),
    }),
  ),
  calibrationSeedCount: z.number().int().nonnegative(),
  validationSeedCount: z.number().int().nonnegative(),
  workers: z.number().int().min(1),
  durationMs: z.number().nonnegative(),
  fixtureStats: z.array(seasonGameFixtureStatsSchema),
  gates: z.object({
    zeroFailures: z.boolean(),
    starterOrdering: z.boolean(),
    benchOrdering: z.boolean(),
    benchRoleNonIncreasing: z.boolean(),
    heldOutPassShare: z.number().min(0).max(1),
    heldOutPass: z.boolean(),
  }),
  /** Gate 6: the chunking probe re-ran a subset with one chunk and matched. */
  chunkingIndependent: z.boolean(),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonGameCalibrateReport = z.infer<typeof seasonGameCalibrateReportSchema>;
