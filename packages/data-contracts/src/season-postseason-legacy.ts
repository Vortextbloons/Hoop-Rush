import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { conferenceIdSchema } from './season-league.ts';
import { seasonGameStatusSchema } from './season-game.ts';
import { SEASON_POSTSEASON_LEGACY_VERSION } from './season-versions.ts';
export const playInGameIdV1Schema = z.enum(['seven-eight', 'nine-ten', 'final']);
export type PlayInGameIdV1 = z.infer<typeof playInGameIdV1Schema>;
export const playInGameV1Schema = z
    .object({
    gameId: playInGameIdV1Schema,
    status: seasonGameStatusSchema,
    homeFranchiseId: franchiseIdSchema.nullable(),
    awayFranchiseId: franchiseIdSchema.nullable(),
    winnerFranchiseId: franchiseIdSchema.nullable(),
    loserFranchiseId: franchiseIdSchema.nullable(),
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
})
    .superRefine((game, ctx) => {
    if (game.status === 'scheduled') {
        if (game.homeFranchiseId !== null ||
            game.awayFranchiseId !== null ||
            game.winnerFranchiseId !== null ||
            game.loserFranchiseId !== null ||
            game.homeScore !== null ||
            game.awayScore !== null) {
            ctx.addIssue({ code: 'custom', message: 'scheduled play-in game must carry no results' });
        }
        return;
    }
    if (game.homeFranchiseId === null || game.awayFranchiseId === null) {
        ctx.addIssue({ code: 'custom', message: 'played play-in game must name both teams' });
    }
    const teams = [game.homeFranchiseId, game.awayFranchiseId];
    if (game.winnerFranchiseId === null || !teams.includes(game.winnerFranchiseId)) {
        ctx.addIssue({
            code: 'custom',
            message: 'played play-in game must name a participating winner',
        });
    }
    if (game.status === 'final') {
        if (game.loserFranchiseId === null || !teams.includes(game.loserFranchiseId)) {
            ctx.addIssue({
                code: 'custom',
                message: 'final play-in game must name a participating loser',
            });
        }
        if (game.homeScore === null || game.awayScore === null) {
            ctx.addIssue({ code: 'custom', message: 'final play-in game must carry scores' });
        }
    }
    else if (game.homeScore !== null || game.awayScore !== null) {
        ctx.addIssue({ code: 'custom', message: 'forfeited play-in game carries no scores' });
    }
});
export type PlayInGameV1 = z.infer<typeof playInGameV1Schema>;
export const playInStateV1Schema = z.object({
    conference: conferenceIdSchema,
    ranking: z.array(franchiseIdSchema).length(10).nullable(),
    games: z.object({
        sevenEight: playInGameV1Schema,
        nineTen: playInGameV1Schema,
        final: playInGameV1Schema,
    }),
    playoffSeeds: z.array(franchiseIdSchema).length(8).nullable(),
});
export type PlayInStateV1 = z.infer<typeof playInStateV1Schema>;
export const playoffRoundV1Schema = z.enum([
    'first-round',
    'conference-semifinal',
    'conference-final',
    'finals',
]);
export type PlayoffRoundV1 = z.infer<typeof playoffRoundV1Schema>;
export const playoffSeriesGameV1Schema = z.object({
    gameNumber: z.number().int().min(1).max(7),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: seasonGameStatusSchema,
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
    winnerFranchiseId: franchiseIdSchema.nullable(),
});
export type PlayoffSeriesGameV1 = z.infer<typeof playoffSeriesGameV1Schema>;
const playoffSeriesBaseV1Schema = z.object({
    seriesId: z.string().min(1).max(64),
    round: playoffRoundV1Schema,
    conference: conferenceIdSchema.nullable(),
    higherSeed: z.number().int().min(1).max(8).nullable(),
    lowerSeed: z.number().int().min(1).max(8).nullable(),
    homeCourtFranchiseId: franchiseIdSchema.nullable(),
    challengerFranchiseId: franchiseIdSchema.nullable(),
    homeCourtWins: z.number().int().min(0).max(4),
    challengerWins: z.number().int().min(0).max(4),
    games: z.array(playoffSeriesGameV1Schema).max(7),
    winnerFranchiseId: franchiseIdSchema.nullable(),
});
export const playoffSeriesV1Schema = playoffSeriesBaseV1Schema.superRefine((series, ctx) => {
    if (series.games.length > 0 || series.winnerFranchiseId !== null) {
        if (series.homeCourtFranchiseId === null || series.challengerFranchiseId === null) {
            ctx.addIssue({ code: 'custom', message: 'started playoff series must name both teams' });
        }
    }
    if (series.games.length !== series.homeCourtWins + series.challengerWins) {
        ctx.addIssue({
            code: 'custom',
            message: 'series wins must equal played games (series stops immediately at four wins)',
        });
    }
    if (series.winnerFranchiseId !== null) {
        if (series.homeCourtWins !== 4 && series.challengerWins !== 4) {
            ctx.addIssue({ code: 'custom', message: 'series winner requires four wins' });
        }
        const teams = [series.homeCourtFranchiseId, series.challengerFranchiseId];
        if (!teams.includes(series.winnerFranchiseId)) {
            ctx.addIssue({ code: 'custom', message: 'series winner must be a participant' });
        }
    }
    else if (series.games.length === 7) {
        ctx.addIssue({ code: 'custom', message: 'a seven-game series must name a winner' });
    }
});
export type PlayoffSeriesV1 = z.infer<typeof playoffSeriesBaseV1Schema>;
export const playoffConferenceBracketV1Schema = z.object({
    conference: conferenceIdSchema,
    seeds: z.array(franchiseIdSchema).length(8),
    firstRound: z.array(playoffSeriesBaseV1Schema).length(4),
    semifinals: z.array(playoffSeriesBaseV1Schema).length(2),
    conferenceFinal: playoffSeriesBaseV1Schema,
});
export type PlayoffConferenceBracketV1 = z.infer<typeof playoffConferenceBracketV1Schema>;
export const playoffBracketV1Schema = z.object({
    schemaVersion: z.literal(1),
    postseasonVersion: z.literal(SEASON_POSTSEASON_LEGACY_VERSION),
    east: playoffConferenceBracketV1Schema,
    west: playoffConferenceBracketV1Schema,
    finals: playoffSeriesBaseV1Schema,
    championFranchiseId: franchiseIdSchema.nullable(),
});
export type PlayoffBracketV1 = z.infer<typeof playoffBracketV1Schema>;
export const seasonPostseasonStateV1Schema = z.object({
    schemaVersion: z.literal(1),
    postseasonVersion: z.literal(SEASON_POSTSEASON_LEGACY_VERSION),
    seed: seedSchema,
    playIn: z.object({
        east: playInStateV1Schema,
        west: playInStateV1Schema,
    }),
    bracket: playoffBracketV1Schema.nullable(),
    championFranchiseId: franchiseIdSchema.nullable(),
});
export type SeasonPostseasonStateV1 = z.infer<typeof seasonPostseasonStateV1Schema>;
