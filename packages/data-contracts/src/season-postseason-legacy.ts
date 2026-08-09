import { z } from 'zod';
import { franchiseIdSchema, seedSchema } from './ids.ts';
import { conferenceIdSchema } from './season-league.ts';
import { seasonGameStatusSchema } from './season-game.ts';
import { SEASON_POSTSEASON_LEGACY_VERSION } from './season-versions.ts';

/**
 * Legacy postseason v1 contract (postseason-v1, M2.0-M2.5), kept readable
 * for frozen v1 artifacts and the frozen engine state machine
 * (`packages/engine/src/season/postseason-legacy.ts`). New schema-9 runs
 * use the validated v2 contract in `season-postseason.ts` (stable
 * `pi-`/`po-` game ids, tie-resolution records, saved Finals draw seed);
 * v1 states are never migrated.
 *
 * Export names carry a `V1` suffix so the authoritative v2 names stay
 * canonical; the legacy engine module aliases them back locally.
 */

export const playInGameIdV1Schema = z.enum(['seven-eight', 'nine-ten', 'final']);
export type PlayInGameIdV1 = z.infer<typeof playInGameIdV1Schema>;

export const playInGameV1Schema = z
  .object({
    gameId: playInGameIdV1Schema,
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
export type PlayInGameV1 = z.infer<typeof playInGameV1Schema>;

/** One conference's Play-In state over seeds 7-10 (v1). */
export const playInStateV1Schema = z.object({
  conference: conferenceIdSchema,
  /** Top ten in ranking order; null until the regular season completes. */
  ranking: z.array(franchiseIdSchema).length(10).nullable(),
  games: z.object({
    /** Seed 7 hosts seed 8; the winner becomes playoff seed 7. */
    sevenEight: playInGameV1Schema,
    /** Seed 9 hosts seed 10; the loser is eliminated. */
    nineTen: playInGameV1Schema,
    /** The 7/8 loser hosts the 9/10 winner; the winner becomes seed 8. */
    final: playInGameV1Schema,
  }),
  /** Playoff seeds 1-8; positions 7-8 resolve when the Play-In completes. */
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
  games: z.array(playoffSeriesGameV1Schema).max(7),
  winnerFranchiseId: franchiseIdSchema.nullable(),
});

/**
 * One best-of-seven series (v1). The `homeCourtFranchiseId` side follows
 * the 2-2-1-1-1 pattern (games 1, 2, 5, 7 at home); for seeded series that
 * is the higher seed, for the Finals it is the caller-supplied home-court
 * team. A slot that is not yet paired has both team ids null; a series that
 * has started must name both teams.
 */
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
  } else if (series.games.length === 7) {
    ctx.addIssue({ code: 'custom', message: 'a seven-game series must name a winner' });
  }
});
export type PlayoffSeriesV1 = z.infer<typeof playoffSeriesBaseV1Schema>;

export const playoffConferenceBracketV1Schema = z.object({
  conference: conferenceIdSchema,
  /** Seeds 1-8 in order; pairings are 1-8, 4-5, 3-6, 2-7. */
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

/**
 * Complete Season Run postseason state (v1). `seed` is the derived
 * postseason namespace seed; the bracket is null until the Play-In
 * completes.
 */
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
