import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonCompactInjuryEventSchema } from './season-health.ts';
import { seasonGameSimulationResultSchema } from './season-game-simulation.ts';
import { seasonEffectsRollupSchema, seasonMechanismEvidenceSchema } from './season-effects.ts';
import { SEASON_GAME_SUMMARY_VERSION } from './season-versions.ts';
export const seasonCompactPlayerLineSchema = z.object({
    playerVersionId: playerVersionIdSchema,
    seconds: z.number().int().min(0),
    started: z.boolean().optional(),
    points: z.number().int().min(0),
    fieldGoalsMade: z.number().int().min(0),
    fieldGoalsAttempted: z.number().int().min(0),
    threePointersMade: z.number().int().min(0),
    threePointersAttempted: z.number().int().min(0),
    freeThrowsMade: z.number().int().min(0),
    freeThrowsAttempted: z.number().int().min(0),
    offensiveRebounds: z.number().int().min(0),
    defensiveRebounds: z.number().int().min(0),
    assists: z.number().int().min(0),
    steals: z.number().int().min(0),
    blocks: z.number().int().min(0),
    turnovers: z.number().int().min(0),
    fouls: z.number().int().min(0),
});
export type SeasonCompactPlayerLine = z.infer<typeof seasonCompactPlayerLineSchema>;
export const seasonTeamBoxSchema = z.object({
    franchiseId: franchiseIdSchema,
    points: z.number().int().nonnegative(),
    fieldGoalsMade: z.number().int().nonnegative(),
    fieldGoalsAttempted: z.number().int().nonnegative(),
    threePointersMade: z.number().int().nonnegative(),
    threePointersAttempted: z.number().int().nonnegative(),
    freeThrowsMade: z.number().int().nonnegative(),
    freeThrowsAttempted: z.number().int().nonnegative(),
    offensiveRebounds: z.number().int().nonnegative(),
    defensiveRebounds: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    turnovers: z.number().int().nonnegative(),
    fouls: z.number().int().nonnegative(),
    possessions: z.number().int().nonnegative(),
});
export type SeasonTeamBox = z.infer<typeof seasonTeamBoxSchema>;
export const seasonGameSummarySchema = z
    .object({
    schemaVersion: z.literal(1),
    summaryVersion: z.literal(SEASON_GAME_SUMMARY_VERSION),
    gameId: seasonGameIdSchema,
    round: z.number().int().min(1).max(82),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: z.enum(['final', 'forfeit']),
    overtimePeriods: z.number().int().min(0),
    homeScore: z.number().int().nonnegative(),
    awayScore: z.number().int().nonnegative(),
    forfeitLoserFranchiseId: franchiseIdSchema.nullable(),
    homeBox: seasonTeamBoxSchema,
    awayBox: seasonTeamBoxSchema,
    homePlayers: z.array(seasonCompactPlayerLineSchema),
    awayPlayers: z.array(seasonCompactPlayerLineSchema),
    effectsRollup: z.array(seasonEffectsRollupSchema).max(12).optional(),
    injuryEvents: z.array(seasonCompactInjuryEventSchema),
})
    .superRefine((summary, ctx) => {
    if (summary.status === 'forfeit') {
        if (summary.homeScore + summary.awayScore !== 2) {
            ctx.addIssue({ code: 'custom', message: 'forfeit summary must be an official 2-0 result' });
        }
        const loser = summary.forfeitLoserFranchiseId;
        if (loser === null) {
            ctx.addIssue({ code: 'custom', message: 'forfeit summary must name the losing team' });
        }
        else if (loser !== summary.homeFranchiseId && loser !== summary.awayFranchiseId) {
            ctx.addIssue({ code: 'custom', message: 'forfeit loser must be one of the two teams' });
        }
        if (summary.overtimePeriods !== 0) {
            ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no overtime' });
        }
        if (summary.homePlayers.length !== 0 || summary.awayPlayers.length !== 0) {
            ctx.addIssue({ code: 'custom', message: 'forfeit summary carries no player statistics' });
        }
    }
    else {
        if (summary.forfeitLoserFranchiseId !== null) {
            ctx.addIssue({ code: 'custom', message: 'final summary must not carry a forfeit loser' });
        }
        if (summary.homePlayers.length !== 10 || summary.awayPlayers.length !== 10) {
            ctx.addIssue({ code: 'custom', message: 'final summary must carry 10 lines per side' });
        }
    }
});
export type SeasonGameSummary = z.infer<typeof seasonGameSummarySchema>;
export const seasonRetainedGameDetailSchema = z.object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1).max(64),
    gameId: seasonGameIdSchema,
    round: z.number().int().min(1).max(82),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    result: seasonGameSimulationResultSchema,
    mechanismEvidence: z.array(seasonMechanismEvidenceSchema).max(12).optional(),
    injuryEvents: z.array(seasonCompactInjuryEventSchema),
});
export type SeasonRetainedGameDetail = z.infer<typeof seasonRetainedGameDetailSchema>;
