import { z } from 'zod';
import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  capRushLeagueGameIdSchema,
} from './cap-rush-league.ts';
import { fullCourtTeamHealthSchema } from './full-court-health.ts';
import { havocMutationIdSchema } from './havoc-mutations.ts';
import { idSchema, playerIdSchema, seedSchema } from './ids.ts';
import {
  madeAttemptedSchema,
  playerDiagnosticsSchema,
  teamBoxScoreSchema,
  teamDiagnosticsSchema,
} from './result.ts';
import { playerVersionIdSchema } from './season-identity.ts';

export const FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION = 1;
export const FULL_COURT_MAX_TAPE_EVENTS = 4000;
export const FULL_COURT_MAX_STINTS = 512;
export const FULL_COURT_MAX_REPLAY_PLAYERS = 24;
export const FULL_COURT_MAX_REPLAY_INJURIES = 24;

const FULL_COURT_PLAYOFF_GAME_ID_PATTERN = /^fcp-[1-4]-[0-7]-[1-7]$/;
const sideSchema = z.enum(['home', 'away']);
const sideIndexSchema = z.union([z.literal(0), z.literal(1)]);
const possessionStartSchema = z.enum([
  'neutral',
  'madeBasket',
  'deadBall',
  'liveTurnover',
  'defensiveRebound',
  'offensiveRebound',
]);

export const fullCourtTapeEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('period'),
    period: z.number().int().min(0).max(12),
    // Live scores are signed because deductions can land before a team scores.
    homeScore: z.number().int(),
    awayScore: z.number().int(),
  }),
  z.object({
    kind: z.literal('substitution'),
    period: z.number().int().min(0).max(12),
    clockSeconds: z.number().min(0).max(720),
    side: sideIndexSchema,
    outPlayerId: z.string().min(1).max(64),
    inPlayerId: z.string().min(1).max(64),
    reason: z.enum([
      'foul-out',
      'fatigue',
      'minute-target',
      'closing-five',
      'coach-rule',
      'emergency-continuation',
    ]),
  }),
  z.object({
    kind: z.literal('technical'),
    period: z.number().int().min(0).max(12),
    clockSeconds: z.number().min(0).max(720),
    side: sideIndexSchema,
    shooterPlayerId: z.string().min(1).max(64),
    made: z.boolean(),
    againstPlayerId: z.string().min(1).max(64),
    homeUnit: z.array(z.string().min(1).max(64)).min(5).max(10).optional(),
    awayUnit: z.array(z.string().min(1).max(64)).min(5).max(10).optional(),
  }),
  z.object({
    kind: z.literal('trip'),
    period: z.number().int().min(0).max(12),
    clockSeconds: z.number().min(0).max(720),
    secondsElapsed: z.number().min(0).max(720),
    offense: sideIndexSchema,
    ended: z.boolean(),
    nextPossessionStart: possessionStartSchema,
    homeScore: z.number().int(),
    awayScore: z.number().int(),
    homeUnit: z.array(z.string().min(1).max(64)).min(5).max(10),
    awayUnit: z.array(z.string().min(1).max(64)).min(5).max(10),
  }),
]);

export const fullCourtPlayerLineSchema = z.object({
  playerId: playerIdSchema,
  displayName: z.string().min(1).max(96),
  startedGame: z.boolean(),
  available: z.boolean(),
  plannedSeconds: z.number().int().nonnegative(),
  seconds: z.number().int().nonnegative(),
  minutes: z.number().nonnegative(),
  points: z.number().int(),
  fieldGoals: madeAttemptedSchema,
  threes: madeAttemptedSchema,
  freeThrows: madeAttemptedSchema,
  rebounds: z.object({
    total: z.number().int().nonnegative(),
    offensive: z.number().int().nonnegative(),
    defensive: z.number().int().nonnegative(),
  }),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  deepFours: madeAttemptedSchema.optional(),
  diagnostics: playerDiagnosticsSchema,
  energyRemaining: z.number().min(0).max(1),
  fatigueLevel: z.number().int().min(0).max(6),
  foulsOut: z.boolean(),
  emergencyContinuation: z.boolean(),
  stints: z.number().int().nonnegative(),
  kind: z.enum(['roster', 'clone']).optional(),
  ownerPlayerId: z.string().min(1).max(64).optional(),
  chargedFouls: z.number().int().nonnegative().optional(),
});

const fullCourtLineupStintSchema = z.object({
  playerIds: z.array(z.string().min(1).max(64)).min(5).max(10),
  startSeconds: z.number().int().nonnegative(),
  seconds: z.number().int().nonnegative(),
  points: z.number().int(),
  possessions: z.number().int().nonnegative(),
});

const fullCourtTeamBoxResultSchema = teamBoxScoreSchema.extend({
  deepFours: madeAttemptedSchema.optional(),
  shotClockViolations: z.number().int().nonnegative(),
  diagnostics: teamDiagnosticsSchema,
});

const fullCourtMutationRollupSchema = z.object({
  playerId: z.string().min(1).max(64),
  mutationId: havocMutationIdSchema,
  triggers: z.number().int().nonnegative(),
  pointsDelta: z.number().int(),
  freeThrowsGranted: z.number().int().nonnegative(),
  turnoversCancelled: z.number().int().nonnegative(),
  extraPossessionsEarned: z.number().int().nonnegative(),
  extraPossessionsUsed: z.number().int().nonnegative(),
  extraPossessionsExpired: z.number().int().nonnegative(),
});

export const fullCourtTeamResultSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  box: fullCourtTeamBoxResultSchema,
  players: z.array(fullCourtPlayerLineSchema).min(5).max(FULL_COURT_MAX_REPLAY_PLAYERS),
  liveSeconds: z.number().int().positive(),
  teamSeconds: z.number().int().positive(),
  plannedTeamSeconds: z.number().int().nonnegative(),
  stints: z.array(fullCourtLineupStintSchema).min(1).max(FULL_COURT_MAX_STINTS),
  technicalFouls: z.number().int().nonnegative(),
  disqualifications: z.number().int().nonnegative(),
  notes: z
    .array(
      z.object({
        code: z.enum([
          'auto-rotation',
          'auto-starters',
          'targets-scaled',
          'starter-unavailable',
          'closing-unavailable',
        ]),
        playerId: z.string().min(1).max(64).nullable(),
      }),
    )
    .max(32),
  units: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        rosterIndices: z.array(z.number().int().nonnegative()).min(5).max(10),
      }),
    )
    .max(20),
  teamBonusPoints: z.number().int().nonnegative().optional(),
  pointAdjustments: z.number().int().optional(),
  mutationRollups: z.array(fullCourtMutationRollupSchema).max(32).optional(),
});

export const fullCourtGameResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    seed: seedSchema,
    gameNumber: z.number().int().positive(),
    engineVersion: z.string().min(1).max(64),
    dataVersion: z.string().min(1).max(64),
    profileVersion: z.string().min(1).max(64),
    home: fullCourtTeamResultSchema,
    away: fullCourtTeamResultSchema,
    periodScores: z.object({
      home: z.array(z.number().int()).min(4).max(12),
      away: z.array(z.number().int()).min(4).max(12),
    }),
    winner: sideSchema,
    overtimePeriods: z.number().int().min(0).max(8),
    totalSeconds: z.number().positive(),
  })
  .superRefine((result, context) => {
    if (result.home.teamId === result.away.teamId) {
      context.addIssue({ code: 'custom', message: 'Full Court replay teams must be distinct' });
    }
    if (result.home.box.points === result.away.box.points) {
      context.addIssue({ code: 'custom', message: 'Full Court replay cannot end tied' });
    }
    const expectedWinner = result.home.box.points > result.away.box.points ? 'home' : 'away';
    if (result.winner !== expectedWinner) {
      context.addIssue({
        code: 'custom',
        message: 'Full Court replay winner disagrees with score',
      });
    }
  });

export const fullCourtInjuryEventSchema = z
  .object({
    teamId: z.string().min(1).max(64),
    playerId: playerIdSchema,
    playerVersionId: playerVersionIdSchema,
    cohortId: z.string().min(1).max(64),
    onsetDay: z.number().int().nonnegative(),
    gamesMissed: z.number().int().positive(),
    availableFromDay: z.number().int().positive(),
    projected: z.boolean(),
  })
  .refine((injury) => injury.availableFromDay > injury.onsetDay, {
    message: 'Injury return day must follow onset day',
  });

export const fullCourtWatchedReplayIdentitySchema = z
  .object({
    runId: idSchema,
    phase: z.enum(['regular', 'playoff']),
    seasonLockDigest: seedSchema,
    lockDigest: seedSchema,
    gameId: z.string().min(1).max(128),
    slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM).nullable(),
    dayOffset: z.number().int().nonnegative(),
    homeTeamId: z.string().min(1).max(64),
    awayTeamId: z.string().min(1).max(64),
    userTeamId: z.string().min(1).max(64),
    userSide: sideSchema,
    gameNumber: z.number().int().positive(),
    gameSeed: seedSchema,
  })
  .superRefine((identity, context) => {
    if (identity.homeTeamId === identity.awayTeamId) {
      context.addIssue({ code: 'custom', message: 'Replay teams must be distinct' });
    }
    const expectedUserSide =
      identity.userTeamId === identity.homeTeamId
        ? 'home'
        : identity.userTeamId === identity.awayTeamId
          ? 'away'
          : null;
    if (expectedUserSide !== identity.userSide) {
      context.addIssue({ code: 'custom', message: 'Replay user side does not match teams' });
    }
    if (identity.phase === 'regular') {
      if (identity.slot === null) {
        context.addIssue({ code: 'custom', message: 'Regular-season replay requires a slot' });
      }
      if (!capRushLeagueGameIdSchema.safeParse(identity.gameId).success) {
        context.addIssue({ code: 'custom', message: 'Invalid regular-season replay game ID' });
      }
      if (identity.lockDigest !== identity.seasonLockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'Regular-season replay lock digest must match season lock digest',
        });
      }
    } else {
      if (identity.slot !== null) {
        context.addIssue({ code: 'custom', message: 'Playoff replay cannot carry a slot' });
      }
      if (!FULL_COURT_PLAYOFF_GAME_ID_PATTERN.test(identity.gameId)) {
        context.addIssue({ code: 'custom', message: 'Invalid playoff replay game ID' });
      }
    }
  });
export type FullCourtWatchedReplayIdentity = z.infer<typeof fullCourtWatchedReplayIdentitySchema>;

export const fullCourtWatchedReplayFactsSchema = z
  .object({
    teamPoints: z.number().int().nonnegative(),
    opponentPoints: z.number().int().nonnegative(),
    userWon: z.boolean(),
    starterPoints: z.number().int(),
    benchPoints: z.number().int(),
    teamBonusPoints: z.number().int().nonnegative(),
    benchPlayerCount: z.number().int().nonnegative().max(FULL_COURT_MAX_REPLAY_PLAYERS),
    lineupCount: z.number().int().positive().max(FULL_COURT_MAX_STINTS),
  })
  .refine(
    (facts) => facts.starterPoints + facts.benchPoints + facts.teamBonusPoints === facts.teamPoints,
    'Replay facts points do not reconcile',
  );
export type FullCourtWatchedReplayFacts = z.infer<typeof fullCourtWatchedReplayFactsSchema>;

function finalTapeScore(
  tape: readonly z.infer<typeof fullCourtTapeEventSchema>[],
): { home: number; away: number } | null {
  let home = 0;
  let away = 0;
  let recorded = false;
  for (const event of tape) {
    if (event.kind === 'period') {
      home = event.homeScore;
      away = event.awayScore;
      recorded = true;
    } else if (event.kind === 'trip') {
      home = event.homeScore;
      away = event.awayScore;
      recorded = true;
    } else if (event.kind === 'technical' && event.made) {
      if (event.side === 0) home += 1;
      else away += 1;
    }
  }
  return recorded ? { home, away } : null;
}

export const fullCourtWatchedReplaySchema = z
  .object({
    schemaVersion: z.literal(FULL_COURT_WATCHED_REPLAY_SCHEMA_VERSION),
    identity: fullCourtWatchedReplayIdentitySchema,
    facts: fullCourtWatchedReplayFactsSchema,
    health: z.object({
      home: fullCourtTeamHealthSchema,
      away: fullCourtTeamHealthSchema,
    }),
    injuries: z.array(fullCourtInjuryEventSchema).max(FULL_COURT_MAX_REPLAY_INJURIES),
    result: fullCourtGameResultSchema,
    tape: z.array(fullCourtTapeEventSchema).min(1).max(FULL_COURT_MAX_TAPE_EVENTS),
  })
  .superRefine((replay, context) => {
    const { identity, facts, health, injuries, result } = replay;
    if (result.seed !== identity.gameSeed || result.gameNumber !== identity.gameNumber) {
      context.addIssue({
        code: 'custom',
        message: 'Replay result seed or game number disagrees with identity',
      });
    }
    if (result.home.teamId !== identity.homeTeamId || result.away.teamId !== identity.awayTeamId) {
      context.addIssue({ code: 'custom', message: 'Replay result teams disagree with identity' });
    }
    if (
      health.home.teamId !== identity.homeTeamId ||
      health.home.throughDay !== identity.dayOffset ||
      health.away.teamId !== identity.awayTeamId ||
      health.away.throughDay !== identity.dayOffset
    ) {
      context.addIssue({ code: 'custom', message: 'Replay health disagrees with game identity' });
    }
    for (const injury of injuries) {
      if (
        (injury.teamId !== identity.homeTeamId && injury.teamId !== identity.awayTeamId) ||
        injury.onsetDay !== identity.dayOffset
      ) {
        context.addIssue({ code: 'custom', message: 'Replay injury disagrees with game identity' });
      }
    }
    const opponentSide = identity.userSide === 'home' ? 'away' : 'home';
    if (
      facts.teamPoints !== result[identity.userSide].box.points ||
      facts.opponentPoints !== result[opponentSide].box.points ||
      facts.userWon !== (result.winner === identity.userSide) ||
      facts.teamBonusPoints !== (result[identity.userSide].teamBonusPoints ?? 0)
    ) {
      context.addIssue({ code: 'custom', message: 'Replay facts disagree with game result' });
    }
    const finalScore = finalTapeScore(replay.tape);
    if (
      finalScore !== null &&
      (finalScore.home !== result.home.box.points || finalScore.away !== result.away.box.points)
    ) {
      context.addIssue({ code: 'custom', message: 'Replay tape score disagrees with game result' });
    }
  });
export type FullCourtWatchedReplay = z.infer<typeof fullCourtWatchedReplaySchema>;
