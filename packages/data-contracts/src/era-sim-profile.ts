import { z } from 'zod';
import { eraIdSchema } from './ids.ts';
import { historicalValueProvenanceSchema } from './provenance.ts';
import { SHOT_ZONES } from './result.ts';
type ZoneKeys = (typeof SHOT_ZONES)[number];
const zoneRecord = <T extends z.ZodType>(value: T): z.ZodObject<Record<ZoneKeys, T>> => z.object(Object.fromEntries(SHOT_ZONES.map((zone) => [zone, value])) as Record<ZoneKeys, T>);
export const eraZoneMixSchema = zoneRecord(z.number().min(0).max(1));
export type EraZoneMix = z.infer<typeof eraZoneMixSchema>;
export const eraSimulationParametersSchema = z.object({
    pace: z.number().positive().max(130),
    league3PARate: z.number().min(0).max(0.6),
    leagueTsPct: z.number().min(0).max(1),
    leagueFtaPerFga: z.number().min(0).max(0.6),
    leagueFtPct: z.number().min(0).max(1),
    turnoverPerPossession: z.number().min(0).max(0.4),
    stealShareOfTurnovers: z.number().min(0).max(1),
    offensiveReboundRate: z.number().min(0).max(0.6),
    assistRate: z.number().min(0).max(1),
    foulsPerPossession: z.number().min(0).max(0.6),
    shootingFoulShare: z.number().min(0).max(1),
    freeThrowAnchorRating: z.number().int().min(0).max(100),
    assistAnchorRating: z.number().int().min(0).max(100),
    zoneMix: eraZoneMixSchema,
    source: z.string().min(1).max(256),
    parameterProvenance: z
        .record(z.string().min(1).max(64), historicalValueProvenanceSchema)
        .optional(),
});
export type EraSimulationParameters = z.infer<typeof eraSimulationParametersSchema>;
export const calibrationTargetSchema = z.object({
    value: z.number(),
    tolerance: z.number().nonnegative(),
    minimumSample: z.number().int().nonnegative(),
});
export type CalibrationTarget = z.infer<typeof calibrationTargetSchema>;
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
    closeGameRate: calibrationTargetSchema,
    blowoutRate: calibrationTargetSchema,
    overtimeRate: calibrationTargetSchema,
    strongVsWeakWinRate: calibrationTargetSchema,
    equalLineupHomeWinRate: calibrationTargetSchema,
    playerRoles: z
        .array(z.object({
        key: z.string().min(1).max(64),
        target: calibrationTargetSchema,
    }))
        .default([]),
});
export type EraCalibrationTargets = z.infer<typeof eraCalibrationTargetsSchema>;
export const eraSimulationProfileSchema = z.object({
    schemaVersion: z.literal(1),
    eraId: eraIdSchema,
    profileVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    seasons: z.array(z.string()).min(1),
    baselineReport: z.string().min(1).max(256),
    parameters: eraSimulationParametersSchema,
    targets: eraCalibrationTargetsSchema,
});
export type EraSimulationProfile = z.infer<typeof eraSimulationProfileSchema>;
