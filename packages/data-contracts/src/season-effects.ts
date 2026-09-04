import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_STAMINA_LEGACY_VERSION, SEASON_STAMINA_VERSION } from './season-versions.ts';
export const seasonMechanismSchema = z.enum([
    'shooter-fatigue',
    'handler-fatigue',
    'defensive-unit-fatigue',
    'turnover-security',
    'assist-conversion',
    'help-defense',
]);
export type SeasonMechanism = z.infer<typeof seasonMechanismSchema>;
export const seasonEffectsSideSchema = z.enum(['home', 'away']);
export type SeasonEffectsSide = z.infer<typeof seasonEffectsSideSchema>;
export const seasonStaminaInputSchema = z.object({
    schemaVersion: z.literal(1),
    playerVersionId: playerVersionIdSchema,
    rating: z.number().int().min(45).max(95),
    historicalMpg: z.number().min(0).max(60),
    derivationVersion: z.union([
        z.literal(SEASON_STAMINA_VERSION),
        z.literal(SEASON_STAMINA_LEGACY_VERSION),
    ]),
});
export type SeasonStaminaInput = z.infer<typeof seasonStaminaInputSchema>;
export const seasonPlayerLoadStateSchema = z.object({
    playerVersionId: playerVersionIdSchema,
    fatigueBasisPoints: z.number().int().min(0).max(10000),
    recentLoadBasisPoints: z.number().int().min(0).max(10000),
    lastCompletedRound: z.number().int().min(0).max(82),
});
export type SeasonPlayerLoadState = z.infer<typeof seasonPlayerLoadStateSchema>;
export const seasonPairChemistryStateSchema = z
    .object({
    a: playerVersionIdSchema,
    b: playerVersionIdSchema,
    sharedPossessions: z.number().int().min(0).max(10000000),
})
    .superRefine((pair, ctx) => {
    if (pair.a >= pair.b) {
        ctx.addIssue({
            code: 'custom',
            message: `pair is not canonical (a < b): ${pair.a} >= ${pair.b}`,
        });
    }
});
export type SeasonPairChemistryState = z.infer<typeof seasonPairChemistryStateSchema>;
export const seasonArchivedPairChemistryStateSchema = z
    .object({
    franchiseId: franchiseIdSchema,
    a: playerVersionIdSchema,
    b: playerVersionIdSchema,
    sharedPossessions: z.number().int().min(0).max(10000000),
})
    .superRefine((pair, ctx) => {
    if (pair.a >= pair.b) {
        ctx.addIssue({
            code: 'custom',
            message: `archived pair is not canonical (a < b): ${pair.a} >= ${pair.b}`,
        });
    }
});
export type SeasonArchivedPairChemistryState = z.infer<typeof seasonArchivedPairChemistryStateSchema>;
export const seasonEffectsStateSchema = z
    .object({
    schemaVersion: z.literal(2),
    playerStates: z.array(seasonPlayerLoadStateSchema).length(300),
    inactivePlayerStates: z.array(seasonPlayerLoadStateSchema).max(150),
    pairStates: z.array(seasonPairChemistryStateSchema).length(1350),
    archivedPairs: z.array(seasonArchivedPairChemistryStateSchema).max(1350),
})
    .superRefine((state, ctx) => {
    const players = new Set<string>();
    for (const player of state.playerStates) {
        if (players.has(player.playerVersionId)) {
            ctx.addIssue({
                code: 'custom',
                message: `duplicate player load state ${player.playerVersionId}`,
            });
        }
        players.add(player.playerVersionId);
    }
    const inactivePlayers = new Set<string>();
    for (const player of state.inactivePlayerStates) {
        if (inactivePlayers.has(player.playerVersionId)) {
            ctx.addIssue({
                code: 'custom',
                message: `duplicate inactive player load state ${player.playerVersionId}`,
            });
        }
        inactivePlayers.add(player.playerVersionId);
        if (players.has(player.playerVersionId)) {
            ctx.addIssue({
                code: 'custom',
                message: `player ${player.playerVersionId} appears both active and inactive`,
            });
        }
    }
    const pairs = new Set<string>();
    for (const pair of state.pairStates) {
        const key = `${pair.a}\u0000${pair.b}`;
        if (pairs.has(key)) {
            ctx.addIssue({ code: 'custom', message: `duplicate pair state ${key}` });
        }
        pairs.add(key);
        if (!players.has(pair.a) || !players.has(pair.b)) {
            ctx.addIssue({
                code: 'custom',
                message: `pair member is not an active rotation player: ${key}`,
            });
        }
        if (pair.a >= pair.b) {
            ctx.addIssue({ code: 'custom', message: `pair is not canonical: ${key}` });
        }
    }
    const archived = new Set<string>();
    for (const pair of state.archivedPairs) {
        const key = `${pair.franchiseId}\u0000${pair.a}\u0000${pair.b}`;
        if (archived.has(key)) {
            ctx.addIssue({ code: 'custom', message: `duplicate archived pair ${key}` });
        }
        archived.add(key);
        if (pair.a >= pair.b) {
            ctx.addIssue({ code: 'custom', message: `archived pair is not canonical: ${key}` });
        }
    }
});
export type SeasonEffectsState = z.infer<typeof seasonEffectsStateSchema>;
export const seasonMechanismEvidenceSchema = z.object({
    mechanism: seasonMechanismSchema,
    side: seasonEffectsSideSchema,
    opportunities: z.number().int().min(0).max(1000000),
    inputTotals: z.object({
        shooter: z.number().int().min(0).max(1000000000000),
        handler: z.number().int().min(0).max(1000000000000),
        defenseMean: z.number().int().min(0).max(1000000000000),
        unitChemistry: z.number().int().min(0).max(1000000000000),
    }),
    deltaTotals: z.number().int().min(-1000000000000).max(1000000000000),
    deltaMin: z.number().int().min(-1000000).max(1000000),
    deltaMax: z.number().int().min(-1000000).max(1000000),
});
export type SeasonMechanismEvidence = z.infer<typeof seasonMechanismEvidenceSchema>;
export const seasonGameEffectsTransitionSchema = z.object({
    schemaVersion: z.literal(1),
    pregamePlayerStates: z.array(seasonPlayerLoadStateSchema).length(300),
    postgamePlayerStates: z.array(seasonPlayerLoadStateSchema).length(300),
    pairIncrements: z
        .array(z.object({
        a: playerVersionIdSchema,
        b: playerVersionIdSchema,
        sharedPossessions: z.number().int().min(0).max(10000000),
    }))
        .max(1350),
    evidence: z.array(seasonMechanismEvidenceSchema).max(12),
});
export type SeasonGameEffectsTransition = z.infer<typeof seasonGameEffectsTransitionSchema>;
export const seasonEffectsRollupSchema = z.object({
    mechanism: seasonMechanismSchema,
    side: seasonEffectsSideSchema,
    opportunities: z.number().int().min(0).max(1000000),
    deltaTotal: z.number().int().min(-1000000000000).max(1000000000000),
});
export type SeasonEffectsRollup = z.infer<typeof seasonEffectsRollupSchema>;
