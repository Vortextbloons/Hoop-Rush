import { z } from 'zod';
import { eraIdSchema } from './ids.js';
import { historicalValueProvenanceSchema } from './provenance.js';
import { SHOT_ZONES } from './result.js';

/**
 * Versioned era simulation profile (spec/03, spec/06). One artifact per decade,
 * derived at build time from the decade's packaged source data. It carries both
 * the parameters the possession engine consumes (pace, shot mix, baseline
 * efficiency, turnover/rebound/assist/foul/free-throw rates) and the frozen
 * calibration targets and tolerances that `calibrate run` enforces.
 *
 * Targets start as a descriptive baseline report; once intentionally approved
 * they become gates and the profile version advances.
 */

type ZoneKeys = (typeof SHOT_ZONES)[number];

const zoneRecord = <T extends z.ZodType>(value: T): z.ZodObject<Record<ZoneKeys, T>> =>
  z.object(Object.fromEntries(SHOT_ZONES.map((zone) => [zone, value])) as Record<ZoneKeys, T>);

export const eraZoneMixSchema = zoneRecord(z.number().min(0).max(1));
export type EraZoneMix = z.infer<typeof eraZoneMixSchema>;

/** Simulation parameters derived from the decade's source data (spec/03 pace,
 * shot mix, baseline efficiency, turnover, rebound, assist, foul, free-throw). */
export const eraSimulationParametersSchema = z.object({
  /** Possessions per 48 minutes (team-possession rate). */
  pace: z.number().positive().max(130),
  /** Three-point attempts as a share of total field-goal attempts. */
  league3PARate: z.number().min(0).max(0.6),
  /** League true-shooting percentage. */
  leagueTsPct: z.number().min(0).max(1),
  /** League free throws attempted per field-goal attempt. */
  leagueFtaPerFga: z.number().min(0).max(0.6),
  /** League free-throw percentage. */
  leagueFtPct: z.number().min(0).max(1),
  /** Team turnovers per offensive possession. */
  turnoverPerPossession: z.number().min(0).max(0.4),
  /** Share of turnovers credited as opponent steals. */
  stealShareOfTurnovers: z.number().min(0).max(1),
  /** Team offensive rebounds per available defensive rebound. */
  offensiveReboundRate: z.number().min(0).max(0.6),
  /** Assists per made field goal. */
  assistRate: z.number().min(0).max(1),
  /** Team personal fouls per defensive possession. */
  foulsPerPossession: z.number().min(0).max(0.6),
  /** Share of personal fouls that are shooting fouls. */
  shootingFoulShare: z.number().min(0).max(1),
  /**
   * Population-mean anchor ratings (0-100) from the packaged pool: a player at
   * the anchor converts at the league rate, and deviations move outcomes. This
   * keeps team-wide rating differences sensitive while preserving the league
   * target at the population mean.
   */
  freeThrowAnchorRating: z.number().int().min(0).max(100),
  assistAnchorRating: z.number().int().min(0).max(100),
  /** League field-goal attempt share by zone (era shot mix). */
  zoneMix: eraZoneMixSchema,
  /** Descriptive source of the packaged values, e.g. "era-config + stints 1990-91..1999-00". */
  source: z.string().min(1).max(256),
  /**
   * Field-level provenance for estimated parameters (spec/12): estimated
   * inputs (e.g. shootingFoulShare before a dedicated source exists) carry
   * their own provenance instead of silently inheriting zero-filled
   * aggregates. Absent on fully derived profiles.
   */
  parameterProvenance: z
    .record(z.string().min(1).max(64), historicalValueProvenanceSchema)
    .optional(),
});
export type EraSimulationParameters = z.infer<typeof eraSimulationParametersSchema>;

/** One frozen gate: expected value plus absolute tolerance and minimum sample. */
export const calibrationTargetSchema = z.object({
  value: z.number(),
  tolerance: z.number().nonnegative(),
  /** Minimum observed sample for the gate to be evaluated. */
  minimumSample: z.number().int().nonnegative(),
});
export type CalibrationTarget = z.infer<typeof calibrationTargetSchema>;

/** Frozen calibration gates for the era's baseline distribution (spec/06). */
export const eraCalibrationTargetsSchema = z.object({
  possessionsPerGame: calibrationTargetSchema,
  pointsPerGame: calibrationTargetSchema,
  offensiveRating: calibrationTargetSchema,
  fieldGoalPct: calibrationTargetSchema,
  efgPct: calibrationTargetSchema,
  tsPct: calibrationTargetSchema,
  threePointRate: calibrationTargetSchema,
  threePointPct: calibrationTargetSchema,
  freeThrowsAttemptedPerGame: calibrationTargetSchema,
  freeThrowPct: calibrationTargetSchema,
  turnoversPerGame: calibrationTargetSchema,
  turnoversPerPossession: calibrationTargetSchema,
  offensiveReboundsPerGame: calibrationTargetSchema,
  offensiveReboundRate: calibrationTargetSchema,
  assistsPerGame: calibrationTargetSchema,
  assistRate: calibrationTargetSchema,
  personalFoulsPerGame: calibrationTargetSchema,
  zoneMix: zoneRecord(calibrationTargetSchema),
  /** Share of games decided by 5 points or fewer. */
  closeGameRate: calibrationTargetSchema,
  /** Share of games decided by 20+ points. */
  blowoutRate: calibrationTargetSchema,
  /** Share of games reaching overtime. */
  overtimeRate: calibrationTargetSchema,
  /** Win rate of the stronger lineup in strong-vs-weak fixtures. */
  strongVsWeakWinRate: calibrationTargetSchema,
  /** Win rate of the home side in equal-lineup fixtures (neutral site: ~0.5). */
  equalLineupHomeWinRate: calibrationTargetSchema,
  /**
   * Player-role gates measured on the `roles` fixture (spec/06). Keys use
   * slot indices, e.g. `usageShare.0` (primary creator at G), so the frozen
   * era targets pin role behavior: usage hierarchy, three-point and
   * free-throw rates, assist conversion, and rebound percentages. Empty
   * until an era profile has been remeasured and approved.
   */
  playerRoles: z
    .array(
      z.object({
        key: z.string().min(1).max(64),
        target: calibrationTargetSchema,
      }),
    )
    .default([]),
});
export type EraCalibrationTargets = z.infer<typeof eraCalibrationTargetsSchema>;

export const eraSimulationProfileSchema = z.object({
  schemaVersion: z.literal(1),
  eraId: eraIdSchema,
  /** Advances whenever parameters or frozen targets change. */
  profileVersion: z.string().min(1).max(64),
  dataVersion: z.string().min(1).max(64),
  /** Season keys whose packaged data produced this profile. */
  seasons: z.array(z.string()).min(1),
  /** Baseline distribution report that froze the targets (path or description). */
  baselineReport: z.string().min(1).max(256),
  parameters: eraSimulationParametersSchema,
  targets: eraCalibrationTargetsSchema,
});
export type EraSimulationProfile = z.infer<typeof eraSimulationProfileSchema>;
