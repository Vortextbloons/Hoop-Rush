import { z } from 'zod';
import { franchiseIdSchema, idSchema, seedSchema } from './ids.ts';
import { conferenceIdSchema, type ConferenceId } from './season-league.ts';
import { seasonGameStatusSchema } from './season-game.ts';
import { seasonNamespaceSeed, SEASON_SEED_NAMESPACES } from './season-seeds.ts';
import { SEASON_POSTSEASON_VERSION, SEASON_TIEBREAK_VERSION } from './season-versions.ts';

export const playInMatchupIdSchema = z.enum(['seven-eight', 'nine-ten', 'final']);
export type PlayInMatchupId = z.infer<typeof playInMatchupIdSchema>;

export const playInGameIdSchema = z.string().regex(/^pi-(east|west)-(seven-eight|nine-ten|final)$/);
export type PlayInGameId = z.infer<typeof playInGameIdSchema>;

export function playInGameIdOf(conference: ConferenceId, matchup: PlayInMatchupId): string {
  return `pi-${conference}-${matchup}`;
}

export const playoffGameIdSchema = z.string().regex(/^po-[a-z0-9][a-z0-9._:-]{0,63}-g[1-7]$/);
export type PlayoffGameId = z.infer<typeof playoffGameIdSchema>;

export function playoffGameIdOf(seriesId: string, gameNumber: number): string {
  return `po-${seriesId}-g${String(gameNumber)}`;
}

export const postseasonGameIdSchema = z.union([playInGameIdSchema, playoffGameIdSchema]);
export type PostseasonGameId = z.infer<typeof postseasonGameIdSchema>;

export function postseasonPhaseOfGameId(gameId: string): 'play-in' | 'playoffs' {
  return gameId.startsWith('pi-') ? 'play-in' : 'playoffs';
}

export function parsePlayoffGameId(gameId: string): {
  seriesId: string;
  gameNumber: number;
} | null {
  const match = /^po-(.+)-g([1-7])$/.exec(gameId);
  if (match === null) return null;
  return { seriesId: match[1] ?? '', gameNumber: Number(match[2]) };
}

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

export const seasonTiebreakKindSchema = z.enum(['qualification', 'seeding', 'finals-home-court']);
export type SeasonTiebreakKind = z.infer<typeof seasonTiebreakKindSchema>;

export const seasonTiebreakResolutionSchema = z
  .object({
    resolutionId: idSchema,
    conference: conferenceIdSchema,
    kind: seasonTiebreakKindSchema,
    rule: seasonTiebreakRuleSchema,

    teams: z.array(franchiseIdSchema).min(2).max(3),

    slots: z.array(z.number().int().min(1).max(10)).min(1).max(3),

    evidence: z
      .array(
        z.object({
          label: z.string().min(1).max(64),
          value: z.union([z.number(), z.string()]),
        }),
      )
      .max(8),

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

export const playInGameSchema = z
  .object({
    gameId: playInGameIdSchema,
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

export const playInStateSchema = z
  .object({
    conference: conferenceIdSchema,

    ranking: z.array(franchiseIdSchema).length(10).nullable(),
    games: z.object({
      sevenEight: playInGameSchema,

      nineTen: playInGameSchema,

      final: playInGameSchema,
    }),

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

  conference: conferenceIdSchema.nullable(),

  higherSeed: z.number().int().min(1).max(8).nullable(),

  lowerSeed: z.number().int().min(1).max(8).nullable(),

  homeCourtFranchiseId: franchiseIdSchema.nullable(),

  challengerFranchiseId: franchiseIdSchema.nullable(),
  homeCourtWins: z.number().int().min(0).max(4),
  challengerWins: z.number().int().min(0).max(4),
  games: z.array(playoffSeriesGameSchema).max(7),
  winnerFranchiseId: franchiseIdSchema.nullable(),
});

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

export const seasonPostseasonStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
    tiebreakVersion: z.literal(SEASON_TIEBREAK_VERSION),
    seed: seedSchema,

    finalsHomeCourtDrawSeed: seedSchema,

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
