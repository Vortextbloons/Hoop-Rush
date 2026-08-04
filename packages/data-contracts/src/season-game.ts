import { z } from 'zod';
import { franchiseIdSchema } from './ids.js';
import { SEASON_ROUND_COUNT } from './season-versions.js';

/**
 * One league game as it exists inside a Season Run: scheduled, finalized,
 * or forfeited (spec/2.0/02). The schedule artifact is the source of
 * identity and matchup; the run's game records add status and results. A
 * forfeited game's official result is 2-0, produces no player statistics,
 * and is labeled as a forfeit everywhere.
 */

export const seasonGameStatusSchema = z.enum(['scheduled', 'final', 'forfeit']);
export type SeasonGameStatus = z.infer<typeof seasonGameStatusSchema>;

export const seasonGameSchema = z
  .object({
    /** Stable game id from the committed schedule artifact. */
    gameId: z.string().regex(/^s[0-9]{6}$/),
    round: z.number().int().min(1).max(SEASON_ROUND_COUNT),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: seasonGameStatusSchema,
    /** Final scores; null while scheduled. */
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
    /** Only on forfeits: the team that failed to field five legal players. */
    forfeitLoserFranchiseId: franchiseIdSchema.nullable(),
  })
  .superRefine((game, ctx) => {
    if (game.status === 'scheduled') {
      if (
        game.homeScore !== null ||
        game.awayScore !== null ||
        game.forfeitLoserFranchiseId !== null
      ) {
        ctx.addIssue({ code: 'custom', message: 'scheduled game must carry no results' });
      }
    } else if (game.status === 'final') {
      if (game.homeScore === null || game.awayScore === null) {
        ctx.addIssue({ code: 'custom', message: 'final game must carry scores' });
      }
      if (game.forfeitLoserFranchiseId !== null) {
        ctx.addIssue({ code: 'custom', message: 'final game must not carry a forfeit loser' });
      }
    } else {
      const loser = game.forfeitLoserFranchiseId;
      if (loser === null) {
        ctx.addIssue({ code: 'custom', message: 'forfeit game must name the losing team' });
      } else if (loser !== game.homeFranchiseId && loser !== game.awayFranchiseId) {
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
