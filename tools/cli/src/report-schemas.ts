import { z } from 'zod';
import {
  SEASON_EFFECT_TARGETS_LEGACY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  franchiseIdSchema,
  playerVersionIdSchema,
  reconstructionHoldoutSchema,
  reconstructionPriorsSchema,
  seasonFoulOutSchema,
  seasonForfeitTriggerSchema,
  seasonObjectiveIdSchema,
  seasonRotationDeviationReasonSchema,
  seasonRotationDeviationSchema,
  seasonRotationPresetSchema,
  seasonSubstitutionSchema,
  seasonUnitStintSchema,
} from '@hoop-rush/data-contracts';

/**
 * Versioned CLI report payloads (spec/09): runtime-validated JSON emitted
 * alongside the compact CliReport. Exit codes: 0 pass, 1 failed checks, 2
 * usage/data error.
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

/**
 * `calibrate three-point` report payload (spec/12): the summary of a
 * conservative three-point reconstruction fit over the 1979-80..1983-84
 * cohort. The full fitted artifact is the reproducibility boundary; the
 * report carries the cohort facts, gates, floors, mapping, regularization,
 * priors, and the grouped-holdout metrics.
 */
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
export type ThreePointCalibrateReport = z.infer<typeof threePointCalibrateReportSchema>;

export const simChallengeReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('sim challenge'),
  lineup: z.string().min(1).max(320),
  seed: z.string().min(1).max(64),
  /** Simulation environment era (fixed '2010s' sandbox era unless --era). */
  eraId: z.string().min(1).max(64),
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

/** Season Run draft command replay report (M2.3.5, season-draft-v2). */
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
  identical: z.boolean(),
  offers: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      round: z.number().int().min(1).max(10),
      pickOrdinal: z.number().int().min(1).max(10),
      seedPath: z.array(z.string().min(1)).min(1),
      cards: z.array(
        z.object({
          playerVersionId: z.string().min(1).max(64),
          selectable: z.boolean(),
          coverageReason: z.string().min(1).max(256).nullable(),
        }),
      ),
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

/** Season Run AI roster generation report (M2.1, M2.4 roster-generation-v2). */
export const seasonRostersGenerateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season rosters generate'),
  seed: z.string().regex(/^[0-9a-f]{16,64}$/),
  teams: z.number().int().positive(),
  ownershipRows: z.number().int().positive(),
  /** M2.4: recorded AI pools (29 solo, 28 duo). */
  pools: z.number().int().nonnegative(),
  /** M2.4: total matched anchors across the AI pools. */
  anchorsTotal: z.number().int().nonnegative(),
  /** M2.4: total pool repairs across the AI pools. */
  repairCount: z.number().int().nonnegative(),
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

/** Season Run roster audit report (M2.1, M2.4 roster-generation-v2). */
export const seasonRostersAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season rosters audit'),
  input: z.string().min(1),
  teams: z.number().int().positive(),
  ownershipRows: z.number().int().positive(),
  /** M2.4: recorded AI pools (29 solo, 28 duo). */
  pools: z.number().int().nonnegative(),
  quotaFailures: z.number().int().nonnegative(),
  identityFailures: z.number().int().nonnegative(),
  /** M2.4: selected-roster legality failures (roster legality + ownership). */
  selectionFailures: z.number().int().nonnegative(),
  legalityFailures: z.number().int().nonnegative(),
  roleCoverageFailures: z.number().int().nonnegative(),
  rotationFailures: z.number().int().nonnegative(),
  /** M2.4: pool-legality failures (pool size, selections, anchor counts). */
  poolFailures: z.number().int().nonnegative(),
  /** M2.4: anchor-record failures (priority role, recorded score/threshold). */
  anchorFailures: z.number().int().nonnegative(),
  /** M2.4: anchor tier failures (anchor not elite in its qualifying role). */
  tierFailures: z.number().int().nonnegative(),
  /** M2.4: exact-version duplicates across pools or across rosters. */
  exclusivityFailures: z.number().int().nonnegative(),
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

/** Band distribution entry with the M2.4 tier shares. */
const bandDistributionEntrySchema = distributionEntrySchema.extend({
  eliteShare: z.number().min(0).max(1),
  strongShare: z.number().min(0).max(1),
  usefulShare: z.number().min(0).max(1),
});

/** Season Run AI roster calibration report (M2.1, M2.4 roster-generation-v2). */
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
    contender: bandDistributionEntrySchema,
    playoff: bandDistributionEntrySchema,
    average: bandDistributionEntrySchema,
    weaker: bandDistributionEntrySchema,
  }),
  identities: z.record(z.string().min(1), distributionEntrySchema),
  /** M2.4 measured cohort facts (mirror the targets artifact `measured`). */
  measured: z.object({
    anchorFulfillment: z.number().min(0).max(1),
    extraEliteRate: z.number().min(0).max(1),
    /** Band-probability-weighted expectation of the extra-elite rate. */
    extraEliteExpected: z.number().min(0).max(1),
    superTeamIncidence: z.number().min(0).max(1),
    poolLegalityFailures: z.number().int().nonnegative(),
    selectionFailures: z.number().int().nonnegative(),
    generationFailures: z.number().int().nonnegative(),
    orderInvarianceFailures: z.number().int().nonnegative(),
  }),
  gates: z.object({
    orderedBandMedians: z.boolean(),
    quotas: z.boolean(),
    roleCoverage: z.boolean(),
    identities: z.boolean(),
    poolLegality: z.boolean(),
    selectionLegality: z.boolean(),
    failureRate: z.boolean(),
    minBandSeparation: z.boolean(),
    anchorFulfillment: z.boolean(),
    extraEliteWithinTolerance: z.boolean(),
    superTeamIncidence: z.boolean(),
    orderInvariance: z.boolean(),
    heldOutPassShare: z.number().min(0).max(1),
    heldOutPass: z.boolean(),
  }),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  /** True in --validate mode (the artifact is never rewritten). */
  validateOnly: z.boolean(),
  pass: z.boolean(),
});
export type SeasonRostersCalibrateReport = z.infer<typeof seasonRostersCalibrateReportSchema>;

/** M2.3.5 `season draft calibrate` report payload. */
export const seasonDraftCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season draft calibrate'),
  calibrationSeeds: z.number().int().positive(),
  validationSeeds: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  /** Distinct playerVersionIds across all ten offers, per draft. */
  variety: distributionEntrySchema,
  /** Minimum selectable cards across the ten offers, per draft. */
  minSafePerOffer: z.number().int().nonnegative(),
  /** Share of drafts where every offer had >= SEASON_DRAFT_SAFE_MINIMUM safe cards. */
  safeAvailabilityShare: z.number().min(0).max(1),
  /** Share of offers whose selectable cards cover all three position groups. */
  selectableGroupCoverageShare: z.number().min(0).max(1),
  /** Drafts with an exact-version duplicate across offers+picks. */
  duplicateDrafts: z.number().int().nonnegative(),
  /** Drafts the pick policy dead-ended (NO_FEASIBLE_GLOBAL_OFFER). */
  draftFailures: z.number().int().nonnegative(),
  /** AI generation failures across the whole cohort. */
  generationFailures: z.number().int().nonnegative(),
  bands: z.object({
    contender: distributionEntrySchema,
    playoff: distributionEntrySchema,
    average: distributionEntrySchema,
    weaker: distributionEntrySchema,
  }),
  gates: z.object({
    minSafe: z.boolean(),
    zeroDuplicates: z.boolean(),
    zeroDraftFailures: z.boolean(),
    zeroGenerationFailures: z.boolean(),
    selectableGroupCoverage: z.boolean(),
    heldOutVarietyPassShare: z.number().min(0).max(1),
    heldOutVarietyPass: z.boolean(),
    heldOutSafePassShare: z.number().min(0).max(1),
    heldOutSafePass: z.boolean(),
    heldOutCoveragePassShare: z.number().min(0).max(1),
    heldOutCoveragePass: z.boolean(),
    heldOutStrengthPassShare: z.number().min(0).max(1),
    heldOutStrengthPass: z.boolean(),
  }),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonDraftCalibrateReport = z.infer<typeof seasonDraftCalibrateReportSchema>;

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

/**
 * M2.3 `season block simulate` / `season block audit` report payloads
 * (spec/2.0/02, spec/2.0/07).
 */
export const seasonBlockSimulateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season block simulate'),
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  expectedRevision: z.number().int().nonnegative(),
  rotationDigest: z.string().regex(/^[0-9a-f]{32}$/),
  completedRounds: z.number().int().min(0).max(82),
  summaryCount: z.number().int().min(1).max(150),
  retainedDetailCount: z.number().int().min(0).max(10),
  /** M2.5: the locked block objective (null when none was selected). */
  objectiveId: seasonObjectiveIdSchema.nullable(),
  /** M2.5: post-block run state chain facts (candidate/deriveSeasonPostBlockState). */
  stateRevision: z.number().int().nonnegative(),
  stateDigest: z.string().regex(/^[0-9a-f]{32}$/),
  digest: z.string().regex(/^[0-9a-f]{32}$/),
  durationMs: z.number().nonnegative(),
  auditFailures: z.array(z.string()),
  rejection: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonBlockSimulateReport = z.infer<typeof seasonBlockSimulateReportSchema>;

export const seasonBlockAuditReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season block audit'),
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),
  digest: z.string().regex(/^[0-9a-f]{32}$/),
  recomputedDigest: z.string().regex(/^[0-9a-f]{32}$/),
  auditFailures: z.array(z.string()),
  pass: z.boolean(),
});
export type SeasonBlockAuditReport = z.infer<typeof seasonBlockAuditReportSchema>;

/** M2.3 `season full simulate` report payload. */
export const seasonFullSimulateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season full simulate'),
  runId: z.string().min(1).max(64),
  blockDigests: z
    .array(
      z.object({
        blockIndex: z.number().int().min(0).max(8),
        digest: z.string().regex(/^[0-9a-f]{32}$/),
        durationMs: z.number().nonnegative(),
      }),
    )
    .length(9),
  finalDigest: z.string().regex(/^[0-9a-f]{32}$/),
  totalDurationMs: z.number().nonnegative(),
  summaries: z.number().int().positive(),
  /** M2.5: final post-block run state chain facts. */
  stateRevision: z.number().int().nonnegative(),
  stateDigest: z.string().regex(/^[0-9a-f]{32}$/),
  /** M2.5: every block's expected revision/digest equals the previous post-block facts. */
  stateChainContinuity: z.boolean(),
  /** M2.5: injuries recorded by the final health state (health/trades/influence audit facts). */
  finalInjuryCount: z.number().int().nonnegative(),
  /** M2.5: transaction entries recorded by the final run state. */
  finalTransactionCount: z.number().int().nonnegative(),
  /** M2.5: trade windows opened during the season (blocks 2/4/5). */
  tradeWindowsOpened: z.number().int().nonnegative(),
  auditFailures: z.array(z.string()),
  pass: z.boolean(),
});
export type SeasonFullSimulateReport = z.infer<typeof seasonFullSimulateReportSchema>;

/** M2.3 `season benchmark` report payloads. */
export const seasonBenchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.enum([
    'season benchmark block',
    'season benchmark full',
    'season benchmark determinism',
    'season benchmark persistence',
  ]),
  runId: z.string().min(1).max(64),
  durationMs: z.number().nonnegative(),
  budgetMs: z.number().nullable(),
  withinBudget: z.boolean().nullable(),
  digest: z.string().nullable(),
  identicalDigests: z.boolean().nullable(),
  perBlock: z
    .array(
      z.object({
        blockIndex: z.number().int().min(0).max(8),
        digest: z.string().regex(/^[0-9a-f]{32}$/),
        durationMs: z.number().nonnegative(),
      }),
    )
    .optional(),
  persistence: z.unknown().nullable(),
  auditFailures: z.array(z.string()),
  outPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonBenchmarkReport = z.infer<typeof seasonBenchmarkReportSchema>;

/** M2.3 `season home-court calibrate` report payload. */
export const seasonHomeCourtCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season home-court calibrate'),
  profileVersion: z.literal('season-home-court-v1'),
  constants: z.object({
    homeDefensiveCommunication: z.number().min(0).max(1),
    awayTurnoverPressure: z.number().min(0).max(1),
  }),
  targetHomeWinRate: z.literal(0.575),
  calibrationSeedCount: z.number().int().nonnegative(),
  validationSeedCount: z.number().int().nonnegative(),
  neutralHomeWinRate: z.number().min(0).max(1),
  achievedHomeWinRate: z.number().min(0).max(1),
  gamesSimulated: z.number().int().positive(),
  durationMs: z.number().nonnegative(),
  gates: z.object({
    neutralBaseline: z.boolean(),
    withinTolerance: z.boolean(),
    possessionStable: z.boolean(),
    monotonic: z.boolean(),
  }),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  pass: z.boolean(),
});
export type SeasonHomeCourtCalibrateReport = z.infer<typeof seasonHomeCourtCalibrateReportSchema>;

/** M2.4 `season effects sensitivity` report payload. */
export const seasonEffectsSensitivityReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season effects sensitivity'),
  fixtureId: z.string().min(1),
  fatigueLevels: z.array(z.number().int().nonnegative()),
  rows: z.array(
    z.object({
      fatigueBp: z.number().int().nonnegative(),
      shooterDelta: z.number(),
      handlerDelta: z.number(),
      defenseDelta: z.number(),
      securityDelta: z.number(),
      assistDelta: z.number(),
      helpDelta: z.number(),
    }),
  ),
  durationMs: z.number().nonnegative(),
});
export type SeasonEffectsSensitivityReport = z.infer<typeof seasonEffectsSensitivityReportSchema>;

/** M2.4 `season effects distribution` report payload. */
export const seasonEffectsDistributionReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season effects distribution'),
  fixtureIds: z.array(z.string().min(1)),
  seedFrom: z.number().int().nonnegative(),
  seedTo: z.number().int().nonnegative(),
  gamesSimulated: z.number().int().nonnegative(),
  completedGames: z.number().int().nonnegative(),
  scoringDeltaMedian: z.number(),
  turnoverDeltaMedian: z.number(),
  assistDeltaMedian: z.number(),
  scoringWithinEnvelope: z.number().min(0).max(1),
  turnoverWithinEnvelope: z.number().min(0).max(1),
  assistWithinEnvelope: z.number().min(0).max(1),
  checkFailures: z.number().int().nonnegative(),
  determinismFailures: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type SeasonEffectsDistributionReport = z.infer<typeof seasonEffectsDistributionReportSchema>;

/** M2.4 `season effects roles` report payload. */
export const seasonEffectsRolesReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season effects roles'),
  rows: z.array(
    z.object({
      fixtureId: z.string().min(1),
      starterMedianFatigue: z.number().int().nonnegative(),
      benchMedianFatigue: z.number().int().nonnegative(),
    }),
  ),
  starterOrderingPass: z.boolean(),
  benchOrderingPass: z.boolean(),
  durationMs: z.number().nonnegative(),
});
export type SeasonEffectsRolesReport = z.infer<typeof seasonEffectsRolesReportSchema>;

/** M2.4 `season effects calibrate` report payload. */
export const seasonEffectsCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season effects calibrate'),
  targetsVersion: z.union([
    z.literal(SEASON_EFFECT_TARGETS_VERSION),
    z.literal(SEASON_EFFECT_TARGETS_LEGACY_VERSION),
  ]),
  calibrationSeedCount: z.number().int().nonnegative(),
  validationSeedCount: z.number().int().nonnegative(),
  calibrationGames: z.number().int().nonnegative(),
  heldOutGames: z.number().int().nonnegative(),
  calibrationScoringDeltaMedian: z.number(),
  calibrationTurnoverDeltaMedian: z.number(),
  calibrationAssistDeltaMedian: z.number(),
  heldOutWithinEnvelopeShare: z.number().min(0).max(1),
  stableUnitMedianBp: z.number().int().nonnegative(),
  shuffledUnitMedianBp: z.number().int().nonnegative(),
  chemistrySeparationBp: z.number().int(),
  gates: z.object({
    zeroFailures: z.boolean(),
    determinism: z.boolean(),
    productionEnvelopes: z.boolean(),
    heldOutPassShare: z.boolean(),
    rotationOrdering: z.boolean(),
    chemistrySeparation: z.boolean(),
    sensitivityMonotonic: z.boolean(),
  }),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});
export type SeasonEffectsCalibrateReport = z.infer<typeof seasonEffectsCalibrateReportSchema>;

/**
 * One evaluated M2.5 calibration gate (shared by the three M2.5 calibrate
 * report payloads). Three-state status mirrors `calibrationMetricSchema`;
 * a skipped gate is never reported as passing.
 */
export const seasonM25GateSchema = z.object({
  key: z.string().min(1).max(64),
  observed: z.number(),
  /** The frozen target value (informational for range/direction gates). */
  target: z.number(),
  /** Absolute tolerance around the target; null for range/direction gates. */
  tolerance: z.number().nullable(),
  /** Frozen inclusive range for range gates; null otherwise. */
  min: z.number().nullable(),
  max: z.number().nullable(),
  status: calibrationMetricStatusSchema,
  pass: z.boolean(),
  sample: z.number().int().nonnegative(),
  minimumSample: z.number().int().nonnegative(),
});
export type SeasonM25GateReport = z.infer<typeof seasonM25GateSchema>;

/**
 * M2.5 `season health calibrate` report payload (spec/2.0 M2.5, contract
 * §17): the frozen injury-model facts (injury-targets-v1) measured from the
 * season cohort (blocks through the engine health pipeline) plus the
 * roll-level monotonicity/recurrence probes.
 */
export const seasonHealthCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season health calibrate'),
  targetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  calibrationSeeds: z.number().int().nonnegative(),
  validationSeeds: z.number().int().nonnegative(),
  seasonsSimulated: z.number().int().nonnegative(),
  exposures: z.number().int().nonnegative(),
  injuries: z.number().int().nonnegative(),
  /** Observed incidence across the calibration cohort, in basis points. */
  meanRiskBasisPoints: z.number().nonnegative(),
  severityShares: z.object({
    minor: z.number().min(0).max(1),
    moderate: z.number().min(0).max(1),
    major: z.number().min(0).max(1),
    seasonEnding: z.number().min(0).max(1),
  }),
  /** Observed recovery means (missed games) per severity, same-game returns excluded. */
  durationMeans: z.object({
    minor: z.number(),
    moderate: z.number(),
    major: z.number(),
  }),
  /** Share of minor-before-halftime injuries that returned same-game. */
  sameGameReturnRate: z.number().min(0).max(1),
  /** Window-incidence minus non-window incidence, in basis points. */
  recurrenceGapBp: z.number(),
  seasonEndingRate: z.number().min(0).max(1),
  /** Strong-team minus weak-team incidence, in basis points. */
  standingsGapBp: z.number(),
  monotonic: z.object({
    minutes: z.boolean(),
    fatigue: z.boolean(),
    durability: z.boolean(),
  }),
  gates: z.object({
    incidence: z.boolean(),
    severityDistribution: z.boolean(),
    durationMeans: z.boolean(),
    sameGameReturn: z.boolean(),
    recurrenceLift: z.boolean(),
    seasonEndingRate: z.boolean(),
    monotonicMinutes: z.boolean(),
    monotonicFatigue: z.boolean(),
    monotonicDurability: z.boolean(),
    standingsIndependent: z.boolean(),
    heldOut: z.boolean(),
  }),
  metrics: z.array(seasonM25GateSchema),
  skippedGates: z.array(z.string().min(1)),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});
export type SeasonHealthCalibrateReport = z.infer<typeof seasonHealthCalibrateReportSchema>;

/**
 * M2.5 `season trade calibrate` report payload (spec/2.0 M2.5, contract
 * §17): the frozen trade-window facts (trade-targets-v1) measured from
 * seasons that open windows at blocks 2/4/5 through the engine economy.
 */
export const seasonTradeCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season trade calibrate'),
  targetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  calibrationSeeds: z.number().int().nonnegative(),
  validationSeeds: z.number().int().nonnegative(),
  seasonsSimulated: z.number().int().nonnegative(),
  /** Mean accepted AI trades per season across the calibration cohort. */
  aiTradesMean: z.number(),
  aiTradesMin: z.number().int().nonnegative(),
  aiTradesMax: z.number().int().nonnegative(),
  /** Accepted trades across the cohort (AI activity; the human never acts). */
  acceptedTrades: z.number().int().nonnegative(),
  illegalRosterFailures: z.number().int().nonnegative(),
  duplicateOwnershipFailures: z.number().int().nonnegative(),
  valueBandFailures: z.number().int().nonnegative(),
  chemistryPairs: z.number().int().nonnegative(),
  chemistryPairFailures: z.number().int().nonnegative(),
  zeroStateNewPairFailures: z.number().int().nonnegative(),
  /** Same-seed window generation produced identical offers. */
  deterministicOffers: z.boolean(),
  gates: z.object({
    aiTradesPerSeason: z.boolean(),
    zeroIllegal: z.boolean(),
    zeroDuplicateOwnership: z.boolean(),
    valueBands: z.boolean(),
    deterministicOffers: z.boolean(),
    chemistryInvariants: z.boolean(),
    heldOut: z.boolean(),
  }),
  metrics: z.array(seasonM25GateSchema),
  skippedGates: z.array(z.string().min(1)),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});
export type SeasonTradeCalibrateReport = z.infer<typeof seasonTradeCalibrateReportSchema>;

/**
 * M2.5 `season influence calibrate` report payload (spec/2.0 M2.5, contract
 * §17): the frozen Influence economy facts (influence-targets-v1) measured
 * from seasons that open windows and select deterministic objectives.
 */
export const seasonInfluenceCalibrateReportSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('season influence calibrate'),
  targetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
  calibrationSeeds: z.number().int().nonnegative(),
  validationSeeds: z.number().int().nonnegative(),
  seasonsSimulated: z.number().int().nonnegative(),
  /** Franchise balance checks against the ledger (sum of applied deltas). */
  balanceChecks: z.number().int().nonnegative(),
  reconciliationFailures: z.number().int().nonnegative(),
  /** Balance != 2 + acceptedBlocks + net non-grant deltas (income identity). */
  incomeIdentityFailures: z.number().int().nonnegative(),
  /** Share of (franchise, block boundary) snapshots with balance < 0. */
  debtFrequency: z.number().min(0).max(1),
  debtBoundaries: z.number().int().nonnegative(),
  capViolations: z.number().int().nonnegative(),
  objectiveEvaluations: z.number().int().nonnegative(),
  objectiveSuccessRate: z.number().min(0).max(1).nullable(),
  /** extra-trade-offer spends / tracked window entries. */
  extraOfferSpendShare: z.number().min(0).max(1),
  extraOfferWindows: z.number().int().nonnegative(),
  /** risky-rehab spends / injuries recorded in the cohort. */
  rehabSpendShare: z.number().min(0).max(1),
  rehabInjuries: z.number().int().nonnegative(),
  gates: z.object({
    ledgerReconciliation: z.boolean(),
    incomeIdentity: z.boolean(),
    debtFrequency: z.boolean(),
    zeroCapViolations: z.boolean(),
    objectiveSuccessRate: z.boolean(),
    extraOfferSpendRate: z.boolean(),
    rehabSpendRate: z.boolean(),
    heldOut: z.boolean(),
  }),
  metrics: z.array(seasonM25GateSchema),
  skippedGates: z.array(z.string().min(1)),
  targetsWritten: z.boolean(),
  targetsPath: z.string().nullable(),
  durationMs: z.number().nonnegative(),
});
export type SeasonInfluenceCalibrateReport = z.infer<typeof seasonInfluenceCalibrateReportSchema>;
