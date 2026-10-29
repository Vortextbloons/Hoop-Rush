import { z } from 'zod';
import { playerIdSchema, seedSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { leagueRecordSchema } from './league.ts';
import { capRushDigestSchema } from './cap-rush-versions.ts';
import { havocGameAuditSchema, havocGameResultSchema } from './havoc-game.ts';

export const CAP_RUSH_POSTSEASON_VERSION = 'cap-rush-postseason-v1';
export const CAP_RUSH_FINALS_MVP_VERSION = 'cap-rush-finals-mvp-v1';
export const CAP_RUSH_PLAYOFF_TEAMS = 16;
export const CAP_RUSH_PLAYOFF_ROUNDS = 4;
export const CAP_RUSH_SERIES_WINS = 4;
export const CAP_RUSH_SERIES_GAMES = 7;
export const CAP_RUSH_LEAGUE_TEAMS = 31;
export const CAP_RUSH_LEAGUE_GAMES_PER_TEAM = 82;
export const CAP_RUSH_LEAGUE_GAMES = 1271;
export const CAP_RUSH_USER_TEAM_ID = 'cap-rush-human';
export const CAP_RUSH_USER_TEAM_NAME = 'Cap Rush Five';

export const capRushPlayoffRoundSchema = z.number().int().min(1).max(CAP_RUSH_PLAYOFF_ROUNDS);
export type CapRushPlayoffRound = z.infer<typeof capRushPlayoffRoundSchema>;

export const CAP_RUSH_PLAYOFF_ROUND_NAMES = [
  'First round',
  'Quarterfinals',
  'Semifinals',
  'Finals',
] as const;

export function capRushRoundName(round: number): string {
  return CAP_RUSH_PLAYOFF_ROUND_NAMES[round - 1] ?? `Round ${String(round)}`;
}

export const capRushSeriesIdSchema = z.string().regex(/^crs-[1-4]-[0-7]$/);
export type CapRushSeriesId = z.infer<typeof capRushSeriesIdSchema>;

export const capRushPlayoffGameIdSchema = z.string().regex(/^crp-[1-4]-[0-7]-[1-7]$/);
export type CapRushPlayoffGameId = z.infer<typeof capRushPlayoffGameIdSchema>;

export const capRushStandingsEntrySchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  isUserTeam: z.boolean(),
  wins: z.number().int().min(0).max(CAP_RUSH_LEAGUE_GAMES_PER_TEAM),
  losses: z.number().int().min(0).max(CAP_RUSH_LEAGUE_GAMES_PER_TEAM),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
  pointDifferential: z.number().int(),
  seed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS),
  qualified: z.boolean(),
});
export type CapRushStandingsEntry = z.infer<typeof capRushStandingsEntrySchema>;

export const capRushStandingsCutoffSchema = z.object({
  seed: z.literal(CAP_RUSH_PLAYOFF_TEAMS),
  teamId: z.string().min(1).max(64),
  wins: z.number().int().min(0).max(CAP_RUSH_LEAGUE_GAMES_PER_TEAM),
  losses: z.number().int().min(0).max(CAP_RUSH_LEAGUE_GAMES_PER_TEAM),
  pointDifferential: z.number().int(),
  pointsFor: z.number().int(),
  tieBreak: z.enum(['wins', 'point-differential', 'points-for', 'team-id']),
});
export type CapRushStandingsCutoff = z.infer<typeof capRushStandingsCutoffSchema>;

export const capRushLeagueTeamPointsSchema = z.object({
  teamId: z.string().min(1).max(64),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
});
export type CapRushLeagueTeamPoints = z.infer<typeof capRushLeagueTeamPointsSchema>;

export const capRushLeagueResultSchema = z.object({
  league: leagueRecordSchema,
  points: z.array(capRushLeagueTeamPointsSchema).length(30),
});
export type CapRushLeagueResult = z.infer<typeof capRushLeagueResultSchema>;

export const capRushPostseasonStandingsSchema = z
  .object({
    entries: z.array(capRushStandingsEntrySchema).length(CAP_RUSH_LEAGUE_TEAMS),
    qualifiedTeamIds: z.array(z.string().min(1).max(64)).length(CAP_RUSH_PLAYOFF_TEAMS),
    cutoff: capRushStandingsCutoffSchema,
    league: capRushLeagueResultSchema,
    tiesAtCutoff: z.array(z.string().min(1).max(64)),
  })
  .superRefine((standings, ctx) => {
    standings.entries.forEach((entry, index) => {
      if (entry.seed !== index + 1) {
        ctx.addIssue({ code: 'custom', message: 'standings seeds must be sequential' });
      }
      if (entry.qualified !== entry.seed <= CAP_RUSH_PLAYOFF_TEAMS) {
        ctx.addIssue({ code: 'custom', message: 'only the top sixteen seeds qualify' });
      }
      if (entry.wins + entry.losses !== CAP_RUSH_LEAGUE_GAMES_PER_TEAM) {
        ctx.addIssue({ code: 'custom', message: 'every team must play 82 games' });
      }
      if (entry.pointDifferential !== entry.pointsFor - entry.pointsAgainst) {
        ctx.addIssue({ code: 'custom', message: 'point differential must match its points' });
      }
    });
    const qualified = standings.entries
      .filter((entry) => entry.qualified)
      .map((entry) => entry.teamId);
    if (
      qualified.length !== CAP_RUSH_PLAYOFF_TEAMS ||
      qualified.some((teamId, index) => standings.qualifiedTeamIds[index] !== teamId)
    ) {
      ctx.addIssue({ code: 'custom', message: 'qualified teams must be the top sixteen seeds' });
    }
  });
export type CapRushPostseasonStandings = z.infer<typeof capRushPostseasonStandingsSchema>;

export const capRushPlayoffParticipantSchema = z.object({
  teamId: z.string().min(1).max(64),
  slot: positionSchema,
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  kind: z.enum(['starter', 'replacement', 'clone']),
  minutes: z.number().int().nonnegative(),
  points: z.number().int(),
  rebounds: z.number().int().nonnegative(),
  offensiveRebounds: z.number().int().nonnegative(),
  defensiveRebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  threesMade: z.number().int().nonnegative(),
  threesAttempted: z.number().int().nonnegative(),
  adjustments: z.number().int(),
});
export type CapRushPlayoffParticipant = z.infer<typeof capRushPlayoffParticipantSchema>;

export const capRushPlayoffGameSummarySchema = z
  .object({
    gameId: capRushPlayoffGameIdSchema,
    seriesId: capRushSeriesIdSchema,
    round: capRushPlayoffRoundSchema,
    seriesSlot: z.number().int().min(0).max(7),
    gameOrdinal: z.number().int().min(1).max(CAP_RUSH_SERIES_GAMES),
    seed: seedSchema,
    homeTeamId: z.string().min(1).max(64),
    awayTeamId: z.string().min(1).max(64),
    homeSeed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS),
    awaySeed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS),
    userSide: z.enum(['home', 'away']).nullable(),
    homePoints: z.number().int(),
    awayPoints: z.number().int(),
    winnerTeamId: z.string().min(1).max(64),
    overtimePeriods: z.number().int().nonnegative(),
    inputDigest: capRushDigestSchema,
    resultDigest: capRushDigestSchema,
    finalsLines: z.array(capRushPlayoffParticipantSchema).max(40).optional(),
  })
  .superRefine((game, ctx) => {
    const expectedId = `crp-${String(game.round)}-${String(game.seriesSlot)}-${String(game.gameOrdinal)}`;
    if (game.gameId !== expectedId) {
      ctx.addIssue({ code: 'custom', message: 'playoff game id does not match its identity' });
    }
    const expectedSeries = `crs-${String(game.round)}-${String(game.seriesSlot)}`;
    if (game.seriesId !== expectedSeries) {
      ctx.addIssue({
        code: 'custom',
        message: 'playoff game series id does not match its identity',
      });
    }
    if (game.homePoints === game.awayPoints) {
      ctx.addIssue({ code: 'custom', message: 'playoff games never end tied' });
    }
    const expectedWinner = game.homePoints > game.awayPoints ? game.homeTeamId : game.awayTeamId;
    if (game.winnerTeamId !== expectedWinner) {
      ctx.addIssue({ code: 'custom', message: 'playoff winner disagrees with the scoreline' });
    }
    if (game.userSide === 'home' && game.homeTeamId !== CAP_RUSH_USER_TEAM_ID) {
      ctx.addIssue({ code: 'custom', message: 'the user side must be the user team' });
    }
    if (game.userSide === 'away' && game.awayTeamId !== CAP_RUSH_USER_TEAM_ID) {
      ctx.addIssue({ code: 'custom', message: 'the user side must be the user team' });
    }
    if (
      game.userSide === null &&
      (game.homeTeamId === CAP_RUSH_USER_TEAM_ID || game.awayTeamId === CAP_RUSH_USER_TEAM_ID)
    ) {
      ctx.addIssue({ code: 'custom', message: 'a user playoff game must record its side' });
    }
    if (game.round !== CAP_RUSH_PLAYOFF_ROUNDS && game.finalsLines !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'only Finals games carry participant evidence' });
    }
    if (game.round === CAP_RUSH_PLAYOFF_ROUNDS && game.finalsLines === undefined) {
      ctx.addIssue({ code: 'custom', message: 'Finals games require participant evidence' });
    }
  });
export type CapRushPlayoffGameSummary = z.infer<typeof capRushPlayoffGameSummarySchema>;

export const capRushPlayoffSeriesSchema = z
  .object({
    seriesId: capRushSeriesIdSchema,
    round: capRushPlayoffRoundSchema,
    seriesSlot: z.number().int().min(0).max(7),
    highSeed: z.number().int().min(1).max(CAP_RUSH_PLAYOFF_TEAMS),
    lowSeed: z.number().int().min(1).max(CAP_RUSH_PLAYOFF_TEAMS),
    highTeamId: z.string().min(1).max(64),
    lowTeamId: z.string().min(1).max(64),
    games: z.array(capRushPlayoffGameSummarySchema).max(CAP_RUSH_SERIES_GAMES),
  })
  .superRefine((series, ctx) => {
    const expectedId = `crs-${String(series.round)}-${String(series.seriesSlot)}`;
    if (series.seriesId !== expectedId) {
      ctx.addIssue({ code: 'custom', message: 'series id does not match its identity' });
    }
    if (series.highSeed >= series.lowSeed) {
      ctx.addIssue({ code: 'custom', message: 'the higher seed must carry the lower seed number' });
    }
    series.games.forEach((game, index) => {
      if (game.gameOrdinal !== index + 1) {
        ctx.addIssue({ code: 'custom', message: 'series games must be sequential' });
      }
      if (game.seriesId !== series.seriesId) {
        ctx.addIssue({ code: 'custom', message: 'series game belongs to another series' });
      }
      if (
        (game.homeTeamId !== series.highTeamId && game.homeTeamId !== series.lowTeamId) ||
        (game.awayTeamId !== series.highTeamId && game.awayTeamId !== series.lowTeamId) ||
        game.homeTeamId === game.awayTeamId
      ) {
        ctx.addIssue({ code: 'custom', message: 'series game teams do not match the matchup' });
      }
      const highSeed = game.homeTeamId === series.highTeamId ? game.homeSeed : game.awaySeed;
      const lowSeed = game.homeTeamId === series.lowTeamId ? game.homeSeed : game.awaySeed;
      if (highSeed !== series.highSeed || lowSeed !== series.lowSeed) {
        ctx.addIssue({ code: 'custom', message: 'series game seeds do not match the matchup' });
      }
      const expectedHome = [1, 2, 5, 7].includes(game.gameOrdinal)
        ? series.highTeamId
        : series.lowTeamId;
      if (game.homeTeamId !== expectedHome) {
        ctx.addIssue({ code: 'custom', message: 'series home court does not follow the format' });
      }
    });
    const highWins = series.games.filter((game) => game.winnerTeamId === series.highTeamId).length;
    const lowWins = series.games.filter((game) => game.winnerTeamId === series.lowTeamId).length;
    if (highWins > CAP_RUSH_SERIES_WINS || lowWins > CAP_RUSH_SERIES_WINS) {
      ctx.addIssue({ code: 'custom', message: 'a series cannot exceed four wins' });
    }
    if (
      (highWins === CAP_RUSH_SERIES_WINS || lowWins === CAP_RUSH_SERIES_WINS) &&
      series.games.at(-1)?.winnerTeamId !==
        (highWins === CAP_RUSH_SERIES_WINS ? series.highTeamId : series.lowTeamId)
    ) {
      ctx.addIssue({ code: 'custom', message: 'a series must end on its clinching win' });
    }
  });
export type CapRushPlayoffSeries = z.infer<typeof capRushPlayoffSeriesSchema>;

export const capRushPostseasonUserOutcomeSchema = z.object({
  status: z.enum(['pending', 'not-qualified', 'eliminated', 'champion']),
  round: capRushPlayoffRoundSchema.nullable(),
});
export type CapRushPostseasonUserOutcome = z.infer<typeof capRushPostseasonUserOutcomeSchema>;

export const capRushFinalsMvpSchema = z.object({
  version: z.literal(CAP_RUSH_FINALS_MVP_VERSION),
  selectionRule: z.literal('finals-game-score-then-points-assists-rebounds-player-id'),
  teamId: z.string().min(1).max(64),
  isUserTeam: z.boolean(),
  slot: positionSchema,
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  games: z.number().int().positive(),
  totalGameScore: z.number(),
  totalPoints: z.number().int(),
  totalAssists: z.number().int(),
  totalRebounds: z.number().int(),
  averageGameScore: z.number(),
  averagePoints: z.number(),
  averageAssists: z.number(),
  averageRebounds: z.number(),
});
export type CapRushFinalsMvp = z.infer<typeof capRushFinalsMvpSchema>;

export const capRushPostseasonSchema = z
  .object({
    version: z.literal(CAP_RUSH_POSTSEASON_VERSION),
    phase: z.enum(['awaiting-standings', 'playoffs', 'complete']),
    standings: capRushPostseasonStandingsSchema.nullable(),
    series: z.array(capRushPlayoffSeriesSchema).max(15),
    userOutcome: capRushPostseasonUserOutcomeSchema,
    championTeamId: z.string().min(1).max(64).nullable(),
    finalsMvp: capRushFinalsMvpSchema.nullable(),
    completedAt: z.iso.datetime().nullable(),
  })
  .superRefine((postseason, ctx) => {
    if (postseason.phase === 'awaiting-standings') {
      if (postseason.standings !== null || postseason.series.length !== 0) {
        ctx.addIssue({ code: 'custom', message: 'standings must be accepted before the bracket' });
      }
    }
    if (postseason.phase === 'playoffs' && postseason.standings === null) {
      ctx.addIssue({ code: 'custom', message: 'a playoff bracket requires final standings' });
    }
    if (postseason.phase === 'complete') {
      if (postseason.championTeamId === null) {
        ctx.addIssue({ code: 'custom', message: 'a complete postseason requires a champion' });
      }
      if (postseason.finalsMvp === null) {
        ctx.addIssue({ code: 'custom', message: 'a complete postseason requires a Finals MVP' });
      }
      if (postseason.completedAt === null) {
        ctx.addIssue({
          code: 'custom',
          message: 'a complete postseason requires a completion time',
        });
      }
      if (postseason.series.length !== 15) {
        ctx.addIssue({ code: 'custom', message: 'a complete postseason has fifteen series' });
      }
    } else if (postseason.completedAt !== null) {
      ctx.addIssue({ code: 'custom', message: 'an unfinished postseason has no completion time' });
    }
    const rounds = new Map<number, number>();
    for (const series of postseason.series) {
      rounds.set(series.round, (rounds.get(series.round) ?? 0) + 1);
    }
    for (const [round, count] of rounds) {
      const expected = 8 >> (round - 1);
      if (count !== expected) {
        ctx.addIssue({
          code: 'custom',
          message: `round ${String(round)} must contain ${String(expected)} series`,
        });
      }
    }
    if (postseason.userOutcome.status === 'champion') {
      if (
        postseason.championTeamId !== CAP_RUSH_USER_TEAM_ID ||
        postseason.userOutcome.round !== CAP_RUSH_PLAYOFF_ROUNDS
      ) {
        ctx.addIssue({ code: 'custom', message: 'a user championship must match the champion' });
      }
    }
    if (postseason.championTeamId === CAP_RUSH_USER_TEAM_ID) {
      if (postseason.userOutcome.status !== 'champion') {
        ctx.addIssue({ code: 'custom', message: 'a user champion must record a championship' });
      }
    } else if (postseason.championTeamId !== null && postseason.userOutcome.status === 'champion') {
      ctx.addIssue({
        code: 'custom',
        message: 'only the user team can record a user championship',
      });
    }
  });
export type CapRushPostseason = z.infer<typeof capRushPostseasonSchema>;

export function capRushEmptyPostseason(): CapRushPostseason {
  return {
    version: CAP_RUSH_POSTSEASON_VERSION,
    phase: 'awaiting-standings',
    standings: null,
    series: [],
    userOutcome: { status: 'pending', round: null },
    championTeamId: null,
    finalsMvp: null,
    completedAt: null,
  };
}

export const capRushStoredPlayoffGameSchema = z.object({
  gameId: capRushPlayoffGameIdSchema,
  summary: capRushPlayoffGameSummarySchema,
  audit: havocGameAuditSchema,
  result: havocGameResultSchema.nullable(),
});
export type CapRushStoredPlayoffGame = z.infer<typeof capRushStoredPlayoffGameSchema>;

export const capRushPostseasonReportSchema = z.object({
  championTeamId: z.string().min(1).max(64),
  championName: z.string().min(1).max(96),
  isUserChampion: z.boolean(),
  userOutcome: capRushPostseasonUserOutcomeSchema,
  seed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS).nullable(),
  series: z.array(capRushPlayoffSeriesSchema).length(15),
  standings: capRushPostseasonStandingsSchema,
  finalsMvp: capRushFinalsMvpSchema,
});
export type CapRushPostseasonReport = z.infer<typeof capRushPostseasonReportSchema>;

export const capRushPlayoffGamePlanSchema = z.object({
  seriesId: capRushSeriesIdSchema,
  round: capRushPlayoffRoundSchema,
  seriesSlot: z.number().int().min(0).max(7),
  gameOrdinal: z.number().int().min(1).max(CAP_RUSH_SERIES_GAMES),
  homeTeamId: z.string().min(1).max(64),
  awayTeamId: z.string().min(1).max(64),
  homeSeed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS),
  awaySeed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS),
  userSide: z.enum(['home', 'away']).nullable(),
  isFinals: z.boolean(),
  seed: seedSchema,
});
export type CapRushPlayoffGamePlan = z.infer<typeof capRushPlayoffGamePlanSchema>;

export const capRushHistoryPostseasonSchema = z.object({
  championTeamId: z.string().min(1).max(64),
  championName: z.string().min(1).max(96),
  isUserChampion: z.boolean(),
  userStatus: z.enum(['not-qualified', 'eliminated', 'champion']),
  userRound: capRushPlayoffRoundSchema.nullable(),
  seed: z.number().int().min(1).max(CAP_RUSH_LEAGUE_TEAMS).nullable(),
});
export type CapRushHistoryPostseason = z.infer<typeof capRushHistoryPostseasonSchema>;

export function capRushPlayoffSeriesId(round: number, seriesSlot: number): string {
  return `crs-${String(round)}-${String(seriesSlot)}`;
}

export function capRushPlayoffGameId(round: number, seriesSlot: number, ordinal: number): string {
  return `crp-${String(round)}-${String(seriesSlot)}-${String(ordinal)}`;
}

export function capRushSeriesWins(series: CapRushPlayoffSeries, teamId: string): number {
  return series.games.filter((game) => game.winnerTeamId === teamId).length;
}

export function capRushSeriesWinner(series: CapRushPlayoffSeries): string | null {
  const high = capRushSeriesWins(series, series.highTeamId);
  const low = capRushSeriesWins(series, series.lowTeamId);
  if (high >= CAP_RUSH_SERIES_WINS) return series.highTeamId;
  if (low >= CAP_RUSH_SERIES_WINS) return series.lowTeamId;
  return null;
}

export function capRushSeriesComplete(series: CapRushPlayoffSeries): boolean {
  return capRushSeriesWinner(series) !== null;
}
