import { z } from 'zod';

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

export const calibrationMetricSchema = z.object({
  key: z.string().min(1).max(64),
  target: z.number(),
  tolerance: z.number(),
  observed: z.number(),
  pass: z.boolean(),
  sample: z.number().int().nonnegative(),
});
export type CalibrationMetric = z.infer<typeof calibrationMetricSchema>;

export const calibrateRunReportSchema = z.object({
  schemaVersion: z.literal(1),
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
  poolCold: z.object({
    sampleCount: z.number().int().nonnegative(),
    medianMs: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    minMs: z.number().nonnegative(),
    maxMs: z.number().nonnegative(),
  }),
  poolCached: z.object({
    sampleCount: z.number().int().nonnegative(),
    medianMs: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    minMs: z.number().nonnegative(),
    maxMs: z.number().nonnegative(),
  }),
  singleGame: z.object({
    sampleCount: z.number().int().nonnegative(),
    medianMs: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    minMs: z.number().nonnegative(),
    maxMs: z.number().nonnegative(),
  }),
  challenge82: z.object({
    sampleCount: z.number().int().nonnegative(),
    medianMs: z.number().nonnegative(),
    p95Ms: z.number().nonnegative(),
    minMs: z.number().nonnegative(),
    maxMs: z.number().nonnegative(),
  }),
  heapUsedMb: z.number().nonnegative(),
  heap: z.object({
    beforeMb: z.number().nonnegative(),
    afterMb: z.number().nonnegative(),
    deltaMb: z.number(),
  }),
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
