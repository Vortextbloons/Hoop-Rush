import { z } from 'zod';
import { playerIdSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { capRushDigestSchema } from './cap-rush-versions.ts';

export const CAP_RUSH_LEAGUE_VERSION = 'cap-rush-league-v1';
export const CAP_RUSH_TAKEOVER_TEAMS = 30;
export const CAP_RUSH_CONFERENCE_GAMES_PER_TEAM = 82;
export const CAP_RUSH_CONFERENCE_GAMES = 1230;
export const CAP_RUSH_CONFERENCE_AI_GAMES = 1148;
export const CAP_RUSH_CONFERENCE_SIZE = 15;
export const CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS = 8;
export const CAP_RUSH_HOME_GAMES_PER_TEAM = 41;
export const CAP_RUSH_DIVISION_GAMES = 16;
export const CAP_RUSH_CONFERENCE_NON_DIVISION_GAMES = 36;
export const CAP_RUSH_OPPOSITE_CONFERENCE_GAMES = 30;

export const capRushConferenceSchema = z.enum(['east', 'west']);
export type CapRushConference = z.infer<typeof capRushConferenceSchema>;

export const capRushDivisionSchema = z.enum([
  'atlantic',
  'central',
  'southeast',
  'northwest',
  'pacific',
  'southwest',
]);
export type CapRushDivision = z.infer<typeof capRushDivisionSchema>;

export const CAP_RUSH_DIVISION_TEAMS = {
  atlantic: ['celtics', 'nets', 'knicks', 'sixers', 'raptors'],
  central: ['bulls', 'cavaliers', 'pistons', 'pacers', 'bucks'],
  southeast: ['hawks', 'hornets', 'heat', 'magic', 'wizards'],
  northwest: ['nuggets', 'timberwolves', 'thunder', 'blazers', 'jazz'],
  pacific: ['warriors', 'clippers', 'lakers', 'suns', 'kings'],
  southwest: ['mavericks', 'rockets', 'grizzlies', 'pelicans', 'spurs'],
} as const satisfies Record<CapRushDivision, readonly string[]>;

export const CAP_RUSH_CONFERENCE_DIVISIONS = {
  east: ['atlantic', 'central', 'southeast'],
  west: ['northwest', 'pacific', 'southwest'],
} as const satisfies Record<CapRushConference, readonly CapRushDivision[]>;

export const CAP_RUSH_CONFERENCE_NAMES = {
  east: 'Eastern Conference',
  west: 'Western Conference',
} as const satisfies Record<CapRushConference, string>;

export interface CapRushFranchiseAlignment {
  readonly franchiseId: string;
  readonly conference: CapRushConference;
  readonly division: CapRushDivision;
}

export const CAP_RUSH_FRANCHISE_ALIGNMENT: readonly CapRushFranchiseAlignment[] = (
  Object.keys(CAP_RUSH_DIVISION_TEAMS) as CapRushDivision[]
).flatMap((division) =>
  CAP_RUSH_DIVISION_TEAMS[division].map((franchiseId) => ({
    franchiseId,
    conference: (CAP_RUSH_CONFERENCE_DIVISIONS.east as readonly CapRushDivision[]).includes(
      division,
    )
      ? ('east' as const)
      : ('west' as const),
    division,
  })),
);

const alignmentById = new Map(
  CAP_RUSH_FRANCHISE_ALIGNMENT.map((entry) => [entry.franchiseId, entry]),
);

export function capRushAlignmentOf(franchiseId: string): CapRushFranchiseAlignment {
  const alignment = alignmentById.get(franchiseId);
  if (alignment === undefined) {
    throw new Error(`cap rush league: unknown franchise ${franchiseId}`);
  }
  return alignment;
}

export function capRushConferenceTeams(conference: CapRushConference): readonly string[] {
  return CAP_RUSH_FRANCHISE_ALIGNMENT.filter((entry) => entry.conference === conference).map(
    (entry) => entry.franchiseId,
  );
}

export const capRushLeagueGameIdSchema = z
  .string()
  .regex(/^crl-[0-9]{2}-[a-z0-9._:]+-[a-z0-9._:]+$/);
export type CapRushLeagueGameId = z.infer<typeof capRushLeagueGameIdSchema>;

export function capRushLeagueGameId(slot: number, homeTeamId: string, awayTeamId: string): string {
  return `crl-${String(slot).padStart(2, '0')}-${homeTeamId}-${awayTeamId}`;
}

export const capRushLeagueScheduleEntrySchema = z
  .object({
    gameId: capRushLeagueGameIdSchema,
    slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    homeTeamId: z.string().min(1).max(64),
    awayTeamId: z.string().min(1).max(64),
  })
  .superRefine((entry, ctx) => {
    if (entry.homeTeamId === entry.awayTeamId) {
      ctx.addIssue({ code: 'custom', message: 'a team cannot play itself' });
    }
  });
export type CapRushLeagueScheduleEntry = z.infer<typeof capRushLeagueScheduleEntrySchema>;

export const capRushBoxParticipantSchema = z.object({
  slot: positionSchema,
  kind: z.enum(['starter', 'replacement', 'clone']),
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
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
  threesMade: z.number().int().nonnegative(),
  threesAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  adjustments: z.number().int(),
});
export type CapRushBoxParticipant = z.infer<typeof capRushBoxParticipantSchema>;

export const capRushTeamBoxSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  points: z.number().int(),
  adjustments: z.number().int(),
  teamBonusPoints: z.number().int(),
  periods: z.array(z.number().int()).min(4).max(30),
  participants: z.array(capRushBoxParticipantSchema).min(5).max(15),
});
export type CapRushTeamBox = z.infer<typeof capRushTeamBoxSchema>;

export const capRushBoxScoreSchema = z
  .object({
    home: capRushTeamBoxSchema,
    away: capRushTeamBoxSchema,
    overtimePeriods: z.number().int().nonnegative(),
  })
  .superRefine((box, ctx) => {
    if (box.home.points === box.away.points) {
      ctx.addIssue({ code: 'custom', message: 'a completed game never ends tied' });
    }
    if (box.home.periods.length !== box.away.periods.length) {
      ctx.addIssue({ code: 'custom', message: 'both teams must record the same periods' });
    }
  });
export type CapRushBoxScore = z.infer<typeof capRushBoxScoreSchema>;

export const capRushLeagueGameSchema = z
  .object({
    gameId: capRushLeagueGameIdSchema,
    slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    homeTeamId: z.string().min(1).max(64),
    awayTeamId: z.string().min(1).max(64),
    homePoints: z.number().int(),
    awayPoints: z.number().int(),
    winnerTeamId: z.string().min(1).max(64),
    box: capRushBoxScoreSchema,
    inputDigest: capRushDigestSchema,
    resultDigest: capRushDigestSchema,
  })
  .superRefine((game, ctx) => {
    const expected = capRushLeagueGameId(game.slot, game.homeTeamId, game.awayTeamId);
    if (game.gameId !== expected) {
      ctx.addIssue({ code: 'custom', message: 'league game id does not match its identity' });
    }
    if (game.homeTeamId === game.awayTeamId) {
      ctx.addIssue({ code: 'custom', message: 'a team cannot play itself' });
    }
    const expectedWinner = game.homePoints > game.awayPoints ? game.homeTeamId : game.awayTeamId;
    if (game.winnerTeamId !== expectedWinner) {
      ctx.addIssue({ code: 'custom', message: 'league winner disagrees with the scoreline' });
    }
    if (game.box.home.points !== game.homePoints || game.box.away.points !== game.awayPoints) {
      ctx.addIssue({ code: 'custom', message: 'league box score disagrees with the scoreline' });
    }
    if (game.box.home.teamId !== game.homeTeamId || game.box.away.teamId !== game.awayTeamId) {
      ctx.addIssue({ code: 'custom', message: 'league box score teams do not match the matchup' });
    }
  });
export type CapRushLeagueGame = z.infer<typeof capRushLeagueGameSchema>;

export const capRushLeagueStandingsEntrySchema = z
  .object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    isUserTeam: z.boolean(),
    conference: capRushConferenceSchema,
    division: capRushDivisionSchema,
    wins: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    losses: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    conferenceWins: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    conferenceLosses: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    pointDifferential: z.number().int(),
    seed: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_SIZE),
    qualified: z.boolean(),
  })
  .superRefine((entry, ctx) => {
    if (entry.wins + entry.losses !== CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
      ctx.addIssue({ code: 'custom', message: 'every team must play 82 games' });
    }
    if (entry.conferenceWins + entry.conferenceLosses > CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) {
      ctx.addIssue({ code: 'custom', message: 'conference games cannot exceed the schedule' });
    }
    if (entry.pointDifferential !== entry.pointsFor - entry.pointsAgainst) {
      ctx.addIssue({ code: 'custom', message: 'point differential must match its points' });
    }
    if (entry.qualified !== entry.seed <= CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS) {
      ctx.addIssue({ code: 'custom', message: 'only the top eight conference seeds qualify' });
    }
    if (capRushAlignmentOf(entry.teamId).conference !== entry.conference) {
      ctx.addIssue({ code: 'custom', message: 'standings conference does not match alignment' });
    }
    if (capRushAlignmentOf(entry.teamId).division !== entry.division) {
      ctx.addIssue({ code: 'custom', message: 'standings division does not match alignment' });
    }
  });
export type CapRushLeagueStandingsEntry = z.infer<typeof capRushLeagueStandingsEntrySchema>;

export const capRushConferenceCutoffSchema = z.object({
  conference: capRushConferenceSchema,
  seed: z.literal(CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS),
  teamId: z.string().min(1).max(64),
  wins: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  losses: z.number().int().min(0).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  pointDifferential: z.number().int(),
  pointsFor: z.number().int(),
  tieBreak: z.enum([
    'wins',
    'head-to-head',
    'conference',
    'point-differential',
    'points-for',
    'team-id',
  ]),
});
export type CapRushConferenceCutoff = z.infer<typeof capRushConferenceCutoffSchema>;

export const capRushConferenceTableSchema = z
  .object({
    conference: capRushConferenceSchema,
    entries: z.array(capRushLeagueStandingsEntrySchema).length(CAP_RUSH_CONFERENCE_SIZE),
    cutoff: capRushConferenceCutoffSchema,
  })
  .superRefine((table, ctx) => {
    table.entries.forEach((entry, index) => {
      if (entry.seed !== index + 1) {
        ctx.addIssue({ code: 'custom', message: 'conference seeds must be sequential' });
      }
      if (entry.conference !== table.conference) {
        ctx.addIssue({ code: 'custom', message: 'conference table holds another conference' });
      }
    });
    if (table.cutoff.conference !== table.conference) {
      ctx.addIssue({ code: 'custom', message: 'conference cutoff does not match its table' });
    }
    const cutoff = table.entries[CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS - 1];
    if (cutoff === undefined || cutoff.teamId !== table.cutoff.teamId) {
      ctx.addIssue({ code: 'custom', message: 'conference cutoff must be the eighth seed' });
    }
  });
export type CapRushConferenceTable = z.infer<typeof capRushConferenceTableSchema>;

export const capRushStandingsResultSchema = z
  .object({
    gameId: z.string().min(1).max(80),
    homeTeamId: z.string().min(1).max(64),
    awayTeamId: z.string().min(1).max(64),
    homePoints: z.number().int(),
    awayPoints: z.number().int(),
  })
  .superRefine((game, ctx) => {
    if (game.homeTeamId === game.awayTeamId) {
      ctx.addIssue({ code: 'custom', message: 'a team cannot play itself' });
    }
    if (game.homePoints === game.awayPoints) {
      ctx.addIssue({ code: 'custom', message: 'a completed game never ends tied' });
    }
  });
export type CapRushStandingsResult = z.infer<typeof capRushStandingsResultSchema>;
export type CapRushStandingsGame = CapRushStandingsResult;

export const capRushConferenceStandingsSchema = z.object({
  version: z.literal(CAP_RUSH_LEAGUE_VERSION),
  format: z.literal('conference'),
  west: capRushConferenceTableSchema,
  east: capRushConferenceTableSchema,
  qualifiedTeamIds: z.array(z.string().min(1).max(64)).length(16),
  games: z.array(capRushStandingsResultSchema).length(CAP_RUSH_CONFERENCE_GAMES),
});
export type CapRushConferenceStandings = z.infer<typeof capRushConferenceStandingsSchema>;

export function capRushConferenceStandingsEntries(
  standings: CapRushConferenceStandings,
): CapRushLeagueStandingsEntry[] {
  return [...standings.west.entries, ...standings.east.entries];
}

export function isConferenceStandings(
  standings: CapRushConferenceStandings | object,
): standings is CapRushConferenceStandings {
  return 'format' in standings && (standings as { format?: unknown }).format === 'conference';
}

export function capRushConferenceTableOf(
  standings: CapRushConferenceStandings,
  conference: CapRushConference,
): CapRushConferenceTable {
  return conference === 'west' ? standings.west : standings.east;
}
