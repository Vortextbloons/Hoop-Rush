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
