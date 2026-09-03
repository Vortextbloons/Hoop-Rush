import { z } from 'zod';
import { playerIdSchema, seedSchema } from './ids.ts';
import { positionUnionSchema } from './positions.ts';
import { eraSimulationProfileSchema } from './era-sim-profile.ts';
import { ratingProfileSchema } from './ratings-model.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { THREE_POINT_RECONSTRUCTION_VERSION } from './versions.ts';
export const REQUIRED_RATING_KEYS = [
    'insideScoring',
    'closeShot',
    'midrange',
    'threePoint',
    'freeThrow',
    'ballHandling',
    'passing',
    'offensiveIq',
    'offensiveRebound',
    'defensiveRebound',
    'perimeterDefense',
    'interiorDefense',
    'steal',
    'block',
    'defensiveIq',
    'speed',
    'strength',
    'vertical',
] as const;
export const simulationRatingsSchema = z
    .object({
    insideScoring: z.number().int().min(0).max(100),
    closeShot: z.number().int().min(0).max(100),
    midrange: z.number().int().min(0).max(100),
    threePoint: z.number().int().min(0).max(100),
    freeThrow: z.number().int().min(0).max(100),
    ballHandling: z.number().int().min(0).max(100),
    passing: z.number().int().min(0).max(100),
    offensiveIq: z.number().int().min(0).max(100),
    offensiveRebound: z.number().int().min(0).max(100),
    defensiveRebound: z.number().int().min(0).max(100),
    perimeterDefense: z.number().int().min(0).max(100),
    interiorDefense: z.number().int().min(0).max(100),
    steal: z.number().int().min(0).max(100),
    block: z.number().int().min(0).max(100),
    defensiveIq: z.number().int().min(0).max(100),
    speed: z.number().int().min(0).max(100),
    strength: z.number().int().min(0).max(100),
    vertical: z.number().int().min(0).max(100),
})
    .strict();
export type SimulationRatings = z.infer<typeof simulationRatingsSchema>;
export const simulationTendenciesSchema = z
    .object({
    usageRate: z.number().min(0).max(100),
    passRate: z.number().min(0).max(100),
    shotRate: z.number().min(0).max(100),
    driveRate: z.number().min(0).max(100),
    postUpRate: z.number().min(0).max(100),
    rimFrequency: z.number().min(0).max(100),
    shortMidFrequency: z.number().min(0).max(100),
    longMidFrequency: z.number().min(0).max(100),
    cornerThreeFrequency: z.number().min(0).max(100),
    aboveBreakThreeFrequency: z.number().min(0).max(100),
    threePointRate: z.number().min(0).max(100),
    freeThrowRate: z.number().min(0).max(100),
    turnoverRate: z.number().min(0).max(100),
    isolationRate: z.number().min(0).max(100),
    pickAndRollBallHandlerRate: z.number().min(0).max(100),
    pickAndRollRollManRate: z.number().min(0).max(100),
    spotUpRate: z.number().min(0).max(100),
    transitionRate: z.number().min(0).max(100),
    cutRate: z.number().min(0).max(100),
    foulRate: z.number().min(0).max(100),
    stealAttemptRate: z.number().min(0).max(100),
    blockAttemptRate: z.number().min(0).max(100),
    crashOffensiveGlassRate: z.number().min(0).max(100),
})
    .strict();
export type SimulationTendencies = z.infer<typeof simulationTendenciesSchema>;
export const simulationAnchorsSchema = z.object({
    gamesPlayed: z.number().int().nonnegative(),
    minutesPerGame: z.number().min(0).max(60),
    pointsPerGame: z.number().nonnegative(),
    reboundsPerGame: z.number().nonnegative(),
    offensiveReboundsPerGame: z.number().nonnegative(),
    defensiveReboundsPerGame: z.number().nonnegative(),
    assistsPerGame: z.number().nonnegative(),
    stealsPerGame: z.number().nonnegative(),
    blocksPerGame: z.number().nonnegative(),
    turnoversPerGame: z.number().nonnegative(),
    fieldGoalPct: z.number().min(0).max(1),
    threePointPct: z.number().min(0).max(1).nullable(),
    freeThrowPct: z.number().min(0).max(1),
    threePointAttemptRate: z.number().min(0).max(1).nullable(),
    freeThrowAttemptRate: z.number().min(0).max(1),
    threePointPctShrunk: z.number().min(0).max(1).nullable().optional(),
    freeThrowPctShrunk: z.number().min(0).max(1).nullable().optional(),
    threePointPctPrior: z.number().min(0).max(1).nullable().optional(),
    freeThrowPctPrior: z.number().min(0).max(1).nullable().optional(),
    rateShrinkAttempts: z.number().int().nonnegative().optional(),
});
export type SimulationAnchors = z.infer<typeof simulationAnchorsSchema>;
export const reconstructedThreePointProfileSchema = z.object({
    modelVersion: z.literal(THREE_POINT_RECONSTRUCTION_VERSION),
    accuracyConservative: z.number().min(0).max(1),
    accuracyMean: z.number().min(0).max(1),
    accuracyStdDev: z.number().min(0).max(0.5),
    attemptRateConservative: z.number().min(0).max(1),
    attemptRateMean: z.number().min(0).max(1),
    attemptRateStdDev: z.number().min(0).max(0.5),
    confidence: z.literal('high').or(z.literal('medium')).or(z.literal('low')),
    floor: z.number().min(0).max(1),
    zoneFloors: z.object({
        cornerThree: z.number().min(0).max(1),
        aboveBreakThree: z.number().min(0).max(1),
    }),
    evidence: z.object({
        missingFeatures: z.number().int().nonnegative(),
        sourceFields: z.array(z.string().min(1).max(64)),
    }),
});
export type ReconstructedThreePointProfile = z.infer<typeof reconstructedThreePointProfileSchema>;
export const simulationPlayerSchema = z.object({
    playerId: playerIdSchema,
    playerVersionId: playerVersionIdSchema.optional(),
    displayName: z.string().min(1).max(96),
    positions: positionUnionSchema,
    heightInches: z.number().int().min(60).max(96).nullable(),
    weightLbs: z.number().int().min(120).max(400).nullable(),
    ratings: simulationRatingsSchema,
    tendencies: simulationTendenciesSchema,
    anchors: simulationAnchorsSchema.optional(),
    reconstructedThreePoint: reconstructedThreePointProfileSchema.optional(),
    overall: z.number().int().min(0).max(100).optional(),
    ratingProfile: ratingProfileSchema.optional(),
});
export type SimulationPlayer = z.infer<typeof simulationPlayerSchema>;
export const simulationTeamSchema = z.object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    players: z.array(simulationPlayerSchema).length(5),
});
export type SimulationTeam = z.infer<typeof simulationTeamSchema>;
export const gameSimulationInputSchema = z.object({
    schemaVersion: z.literal(2),
    seed: seedSchema,
    gameNumber: z.number().int().min(1).max(82),
    dataVersion: z.string().min(1).max(64),
    profile: eraSimulationProfileSchema,
    home: simulationTeamSchema,
    away: simulationTeamSchema,
});
export type GameSimulationInput = z.infer<typeof gameSimulationInputSchema>;
