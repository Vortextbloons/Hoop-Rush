import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import { SEASON_ROUND_COUNT } from './season-versions.ts';
export const seasonGameStatusSchema = z.enum(['scheduled', 'final', 'forfeit']);
export type SeasonGameStatus = z.infer<typeof seasonGameStatusSchema>;
export const seasonGameSchema = z
    .object({
    gameId: seasonGameIdSchema,
    round: z.number().int().min(1).max(SEASON_ROUND_COUNT),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: seasonGameStatusSchema,
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
    forfeitLoserFranchiseId: franchiseIdSchema.nullable(),
})
    .superRefine((game, ctx) => {
    if (game.status === 'scheduled') {
        if (game.homeScore !== null ||
            game.awayScore !== null ||
            game.forfeitLoserFranchiseId !== null) {
            ctx.addIssue({ code: 'custom', message: 'scheduled game must carry no results' });
        }
    }
    else if (game.status === 'final') {
        if (game.homeScore === null || game.awayScore === null) {
            ctx.addIssue({ code: 'custom', message: 'final game must carry scores' });
        }
        if (game.forfeitLoserFranchiseId !== null) {
            ctx.addIssue({ code: 'custom', message: 'final game must not carry a forfeit loser' });
        }
    }
    else {
        const loser = game.forfeitLoserFranchiseId;
        if (loser === null) {
            ctx.addIssue({ code: 'custom', message: 'forfeit game must name the losing team' });
        }
        else if (loser !== game.homeFranchiseId && loser !== game.awayFranchiseId) {
            ctx.addIssue({ code: 'custom', message: 'forfeit loser must be one of the two teams' });
        }
        if (game.homeScore !== null || game.awayScore !== null) {
            ctx.addIssue({
                code: 'custom',
                message: 'forfeit game carries no scores (official result 2-0)',
            });
        }
    }
});
export type SeasonGame = z.infer<typeof seasonGameSchema>;
