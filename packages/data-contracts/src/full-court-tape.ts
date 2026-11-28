import { z } from 'zod';
import { playerIdSchema, seedSchema } from './ids.ts';
import {
  madeAttemptedSchema,
  playerDiagnosticsSchema,
  teamBoxScoreSchema,
  teamDiagnosticsSchema,
} from './result.ts';

export const FULL_COURT_MAX_TAPE_EVENTS = 4000;
export const FULL_COURT_MAX_STINTS = 512;
export const FULL_COURT_MAX_GAME_PLAYERS = 24;

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

/**
 * One player's share of a possession, in the order the broadcast box reads it.
 * Values are signed so a point adjustment can land before a player scores.
 */
export const FULL_COURT_TAPE_STAT_FIELDS = [
  'points',
  'fieldGoalMakes',
  'fieldGoalAttempts',
  'threeMakes',
  'threeAttempts',
  'freeThrowMakes',
  'freeThrowAttempts',
  'offensiveRebounds',
  'defensiveRebounds',
  'assists',
  'steals',
  'blocks',
  'turnovers',
  'fouls',
] as const;
export type FullCourtTapeStatField = (typeof FULL_COURT_TAPE_STAT_FIELDS)[number];

const tapeStatSchema = z.number().int().min(-10000).max(10000);
const tapeStatLineShape = FULL_COURT_TAPE_STAT_FIELDS.map(() => tapeStatSchema) as [
  typeof tapeStatSchema,
  ...(typeof tapeStatSchema)[],
];
export const fullCourtTapeStatLineSchema = z.tuple(tapeStatLineShape);
export type FullCourtTapeStatLine = z.infer<typeof fullCourtTapeStatLineSchema>;

export const fullCourtTapePlayerDeltaSchema = z.object({
  playerId: playerIdSchema,
  line: fullCourtTapeStatLineSchema,
});
export type FullCourtTapePlayerDelta = z.infer<typeof fullCourtTapePlayerDeltaSchema>;

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
    /** Only the players whose counters moved on this possession. */
    deltas: z.array(fullCourtTapePlayerDeltaSchema).max(FULL_COURT_MAX_GAME_PLAYERS).optional(),
  }),
]);
export type FullCourtTapeEvent = z.infer<typeof fullCourtTapeEventSchema>;

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

export const fullCourtTeamResultSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  box: fullCourtTeamBoxResultSchema,
  players: z.array(fullCourtPlayerLineSchema).min(5).max(FULL_COURT_MAX_GAME_PLAYERS),
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
    /**
     * The largest lead each side held at any point. Optional because older
     * recorded games predate the field; new games always set it.
     */
    largestDeficit: z
      .object({
        home: z.number().int().nonnegative(),
        away: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((result, context) => {
    if (result.home.teamId === result.away.teamId) {
      context.addIssue({ code: 'custom', message: 'Full Court game teams must be distinct' });
    }
    if (result.home.box.points === result.away.box.points) {
      context.addIssue({ code: 'custom', message: 'Full Court game cannot end tied' });
    }
    const expectedWinner = result.home.box.points > result.away.box.points ? 'home' : 'away';
    if (result.winner !== expectedWinner) {
      context.addIssue({
        code: 'custom',
        message: 'Full Court game winner disagrees with score',
      });
    }
  });
export type FullCourtGameResultContract = z.infer<typeof fullCourtGameResultSchema>;
