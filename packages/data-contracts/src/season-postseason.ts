import { z } from 'zod';
import { franchiseIdSchema, idSchema, seedSchema } from './ids.ts';
import { conferenceIdSchema, type ConferenceId } from './season-league.ts';
import { seasonGameStatusSchema } from './season-game.ts';
import { seasonNamespaceSeed, SEASON_SEED_NAMESPACES } from './season-seeds.ts';
import { SEASON_POSTSEASON_VERSION, SEASON_TIEBREAK_VERSION } from './season-versions.ts';

/**
 * Season Run postseason v2 state machine contract (spec/2.0/02, M2.6
 * postseason-foundations, postseason-v2). Replaces the incomplete
 * postseason-v1 contract: every game carries a stable derived id, ties are
 * resolved through the versioned published NBA tiebreak sequence with
 * deterministic recorded resolutions, and the Finals home court falls back
 * to a saved deterministic draw.
 *
 * Stable game ids (frozen):
 * - Play-In: `pi-{conference}-{matchup}` where matchup is `seven-eight`,
 *   `nine-ten`, or `final`.
 * - Playoffs: `po-{seriesId}-g{gameNumber}` with gameNumber 1..7.
 *
 * Shape invariants enforced at parse time: Play-In game ids must match their
 * conference and matchup slot, series game ids must match their series and
 * game number, series wins must equal played games, a started series must
 * name both teams, a winner requires four wins, a seven-game series must
 * name a winner, the bracket champion must equal the Finals winner, and a
 * bracket requires both conferences' resolved playoff seeds. Deeper
 * cross-slot auditing (pairings, home patterns, advancement) belongs to the
 * engine's v2 audit in a later phase.
 *
 * The v1 contract (postseason-v1) stays readable through
 * `season-postseason-legacy.ts`; schema-9 runs never use it.
 */

/** The three Play-In matchups per conference. */
export const playInMatchupIdSchema = z.enum(['seven-eight', 'nine-ten', 'final']);
export type PlayInMatchupId = z.infer<typeof playInMatchupIdSchema>;

/** Stable Play-In game id: `pi-{conference}-{matchup}`. */
export const playInGameIdSchema = z.string().regex(/^pi-(east|west)-(seven-eight|nine-ten|final)$/);
export type PlayInGameId = z.infer<typeof playInGameIdSchema>;

/** Derives the stable Play-In game id of a conference matchup. */
export function playInGameIdOf(conference: ConferenceId, matchup: PlayInMatchupId): string {
  return `pi-${conference}-${matchup}`;
}

/** Stable playoff game id: `po-{seriesId}-g{gameNumber}`. */
export const playoffGameIdSchema = z.string().regex(/^po-[a-z0-9][a-z0-9._:-]{0,63}-g[1-7]$/);
export type PlayoffGameId = z.infer<typeof playoffGameIdSchema>;

/** Derives the stable playoff game id of a series game. */
export function playoffGameIdOf(seriesId: string, gameNumber: number): string {
  return `po-${seriesId}-g${String(gameNumber)}`;
}

/** Every postseason game id (Play-In or playoffs). */
export const postseasonGameIdSchema = z.union([playInGameIdSchema, playoffGameIdSchema]);
export type PostseasonGameId = z.infer<typeof postseasonGameIdSchema>;

/** Phase of a postseason game id ('play-in' or 'playoffs'). */
export function postseasonPhaseOfGameId(gameId: string): 'play-in' | 'playoffs' {
  return gameId.startsWith('pi-') ? 'play-in' : 'playoffs';
}

/** Parses a `po-{seriesId}-g{gameNumber}` id into its parts (or null). */
export function parsePlayoffGameId(gameId: string): {
  seriesId: string;
  gameNumber: number;
} | null {
  const match = /^po-(.+)-g([1-7])$/.exec(gameId);
  if (match === null) return null;
  return { seriesId: match[1] ?? '', gameNumber: Number(match[2]) };
}

/**
 * The published NBA regular-season tiebreak rules (tiebreaker-v1). Earlier
 * rules in this frozen sequence win; `random-draw` is the final resort and
 * always records its saved deterministic draw seed. `overall-record` and
 * `points-differential` also appear in the Finals home-court sequence.
 */
export const seasonTiebreakRuleSchema = z.enum([
  'head-to-head',
  'division-champion',
  'division-record',
  'conference-record',
  'playoff-teams-conference-record',
  'playoff-teams-other-conference-record',
  'points-differential',
  'points-for',
  'overall-record',
  'random-draw',
]);
export type SeasonTiebreakRule = z.infer<typeof seasonTiebreakRuleSchema>;

/** What a tie resolution decided. */
export const seasonTiebreakKindSchema = z.enum(['qualification', 'seeding', 'finals-home-court']);
export type SeasonTiebreakKind = z.infer<typeof seasonTiebreakKindSchema>;

/**
 * One deterministic tie-resolution record (append-only, ordered by
 * resolution). `teams` lists the tied teams in final decided order (best
 * first); `slots` names the positions the tie decided (e.g. seeds 7-10, or
 * slot 1 for the Finals home-court decision). `evidence` carries the
 * recorded deciding facts (head-to-head records, differentials, draw seed
 * path) so the resolution is auditable without inventing numbers. A
 * non-null `drawSeed` is only legal for a deterministic random draw (and a
 * random-draw resolution must record its draw seed).
 */
export const seasonTiebreakResolutionSchema = z
  .object({
    resolutionId: idSchema,
    conference: conferenceIdSchema,
    kind: seasonTiebreakKindSchema,
    rule: seasonTiebreakRuleSchema,
    /** Tied teams in final decided order (best first). */
    teams: z.array(franchiseIdSchema).min(2).max(3),
    /** Positions the tie decided (e.g. [7, 8] for play-in seeds). */
    slots: z.array(z.number().int().min(1).max(10)).min(1).max(3),
    /** Bounded recorded deciding facts (no invented numbers). */
    evidence: z
      .array(
        z.object({
          label: z.string().min(1).max(64),
          value: z.union([z.number(), z.string()]),
        }),
      )
      .max(8),
    /** Non-null only when the deciding rule is a deterministic draw. */
    drawSeed: seedSchema.nullable(),
  })
  .superRefine((resolution, ctx) => {
    if (resolution.rule === 'random-draw') {
      if (resolution.drawSeed === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'a random-draw tie resolution must record its draw seed',
        });
      }
    } else if (resolution.drawSeed !== null) {
      ctx.addIssue({
        code: 'custom',
        message: 'only a random-draw tie resolution may carry a draw seed',
      });
    }
  });
export type SeasonTiebreakResolution = z.infer<typeof seasonTiebreakResolutionSchema>;

/** One Play-In game record with its stable id and result facts. */
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
export const playInStateSchema = z
  .object({
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
  })
  .superRefine((state, ctx) => {
    const gameKeyOf: Record<PlayInMatchupId, 'sevenEight' | 'nineTen' | 'final'> = {
      'seven-eight': 'sevenEight',
      'nine-ten': 'nineTen',
      final: 'final',
    };
    for (const matchup of playInMatchupIdSchema.options) {
      const expected = playInGameIdOf(state.conference, matchup);
      if (state.games[gameKeyOf[matchup]].gameId !== expected) {
        ctx.addIssue({
          code: 'custom',
          message: `${state.conference} ${matchup} game id must be ${expected}`,
        });
      }
    }
  });
export type PlayInState = z.infer<typeof playInStateSchema>;

export const playoffRoundSchema = z.enum([
  'first-round',
  'conference-semifinal',
  'conference-final',
  'finals',
]);
export type PlayoffRound = z.infer<typeof playoffRoundSchema>;

/** One playoff game record with its stable `po-{seriesId}-g{gameNumber}` id. */
export const playoffSeriesGameSchema = z
  .object({
    gameId: playoffGameIdSchema,
    gameNumber: z.number().int().min(1).max(7),
    homeFranchiseId: franchiseIdSchema,
    awayFranchiseId: franchiseIdSchema,
    status: seasonGameStatusSchema,
    homeScore: z.number().int().nonnegative().nullable(),
    awayScore: z.number().int().nonnegative().nullable(),
    winnerFranchiseId: franchiseIdSchema.nullable(),
  })
  .superRefine((game, ctx) => {
    const parsed = parsePlayoffGameId(game.gameId);
    if (parsed !== null && parsed.gameNumber !== game.gameNumber) {
      ctx.addIssue({
        code: 'custom',
        message: `game id ${game.gameId} must end in the game number ${String(game.gameNumber)}`,
      });
    }
  });
export type PlayoffSeriesGame = z.infer<typeof playoffSeriesGameSchema>;

const playoffSeriesBaseSchema = z.object({
  seriesId: idSchema,
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
 * started must name both teams. Every recorded game id must equal
 * `po-{seriesId}-g{gameNumber}` and games must be sequential from 1.
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
  series.games.forEach((game, index) => {
    const expectedGameNumber = index + 1;
    if (game.gameNumber !== expectedGameNumber) {
      ctx.addIssue({
        code: 'custom',
        message: `series ${series.seriesId} games must be sequential from 1`,
      });
    }
    if (game.gameId !== playoffGameIdOf(series.seriesId, expectedGameNumber)) {
      ctx.addIssue({
        code: 'custom',
        message: `series ${series.seriesId} game ${String(expectedGameNumber)} id must be ${playoffGameIdOf(series.seriesId, expectedGameNumber)}`,
      });
    }
  });
  if (series.winnerFranchiseId !== null) {
    if (series.homeCourtWins !== 4 && series.challengerWins !== 4) {
      ctx.addIssue({ code: 'custom', message: 'series winner requires four wins' });
    }
    const teams = [series.homeCourtFranchiseId, series.challengerFranchiseId];
    if (!teams.includes(series.winnerFranchiseId)) {
      ctx.addIssue({ code: 'custom', message: 'series winner must be a participant' });
    }
  } else if (series.homeCourtWins === 4 || series.challengerWins === 4) {
    ctx.addIssue({ code: 'custom', message: 'a series must name its winner at four wins' });
  }
});
export type PlayoffSeries = z.infer<typeof playoffSeriesBaseSchema>;

export const playoffConferenceBracketSchema = z.object({
  conference: conferenceIdSchema,
  /** Seeds 1-8 in order; pairings are 1-8, 4-5, 3-6, 2-7. */
  seeds: z.array(franchiseIdSchema).length(8),
  firstRound: z.array(playoffSeriesSchema).length(4),
  semifinals: z.array(playoffSeriesSchema).length(2),
  conferenceFinal: playoffSeriesSchema,
});
export type PlayoffConferenceBracket = z.infer<typeof playoffConferenceBracketSchema>;

export const playoffBracketSchema = z
  .object({
    schemaVersion: z.literal(1),
    postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
    east: playoffConferenceBracketSchema,
    west: playoffConferenceBracketSchema,
    finals: playoffSeriesSchema,
    championFranchiseId: franchiseIdSchema.nullable(),
  })
  .superRefine((bracket, ctx) => {
    if (bracket.championFranchiseId !== bracket.finals.winnerFranchiseId) {
      ctx.addIssue({ code: 'custom', message: 'bracket champion must match the finals winner' });
    }
  });
export type PlayoffBracket = z.infer<typeof playoffBracketSchema>;

/**
 * Complete Season Run postseason state (postseason-v2). `seed` is the
 * derived postseason namespace seed; `finalsHomeCourtDrawSeed` is the saved
 * deterministic draw seed used when the Finals home court cannot be decided
 * by overall record, head-to-head record, or point differential. The bracket
 * is null until both conferences complete their Play-In.
 */
export const seasonPostseasonStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
    tiebreakVersion: z.literal(SEASON_TIEBREAK_VERSION),
    seed: seedSchema,
    /** Saved deterministic draw seed for tied Finals home court. */
    finalsHomeCourtDrawSeed: seedSchema,
    /** Append-only deterministic tie-resolution records, in resolution order. */
    tiebreakResolutions: z.array(seasonTiebreakResolutionSchema),
    playIn: z.object({
      east: playInStateSchema,
      west: playInStateSchema,
    }),
    bracket: playoffBracketSchema.nullable(),
    championFranchiseId: franchiseIdSchema.nullable(),
  })
  .superRefine((state, ctx) => {
    if (state.bracket !== null) {
      if (state.playIn.east.playoffSeeds === null || state.playIn.west.playoffSeeds === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'a bracket requires both conferences resolved playoff seeds',
        });
      }
      if (state.championFranchiseId !== state.bracket.championFranchiseId) {
        ctx.addIssue({
          code: 'custom',
          message: 'the state champion must match the bracket champion',
        });
      }
    }
    if (state.championFranchiseId !== null && state.bracket === null) {
      ctx.addIssue({ code: 'custom', message: 'a champion cannot exist without a bracket' });
    }
  });
export type SeasonPostseasonState = z.infer<typeof seasonPostseasonStateSchema>;

/**
 * The initial postseason state of a fresh run (regular-season stage): the
 * derived postseason namespace seed, the saved Finals home-court draw seed
 * (a pure function of the root seed, so the fallback draw is reproducible),
 * empty tie-resolution records, unranked Play-In scaffolds with stable
 * scheduled game ids, and no bracket or champion.
 */
export function buildInitialPostseasonState(
  rootSeed: z.infer<typeof seedSchema>,
): SeasonPostseasonState {
  const scheduled = (gameId: string) => ({
    gameId,
    status: 'scheduled' as const,
    homeFranchiseId: null,
    awayFranchiseId: null,
    winnerFranchiseId: null,
    loserFranchiseId: null,
    homeScore: null,
    awayScore: null,
  });
  const conference = (id: ConferenceId) => ({
    conference: id,
    ranking: null,
    games: {
      sevenEight: scheduled(playInGameIdOf(id, 'seven-eight')),
      nineTen: scheduled(playInGameIdOf(id, 'nine-ten')),
      final: scheduled(playInGameIdOf(id, 'final')),
    },
    playoffSeeds: null,
  });
  const seed = seasonNamespaceSeed(rootSeed, SEASON_SEED_NAMESPACES.postseasonTies);
  return {
    schemaVersion: 1,
    postseasonVersion: SEASON_POSTSEASON_VERSION,
    tiebreakVersion: SEASON_TIEBREAK_VERSION,
    seed,
    finalsHomeCourtDrawSeed: seasonNamespaceSeed(
      seed,
      SEASON_SEED_NAMESPACES.postseasonDraws,
      'finals-home-court',
    ),
    tiebreakResolutions: [],
    playIn: { east: conference('east'), west: conference('west') },
    bracket: null,
    championFranchiseId: null,
  };
}
