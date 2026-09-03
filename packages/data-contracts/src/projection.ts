import { z } from 'zod';
import type { EraSimulationProfile } from './era-sim-profile.ts';
import { contentHashSchema, eraIdSchema, playerIdSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { PROJECTION_MODEL_VERSION, PROJECTION_SCHEMA_VERSION, PROJECTION_TARGETS_VERSION, } from './season-versions.ts';
import type { SimulationPlayer } from './simulation.ts';
import { simulationPlayerSchema } from './simulation.ts';
export const PROJECTION_SLOTS = ['G1', 'G2', 'F1', 'F2', 'C'] as const;
export const projectionSlotSchema = z.enum(PROJECTION_SLOTS);
export type ProjectionSlot = z.infer<typeof projectionSlotSchema>;
export const PROJECTION_MATCHUP_ARCHETYPES = [
    'neutral',
    'perimeter',
    'interior',
    'pressure',
    'size-switch',
] as const;
export const projectionMatchupArchetypeSchema = z.enum(PROJECTION_MATCHUP_ARCHETYPES);
export type ProjectionMatchupArchetype = z.infer<typeof projectionMatchupArchetypeSchema>;
export const projectionReferenceFiveSchema = z.object({
    referenceId: z.string().min(1).max(64),
    archetype: projectionMatchupArchetypeSchema,
    eraId: eraIdSchema,
    referenceHash: contentHashSchema,
    players: z.tuple([
        simulationPlayerSchema,
        simulationPlayerSchema,
        simulationPlayerSchema,
        simulationPlayerSchema,
        simulationPlayerSchema,
    ]),
});
export type ProjectionReferenceFive = z.infer<typeof projectionReferenceFiveSchema>;
export const projectionComponentScaleSchema = z.object({
    baseline: z.number(),
    perPoint: z.number().positive(),
    min: z.number().min(0).max(100),
    max: z.number().min(0).max(100),
    higherIsBetter: z.boolean(),
});
export type ProjectionComponentScale = z.infer<typeof projectionComponentScaleSchema>;
export const projectionWeaknessSeveritySchema = z.enum(['critical', 'major', 'minor']);
export type ProjectionWeaknessSeverity = z.infer<typeof projectionWeaknessSeveritySchema>;
export const projectionWeaknessSchema = z.object({
    code: z.string().min(1).max(64),
    severity: projectionWeaknessSeveritySchema,
    threshold: z.number(),
    value: z.number(),
    evidence: z.array(z.string().min(1)).min(1),
});
export type ProjectionWeakness = z.infer<typeof projectionWeaknessSchema>;
export const projectionWeaknessPolicySchema = z.object({
    code: z.string().min(1).max(64),
    severity: projectionWeaknessSeveritySchema,
    threshold: z.number(),
    weight: z.number().min(0),
    minSide: z.boolean(),
    message: z.string().min(1).max(256),
});
export type ProjectionWeaknessPolicy = z.infer<typeof projectionWeaknessPolicySchema>;
export const projectionSearchPolicySchema = z.object({
    seedNamespace: z.string().min(1).max(64),
    partialBeamsPerLens: z.number().int().positive(),
    completeCandidates: z.number().int().positive(),
    startingFives: z.number().int().positive(),
    closingFives: z.number().int().positive(),
    benchHierarchies: z.number().int().positive(),
    minuteTemplates: z.number().int().positive(),
    singleRemovals: z.literal('all'),
    pairRemovals: z.number().int().positive(),
    nodeBudgets: z.object({
        partial: z.number().int().positive(),
        complete: z.number().int().positive(),
        rotation: z.number().int().positive(),
    }),
    closeScenarioWeight: z.number().min(0).max(1),
});
export type ProjectionSearchPolicy = z.infer<typeof projectionSearchPolicySchema>;
export const projectionMonotonicGateSchema = z.object({
    code: z.string().min(1).max(64),
    driver: z.string().min(1).max(64),
    output: z.string().min(1).max(64),
    description: z.string().min(1).max(256),
});
export type ProjectionMonotonicGate = z.infer<typeof projectionMonotonicGateSchema>;
export const projectionTargetsSchema = z.object({
    schemaVersion: z.literal(1),
    targetsVersion: z.literal(PROJECTION_TARGETS_VERSION),
    cohorts: z.object({
        calibrationLineups: z.number().int().positive(),
        validationLineups: z.number().int().positive(),
        heldOutLineups: z.number().int().positive(),
        gamesPerLineup: z.number().int().positive(),
        calibrationSeedFrom: seedSchema,
        calibrationSeedTo: seedSchema,
        validationSeedFrom: seedSchema,
        validationSeedTo: seedSchema,
        heldOutSeedFrom: seedSchema,
        heldOutSeedTo: seedSchema,
    }),
    gates: z.object({
        offensiveRatingMaeMax: z.number().positive(),
        defensiveRatingMaeMax: z.number().positive(),
        netRatingMaeMax: z.number().positive(),
        netRatingBiasMax: z.number().positive(),
        rankCorrelationMin: z.number().min(-1).max(1),
        pairwiseOrderingAccuracyMin: z.number().min(0).max(1),
        monotonicPassShareMin: z.number().min(0).max(1),
        heldOutPassShare: z.number().min(0).max(1),
    }),
    measured: z.object({
        offensiveRatingMae: z.number().nonnegative(),
        defensiveRatingMae: z.number().nonnegative(),
        netRatingMae: z.number().nonnegative(),
        netRatingBias: z.number(),
        rankCorrelation: z.number().min(-1).max(1),
        pairwiseOrderingAccuracy: z.number().min(0).max(1),
        monotonicFailures: z.number().int().nonnegative(),
        heldOutPassRate: z.number().min(0).max(1),
    }),
});
export type ProjectionTargets = z.infer<typeof projectionTargetsSchema>;
export const projectionCohortPolicySchema = z.object({
    calibrationGames: z.number().int().positive(),
    validationGames: z.number().int().positive(),
    heldOutGames: z.number().int().positive(),
    calibrationSeedFrom: seedSchema,
    calibrationSeedTo: seedSchema,
    validationSeedFrom: seedSchema,
    validationSeedTo: seedSchema,
    heldOutSeedFrom: seedSchema,
    heldOutSeedTo: seedSchema,
});
export type ProjectionCohortPolicy = z.infer<typeof projectionCohortPolicySchema>;
export const projectionModelArtifactSchema = z.object({
    schemaVersion: z.literal(1),
    modelVersion: z.literal(PROJECTION_MODEL_VERSION),
    dataVersion: z.string().min(1).max(64),
    ratingsVersion: z.string().min(1).max(64),
    eraProfileVersions: z.record(eraIdSchema, z.string().min(1).max(64)),
    references: z
        .record(eraIdSchema, z.object({
        neutral: projectionReferenceFiveSchema,
        archetypes: z
            .array(projectionReferenceFiveSchema)
            .min(PROJECTION_MATCHUP_ARCHETYPES.length - 1)
            .max(PROJECTION_MATCHUP_ARCHETYPES.length - 1),
    }))
        .refine((references) => Object.keys(references).length >= 1, {
        message: 'the model must carry at least one era reference set',
    }),
    scales: z.record(z.string().min(1).max(64), projectionComponentScaleSchema),
    componentWeights: z.record(z.string().min(1).max(64), z.number().min(0)),
    weights: z.object({
        basketballMean: z.literal(0.4),
        rotationMean: z.literal(0.35),
        robustnessMean: z.literal(0.25),
    }),
    weaknesses: z.array(projectionWeaknessPolicySchema),
    search: projectionSearchPolicySchema,
    cohorts: projectionCohortPolicySchema,
    monotonicGates: z.array(projectionMonotonicGateSchema).min(1),
});
export type ProjectionModelArtifact = z.infer<typeof projectionModelArtifactSchema>;
export const projectionLedgerSchema = z.object({
    possessions: z.literal(100),
    turnoverRate: z.number().min(0).max(1),
    nonShootingFoulRate: z.number().min(0).max(1),
    shotRate: z.number().min(0).max(2),
    fieldGoalAttempts: z.number().min(0).max(200),
    fieldGoalMakes: z.number().min(0).max(200),
    twoPointAttempts: z.number().min(0).max(200),
    twoPointMakes: z.number().min(0).max(200),
    threePointAttempts: z.number().min(0).max(200),
    threePointMakes: z.number().min(0).max(200),
    freeThrowAttempts: z.number().min(0).max(300),
    freeThrowMakes: z.number().min(0).max(300),
    fieldGoalPct: z.number().min(0).max(1),
    twoPointPct: z.number().min(0).max(1),
    threePointPct: z.number().min(0).max(1),
    effectiveFieldGoalPct: z.number().min(0).max(1),
    trueShootingPct: z.number().min(0).max(1),
    freeThrowRate: z.number().min(0).max(5),
    points: z.number().min(0).max(200),
    offensiveReboundRate: z.number().min(0).max(1),
    defensiveReboundRate: z.number().min(0).max(1),
    offensiveRebounds: z.number().min(0).max(200),
    defensiveRebounds: z.number().min(0).max(200),
    turnovers: z.number().min(0).max(100),
    assists: z.number().min(0).max(100),
    steals: z.number().min(0).max(100),
    blocks: z.number().min(0).max(100),
    fouls: z.number().min(0).max(100),
    secondChancePoints: z.number().min(0).max(100),
});
export type ProjectionLedger = z.infer<typeof projectionLedgerSchema>;
export const projectionTurnoverCausesSchema = z.object({
    stealShare: z.number().min(0).max(1),
    nonStealShare: z.number().min(0).max(1),
    expectedSteals: z.number().min(0).max(100),
    expectedOther: z.number().min(0).max(100),
});
export type ProjectionTurnoverCauses = z.infer<typeof projectionTurnoverCausesSchema>;
export const projectionSpacingSchema = z.object({
    score: z.number().min(0).max(100),
    raw: z.number(),
    shotQualityLift: z.number().min(-0.1).max(0.1),
    expectedContest: z.number().min(-0.2).max(0.2),
});
export type ProjectionSpacing = z.infer<typeof projectionSpacingSchema>;
export const projectionCreationSchema = z.object({
    score: z.number().min(0).max(100),
    initiatorShare: z.record(projectionSlotSchema, z.number().min(0).max(1)),
    primaryShare: z.number().min(0).max(1),
    topTwoShare: z.number().min(0).max(1),
    actionDiversity: z.number().min(0).max(100),
    assistOpportunity: z.number().min(0).max(100),
    passOpportunity: z.number().min(0).max(100),
});
export type ProjectionCreation = z.infer<typeof projectionCreationSchema>;
export const projectionDefenseSchema = z.object({
    score: z.number().min(0).max(100),
    pressure: z.number(),
    perimeterCoverage: z.number().min(0).max(100),
    interiorCoverage: z.number().min(0).max(100),
    rimProtection: z.number().min(0).max(100),
    stealOpportunity: z.number().min(0).max(100),
    blockOpportunity: z.number().min(0).max(100),
    foulExposure: z.number().min(0).max(100),
    defensiveRebounding: z.number().min(0).max(100),
    expectedOpponentShotQuality: z.number(),
});
export type ProjectionDefense = z.infer<typeof projectionDefenseSchema>;
export const projectionActionDistributionSchema = z.record(z.string().min(1).max(32), z.number().min(0).max(1));
export type ProjectionActionDistribution = z.infer<typeof projectionActionDistributionSchema>;
export const projectionZoneDistributionSchema = z.record(z.string().min(1).max(32), z.number().min(0).max(1));
export type ProjectionZoneDistribution = z.infer<typeof projectionZoneDistributionSchema>;
export const projectionShooterDistributionSchema = z.record(projectionSlotSchema, z.number().min(0).max(1));
export type ProjectionShooterDistribution = z.infer<typeof projectionShooterDistributionSchema>;
export const projectionPlayerContributionSchema = z.object({
    slot: projectionSlotSchema,
    playerId: playerIdSchema,
    playerVersionId: playerVersionIdSchema.nullable(),
    displayName: z.string().min(1).max(96),
    usageShare: z.number().min(0).max(1),
    initiatorShare: z.number().min(0).max(1),
    creationShare: z.number().min(0).max(100),
    spacingContribution: z.number(),
    expectedShots: z.number().min(0).max(100),
    expectedMakes: z.number().min(0).max(100),
    expectedPoints: z.number().min(0).max(100),
    expectedAssists: z.number().min(0).max(100),
    expectedTurnovers: z.number().min(0).max(100),
    expectedRebounds: z.number().min(0).max(100),
    expectedFouls: z.number().min(0).max(100),
    defensiveContribution: z.number().min(0).max(100),
});
export type ProjectionPlayerContribution = z.infer<typeof projectionPlayerContributionSchema>;
export const projectionLineupEntrySchema = z.object({
    slot: projectionSlotSchema,
    playerId: playerIdSchema,
    playerVersionId: playerVersionIdSchema.nullable(),
    displayName: z.string().min(1).max(96),
    positions: z.array(z.string().min(1).max(8)),
});
export type ProjectionLineupEntry = z.infer<typeof projectionLineupEntrySchema>;
export const projectionSideSchema = z.object({
    ledger: projectionLedgerSchema,
    spacing: projectionSpacingSchema,
    creation: projectionCreationSchema,
    defense: projectionDefenseSchema,
    turnoverCauses: projectionTurnoverCausesSchema,
    actions: projectionActionDistributionSchema,
    zones: projectionZoneDistributionSchema,
    shooters: projectionShooterDistributionSchema,
    players: z.array(projectionPlayerContributionSchema).length(5),
});
export type ProjectionSide = z.infer<typeof projectionSideSchema>;
export const baseFiveProjectionSchema = z
    .object({
    schemaVersion: z.literal(1),
    modelVersion: z.literal(PROJECTION_MODEL_VERSION),
    referenceId: z.string().min(1).max(64),
    referenceHash: contentHashSchema,
    eraId: eraIdSchema,
    eraProfileVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    normalizationVersion: z.literal(PROJECTION_SCHEMA_VERSION),
    inputDigest: seasonCheckpointDigestSchema,
    digest: seasonCheckpointDigestSchema,
    lineup: z.array(projectionLineupEntrySchema).length(5),
    offense: projectionSideSchema,
    defense: projectionSideSchema,
    ratings: z.object({
        offensiveRating: z.number().min(0).max(200),
        defensiveRatingAllowed: z.number().min(0).max(200),
        netRating: z.number().min(-200).max(200),
        expectedPossessions: z.number().positive(),
    }),
    weaknesses: z.array(projectionWeaknessSchema),
})
    .superRefine((projection, ctx) => {
    if (projection.ratings.offensiveRating !== projection.offense.ledger.points) {
        ctx.addIssue({
            code: 'custom',
            message: 'offensiveRating must equal the offense ledger points',
        });
    }
    if (projection.ratings.defensiveRatingAllowed !== projection.defense.ledger.points) {
        ctx.addIssue({
            code: 'custom',
            message: 'defensiveRatingAllowed must equal the defense ledger points',
        });
    }
    if (projection.ratings.netRating !==
        projection.ratings.offensiveRating - projection.ratings.defensiveRatingAllowed) {
        ctx.addIssue({
            code: 'custom',
            message: 'netRating must equal offensiveRating minus defensiveRatingAllowed',
        });
    }
    const offensePlayers = projection.offense.players;
    const defensePlayers = projection.defense.players;
    for (let index = 0; index < 5; index += 1) {
        if (offensePlayers[index]?.slot !== defensePlayers[index]?.slot) {
            ctx.addIssue({ code: 'custom', message: 'offense and defense slots must align' });
            break;
        }
    }
});
export type BaseFiveProjection = z.infer<typeof baseFiveProjectionSchema>;
export interface ProjectionPlayerInput {
    player: SimulationPlayer;
    slot: ProjectionSlot;
}
export interface BaseFiveProjectionInput {
    lineup: readonly [
        ProjectionPlayerInput,
        ProjectionPlayerInput,
        ProjectionPlayerInput,
        ProjectionPlayerInput,
        ProjectionPlayerInput
    ];
    eraProfile: EraSimulationProfile;
    model: ProjectionModelArtifact;
    referenceId?: string;
}
