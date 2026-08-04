import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.js';
import { conferenceIdSchema } from './season-league.js';
import { seasonGameStatusSchema } from './season-game.js';
import { SEASON_POSTSEASON_VERSION } from './season-versions.js';

/**
 * Postseason state: the Play-In Tournament and the 16-team best-of-seven
 * bracket (spec/2.0/02). M2.0 receives an explicitly seeded top ten per
 * conference and carries the facts later tiebreak work requires; the full
 * published NBA tiebreak sequence lands in M2.6. Every series is best of
 * seven with a 2-2-1-1-1 home pattern and stops immediately at four wins;
 * the bracket never reseeds.
 */

export const playInGameIdSchema = z.enum(['seven-eight', 'nine-ten', 'final']);
export type PlayInGameId = z.infer<typeof playInGameIdSchema>;

export const playInGameSchema = z
  .object({
    gameId: playInGameIdSchema,
    status: seasonGameStatusSchema,
    /** Null until the regular-season ranking resolves the matchup. */
    homeFranchiseId: franchiseIdSchema.nullable(),
    awayFranchiseId: franchiseIdSchema.nullable(),
    winnerFranchiseId: franchiseIdSchema.nullable(),
    loserFranchiseId: franchiseIdSchema.nullable(),
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
  })
  .superRefine((game, ctx) => {
    if (game.status === 'scheduled') {
      if (
        game.homeFranchiseId !== null ||
        game.awayFranchiseId !== null ||
        game.winnerFranchiseId !== null ||
        game.loserFranchiseId !== null ||
        game.homeScore !== null ||
        game.awayScore !== null
      ) {
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
    } else if (game.homeScore !== null || game.awayScore !== null) {
      ctx.addIssue({ code: 'custom', message: 'forfeited play-in game carries no scores' });
    }
  });
export type PlayInGame = z.infer<typeof playInGameSchema>;

/** One conference's Play-In state over seeds 7-10. */
export const playInStateSchema = z.object({
  conference: conferenceIdSchema,
  /** Top ten in ranking order; null until the regular season completes. */
  ranking: z.array(franchiseIdSchema).length(10).nullable(),
  games: z.object({
    /** Seed 7 hosts seed 8; the winner becomes playoff seed 7. */
    sevenEight: playInGameSchema,
    /** Seed 9 hosts seed 10; the loser is eliminated. */
    nineTen: playInGameSchema,
    /** The 7/8 loser hosts the 9/10 winner; the winner becomes seed 8. */
    final: playInGameSchema,
  }),
  /** Playoff seeds 1-8; positions 7-8 resolve when the Play-In completes. */
  playoffSeeds: z.array(franchiseIdSchema).length(8).nullable(),
});
export type PlayInState = z.infer<typeof playInStateSchema>;

export const playoffRoundSchema = z.enum([
  'first-round',
  'conference-semifinal',
  'conference-final',
  'finals',
]);
export type PlayoffRound = z.infer<typeof playoffRoundSchema>;

export const playoffSeriesGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(7),
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,
  status: seasonGameStatusSchema,
  homeScore: z.number().int().nonnegative().nullable(),
  awayScore: z.number().int().nonnegative().nullable(),
  winnerFranchiseId: franchiseIdSchema.nullable(),
});
export type PlayoffSeriesGame = z.infer<typeof playoffSeriesGameSchema>;

const playoffSeriesBaseSchema = z.object({
  seriesId: z.string().min(1).max(64),
  round: playoffRoundSchema,
  /** Null for the Finals and for unpaired slots. */
  conference: conferenceIdSchema.nullable(),
  /** Seed number of the home-court side; null for the Finals and unpaired slots. */
  higherSeed: z.number().int().min(1).max(8).nullable(),
  /** Seed number of the challenger; null for the Finals and unpaired slots. */
  lowerSeed: z.number().int().min(1).max(8).nullable(),
  /** Null until the slot's matchup resolves. */
  homeCourtFranchiseId: franchiseIdSchema.nullable(),
  /** Null until the slot's matchup resolves. */
  challengerFranchiseId: franchiseIdSchema.nullable(),
  homeCourtWins: z.number().int().min(0).max(4),
  challengerWins: z.number().int().min(0).max(4),
  games: z.array(playoffSeriesGameSchema).max(7),
  winnerFranchiseId: franchiseIdSchema.nullable(),
});

/**
 * One best-of-seven series. The `homeCourtFranchiseId` side follows the
 * 2-2-1-1-1 pattern (games 1, 2, 5, 7 at home); for seeded series that is
 * the higher seed, for the Finals it is the caller-supplied home-court team.
 * A slot that is not yet paired has both team ids null; a series that has
 * started must name both teams.
 */
export const playoffSeriesSchema = playoffSeriesBaseSchema.superRefine((series, ctx) => {
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
  } else if (series.games.length === 7) {
    ctx.addIssue({ code: 'custom', message: 'a seven-game series must name a winner' });
  }
});
export type PlayoffSeries = z.infer<typeof playoffSeriesBaseSchema>;

export const playoffConferenceBracketSchema = z.object({
  conference: conferenceIdSchema,
  /** Seeds 1-8 in order; pairings are 1-8, 4-5, 3-6, 2-7. */
  seeds: z.array(franchiseIdSchema).length(8),
  firstRound: z.array(playoffSeriesBaseSchema).length(4),
  semifinals: z.array(playoffSeriesBaseSchema).length(2),
  conferenceFinal: playoffSeriesBaseSchema,
});
export type PlayoffConferenceBracket = z.infer<typeof playoffConferenceBracketSchema>;

export const playoffBracketSchema = z.object({
  schemaVersion: z.literal(1),
  postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
  east: playoffConferenceBracketSchema,
  west: playoffConferenceBracketSchema,
  finals: playoffSeriesBaseSchema,
  championFranchiseId: franchiseIdSchema.nullable(),
});
export type PlayoffBracket = z.infer<typeof playoffBracketSchema>;

/**
 * Complete Season Run postseason state. `seed` is the derived postseason
 * namespace seed (M2.6 final-draw randomness); the bracket is null until the
 * Play-In completes.
 */
export const seasonPostseasonStateSchema = z.object({
  schemaVersion: z.literal(1),
  postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
  seed: seedSchema,
  playIn: z.object({
    east: playInStateSchema,
    west: playInStateSchema,
  }),
  bracket: playoffBracketSchema.nullable(),
  championFranchiseId: franchiseIdSchema.nullable(),
});
export type SeasonPostseasonState = z.infer<typeof seasonPostseasonStateSchema>;
