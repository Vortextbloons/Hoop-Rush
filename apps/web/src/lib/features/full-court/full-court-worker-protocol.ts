import {
  CAP_RUSH_CONFERENCE_GAMES_PER_TEAM,
  CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS,
  CAP_RUSH_CONFERENCE_SIZE,
  CAP_RUSH_TAKEOVER_TEAMS,
  capRushCatalogSourceSchema,
  capRushConferenceSchema,
  capRushDivisionSchema,
  capRushLeagueGameIdSchema,
  capRushPlayoffGamePlanSchema,
  eraSimulationProfileSchema,
  fullCourtCoachingRulesSchema,
  fullCourtDefensiveMatchupsSchema,
  fullCourtHealthProfileSetSchema,
  fullCourtOffensiveHierarchySchema,
  fullCourtPlayoffCheckpointSchema,
  fullCourtPracticeReportSchema,
  fullCourtSeasonCheckpointSchema,
  fullCourtSeasonScoreSchema,
  fullCourtTacticsSchema,
  fullCourtTeamHealthSchema,
  idSchema,
  seasonKeySchema,
  seedSchema,
  simulationPlayerSchema,
  type FullCourtPlayoffCheckpoint,
  type FullCourtSeasonCheckpoint,
  type Seed,
} from '@hoop-rush/data-contracts';
import type {
  FullCourtAiGameChunk,
  FullCourtPlayoffGameOutcome,
  FullCourtPlayoffLock,
  FullCourtSeasonLock,
  FullCourtSeasonSlotOptions,
  FullCourtSeasonSlotOutcome,
  FullCourtTrainingCampOptions,
  FullCourtUserSlotOutcome,
} from '@hoop-rush/engine';
import { z } from 'zod';

export const FULL_COURT_WORKER_WIRE_SCHEMA_VERSION = 1;

const LEAGUE_GAMES = (CAP_RUSH_TAKEOVER_TEAMS * CAP_RUSH_CONFERENCE_GAMES_PER_TEAM) / 2;
const SLOT_GAMES = CAP_RUSH_TAKEOVER_TEAMS / 2;

const sideSchema = z.enum(['home', 'away']);
const sideHealthSchema = z.object({
  home: fullCourtTeamHealthSchema,
  away: fullCourtTeamHealthSchema,
});

const fullCourtAvailabilitySchema = z.object({
  playerId: z.string().min(1).max(64),
  available: z.boolean(),
  reason: z.enum(['injury', 'rest', 'suspension', 'other']).optional(),
  energy: z.number().min(0).max(1).optional(),
  staminaRating: z.number().min(0).max(100).optional(),
  stamina: z.number().min(0).max(1).optional(),
});

const fullCourtRotationPlanInputSchema = z.object({
  startingFive: z.array(z.string().min(1).max(64)).max(5).optional(),
  minuteTargets: z.record(z.string().min(1).max(64), z.number().nonnegative()).optional(),
  substitutionPriority: z.record(z.string().min(1).max(64), z.number()).optional(),
  closingFive: z.array(z.string().min(1).max(64)).max(5).optional(),
  units: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        playerIds: z.array(z.string().min(1).max(64)).min(1).max(12),
      }),
    )
    .max(20)
    .optional(),
  rules: fullCourtCoachingRulesSchema.optional(),
  staggerStars: z.boolean().optional(),
});

const fullCourtSeasonTeamSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  anchorSeason: seasonKeySchema.nullable(),
  roster: z.array(simulationPlayerSchema).min(5).max(12),
  rotation: fullCourtRotationPlanInputSchema.optional(),
  tactics: fullCourtTacticsSchema.optional(),
  availability: z.array(fullCourtAvailabilitySchema).max(12).optional(),
});

const fullCourtLeagueGameSchema = z.object({
  gameId: capRushLeagueGameIdSchema,
  slot: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_GAMES_PER_TEAM),
  homeTeamId: z.string().min(1).max(64),
  awayTeamId: z.string().min(1).max(64),
  dayOffset: z.number().int().nonnegative(),
});

const fullCourtSeasonSchema = z.object({
  runId: idSchema,
  runSeed: seedSchema,
  catalog: capRushCatalogSourceSchema,
  profile: eraSimulationProfileSchema,
  userTeamId: z.string().min(1).max(64),
  teams: z.array(fullCourtSeasonTeamSchema).length(CAP_RUSH_TAKEOVER_TEAMS),
  games: z.array(fullCourtLeagueGameSchema).length(LEAGUE_GAMES),
});

export const fullCourtSeasonLockSchema = z.object({
  digest: seedSchema,
  season: fullCourtSeasonSchema,
  injuryProfiles: fullCourtHealthProfileSetSchema.optional(),
});

const fullCourtStandingsRowSchema = z.object({
  teamId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  conference: capRushConferenceSchema,
  division: capRushDivisionSchema,
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  conferenceWins: z.number().int().nonnegative(),
  conferenceLosses: z.number().int().nonnegative(),
  pointsFor: z.number().int().nonnegative(),
  pointsAgainst: z.number().int().nonnegative(),
  pointDifferential: z.number().int(),
  seed: z.number().int().min(1).max(CAP_RUSH_CONFERENCE_SIZE),
  qualified: z.boolean(),
});

const fullCourtStandingsSchema = z.object({
  west: z.array(fullCourtStandingsRowSchema).length(CAP_RUSH_CONFERENCE_SIZE),
  east: z.array(fullCourtStandingsRowSchema).length(CAP_RUSH_CONFERENCE_SIZE),
  qualifiedTeamIds: z
    .array(z.string().min(1).max(64))
    .length(CAP_RUSH_CONFERENCE_PLAYOFF_TEAMS * 2),
});

/**
 * The first playoff request carries the playoff inputs plus the locked season
 * when the worker has not hydrated it yet. Later requests reference the cached
 * copies by run and digest so the large rosters and schedule are not cloned
 * again for every game.
 */
export const fullCourtWorkerPlayoffPayloadSchema = z.object({
  digest: seedSchema,
  seasonLockDigest: seedSchema,
  seasonLock: fullCourtSeasonLockSchema.optional(),
  standings: fullCourtStandingsSchema,
  initialHealth: z.record(z.string().min(1), fullCourtTeamHealthSchema),
  regularScores: z.array(fullCourtSeasonScoreSchema).length(LEAGUE_GAMES),
  firstGameDay: z.number().int().nonnegative(),
});
export type FullCourtWorkerPlayoffPayload = z.infer<typeof fullCourtWorkerPlayoffPayloadSchema>;
export type FullCourtWorkerSeasonLock = z.infer<typeof fullCourtSeasonLockSchema>;

const fullCourtSeasonSlotOptionsSchema = z.object({
  rotation: fullCourtRotationPlanInputSchema.optional(),
  tactics: fullCourtTacticsSchema.optional(),
  rules: fullCourtCoachingRulesSchema.optional(),
  hierarchy: fullCourtOffensiveHierarchySchema.optional(),
  defensiveMatchups: fullCourtDefensiveMatchupsSchema.optional(),
  restingPlayerIds: z.array(z.string().min(1).max(64)).max(12).optional(),
  acceptForfeit: z.boolean().optional(),
  record: z.boolean().optional(),
});

const fullCourtTrainingCampOptionsSchema = z.object({
  rotation: fullCourtRotationPlanInputSchema.optional(),
  tactics: fullCourtTacticsSchema.optional(),
  rules: fullCourtCoachingRulesSchema.optional(),
  hierarchy: fullCourtOffensiveHierarchySchema.optional(),
  defensiveMatchups: fullCourtDefensiveMatchupsSchema.optional(),
});

const fullCourtPlayoffFixtureSchema = capRushPlayoffGamePlanSchema.extend({
  gameId: z.string().min(1).max(128),
  dayOffset: z.number().int().nonnegative(),
});

function isRestConflict(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as Record<string, unknown>;
  return (
    outcome.kind === 'rest-conflict' &&
    z.array(sideSchema).min(1).max(2).safeParse(outcome.sides).success
  );
}

/**
 * Engine game outputs are large and have no data-contract schema yet. Validate
 * the resumable health and the envelope discriminants here; the engine audit
 * already checked accounting in the worker.
 */
function isGameHealthOutcome(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === 'rest-conflict') return isRestConflict(outcome);
  if (outcome.kind === 'forfeit') {
    return (
      z.array(sideSchema).min(1).max(2).safeParse(outcome.sides).success &&
      (outcome.winner === null || outcome.winner === 'home' || outcome.winner === 'away') &&
      sideHealthSchema.safeParse(outcome.health).success
    );
  }
  if (outcome.kind !== 'played') return false;
  if (!sideHealthSchema.safeParse(outcome.health).success) return false;
  if (!Array.isArray(outcome.injuries)) return false;
  if (outcome.tape !== null && !Array.isArray(outcome.tape)) return false;
  const result = outcome.result;
  if (typeof result !== 'object' || result === null) return false;
  const game = result as Record<string, unknown>;
  return (
    game.schemaVersion === 1 &&
    typeof game.home === 'object' &&
    game.home !== null &&
    typeof game.away === 'object' &&
    game.away !== null
  );
}

function isResolvedGameOutcome(value: unknown): boolean {
  return isGameHealthOutcome(value) && !isRestConflict(value);
}

const seasonSlotOutcomeSchema = z.custom<FullCourtSeasonSlotOutcome>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === 'season-complete') return true;
  if (outcome.kind === 'decision') {
    return (
      (outcome.reason === 'rest-conflict' || outcome.reason === 'confirm-forfeit') &&
      fullCourtLeagueGameSchema.safeParse(outcome.fixture).success
    );
  }
  if (outcome.kind !== 'simulated') return false;
  return (
    fullCourtSeasonCheckpointSchema.safeParse(outcome.checkpoint).success &&
    z.array(fullCourtSeasonScoreSchema).length(SLOT_GAMES).safeParse(outcome.scores).success &&
    isResolvedGameOutcome(outcome.userGame)
  );
}, 'invalid full court season slot outcome');

const playoffGameOutcomeSchema = z.custom<FullCourtPlayoffGameOutcome>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === 'playoffs-complete') return true;
  if (outcome.kind === 'decision') {
    return (
      (outcome.reason === 'rest-conflict' || outcome.reason === 'confirm-forfeit') &&
      fullCourtPlayoffFixtureSchema.safeParse(outcome.fixture).success
    );
  }
  if (outcome.kind !== 'simulated') return false;
  return (
    fullCourtPlayoffCheckpointSchema.safeParse(outcome.checkpoint).success &&
    isResolvedGameOutcome(outcome.game)
  );
}, 'invalid full court playoff outcome');

const userSlotOutcomeSchema = z.custom<FullCourtUserSlotOutcome>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const outcome = value as Record<string, unknown>;
  if (outcome.kind === 'season-complete') return true;
  if (outcome.kind === 'decision') {
    return (
      (outcome.reason === 'rest-conflict' || outcome.reason === 'confirm-forfeit') &&
      fullCourtLeagueGameSchema.safeParse(outcome.fixture).success
    );
  }
  if (outcome.kind !== 'user-ready') return false;
  return (
    typeof outcome.slot === 'number' &&
    typeof outcome.userGameId === 'string' &&
    fullCourtSeasonScoreSchema.safeParse(outcome.userScore).success &&
    z.record(z.string().min(1).max(64), fullCourtTeamHealthSchema).safeParse(outcome.healthByTeam)
      .success &&
    isResolvedGameOutcome(outcome.userGame)
  );
}, 'invalid full court user slot outcome');

const aiGameChunkSchema = z.custom<FullCourtAiGameChunk>((value) => {
  if (typeof value !== 'object' || value === null) return false;
  const chunk = value as Record<string, unknown>;
  return (
    z.array(fullCourtSeasonScoreSchema).min(1).max(SLOT_GAMES).safeParse(chunk.scores).success &&
    z.record(z.string().min(1).max(64), fullCourtTeamHealthSchema).safeParse(chunk.healthByTeam)
      .success
  );
}, 'invalid full court AI game chunk');

const fullCourtWorkerBase = z.object({
  schemaVersion: z.literal(FULL_COURT_WORKER_WIRE_SCHEMA_VERSION),
  requestId: z.string().min(1).max(64),
});

export const fullCourtWorkerSlotRequestSchema = fullCourtWorkerBase
  .extend({
    type: z.literal('full-court-simulate-slot'),
    runId: idSchema,
    lockDigest: seedSchema,
    lock: fullCourtSeasonLockSchema.optional(),
    checkpoint: fullCourtSeasonCheckpointSchema,
    options: fullCourtSeasonSlotOptionsSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.checkpoint.runId !== request.runId) {
      context.addIssue({ code: 'custom', message: 'checkpoint run does not match the request' });
    }
    if (request.checkpoint.lockDigest !== request.lockDigest) {
      context.addIssue({ code: 'custom', message: 'checkpoint lock does not match the request' });
    }
    if (request.lock !== undefined) {
      if (request.lock.season.runId !== request.runId) {
        context.addIssue({
          code: 'custom',
          message: 'locked season run does not match the request',
        });
      }
      if (request.lock.digest !== request.lockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'locked season digest does not match the request',
        });
      }
    }
  });

export const fullCourtWorkerPracticeRequestSchema = fullCourtWorkerBase
  .extend({
    type: z.literal('full-court-simulate-practice'),
    runId: idSchema,
    lockDigest: seedSchema,
    lock: fullCourtSeasonLockSchema.optional(),
    seed: seedSchema,
    opponentTeamId: z.string().min(1).max(64),
    options: fullCourtTrainingCampOptionsSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.lock !== undefined) {
      if (request.lock.season.runId !== request.runId) {
        context.addIssue({
          code: 'custom',
          message: 'locked season run does not match the practice request',
        });
      }
      if (request.lock.digest !== request.lockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'locked season digest does not match the practice request',
        });
      }
    }
  });

export const fullCourtWorkerGameRequestSchema = fullCourtWorkerBase
  .extend({
    type: z.literal('full-court-simulate-game'),
    runId: idSchema,
    lockDigest: seedSchema,
    playoffLock: fullCourtWorkerPlayoffPayloadSchema.optional(),
    checkpoint: fullCourtPlayoffCheckpointSchema,
    options: fullCourtSeasonSlotOptionsSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.checkpoint.runId !== request.runId) {
      context.addIssue({ code: 'custom', message: 'checkpoint run does not match the request' });
    }
    if (request.checkpoint.lockDigest !== request.lockDigest) {
      context.addIssue({ code: 'custom', message: 'checkpoint lock does not match the request' });
    }
    const payload = request.playoffLock;
    if (payload === undefined) return;
    if (payload.digest !== request.lockDigest) {
      context.addIssue({ code: 'custom', message: 'playoff lock does not match the request' });
    }
    if (payload.seasonLock !== undefined) {
      if (payload.seasonLock.season.runId !== request.runId) {
        context.addIssue({
          code: 'custom',
          message: 'locked season run does not match the request',
        });
      }
      if (payload.seasonLock.digest !== payload.seasonLockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'locked season digest does not match the playoff inputs',
        });
      }
    }
  });

export const fullCourtWorkerUserSlotRequestSchema = fullCourtWorkerBase
  .extend({
    type: z.literal('full-court-simulate-user-slot'),
    runId: idSchema,
    lockDigest: seedSchema,
    lock: fullCourtSeasonLockSchema.optional(),
    checkpoint: fullCourtSeasonCheckpointSchema,
    options: fullCourtSeasonSlotOptionsSchema.optional(),
  })
  .superRefine((request, context) => {
    if (request.checkpoint.runId !== request.runId) {
      context.addIssue({ code: 'custom', message: 'checkpoint run does not match the request' });
    }
    if (request.checkpoint.lockDigest !== request.lockDigest) {
      context.addIssue({ code: 'custom', message: 'checkpoint lock does not match the request' });
    }
    if (request.lock !== undefined) {
      if (request.lock.season.runId !== request.runId) {
        context.addIssue({
          code: 'custom',
          message: 'locked season run does not match the request',
        });
      }
      if (request.lock.digest !== request.lockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'locked season digest does not match the request',
        });
      }
    }
  });

export const fullCourtWorkerAiGamesRequestSchema = fullCourtWorkerBase
  .extend({
    type: z.literal('full-court-simulate-ai-games'),
    runId: idSchema,
    lockDigest: seedSchema,
    lock: fullCourtSeasonLockSchema.optional(),
    checkpoint: fullCourtSeasonCheckpointSchema,
    gameIds: z.array(capRushLeagueGameIdSchema).min(1).max(SLOT_GAMES),
  })
  .superRefine((request, context) => {
    if (request.checkpoint.runId !== request.runId) {
      context.addIssue({ code: 'custom', message: 'checkpoint run does not match the request' });
    }
    if (request.checkpoint.lockDigest !== request.lockDigest) {
      context.addIssue({ code: 'custom', message: 'checkpoint lock does not match the request' });
    }
    if (request.lock !== undefined) {
      if (request.lock.season.runId !== request.runId) {
        context.addIssue({
          code: 'custom',
          message: 'locked season run does not match the request',
        });
      }
      if (request.lock.digest !== request.lockDigest) {
        context.addIssue({
          code: 'custom',
          message: 'locked season digest does not match the request',
        });
      }
    }
  });

export const fullCourtWorkerRequestSchema = z.discriminatedUnion('type', [
  fullCourtWorkerSlotRequestSchema,
  fullCourtWorkerUserSlotRequestSchema,
  fullCourtWorkerAiGamesRequestSchema,
  fullCourtWorkerGameRequestSchema,
  fullCourtWorkerPracticeRequestSchema,
]);
export type FullCourtWorkerRequest = z.infer<typeof fullCourtWorkerRequestSchema>;

export const fullCourtWorkerSlotResultSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-slot-result'),
  outcome: seasonSlotOutcomeSchema,
});
export type FullCourtWorkerSlotResultMessage = z.infer<typeof fullCourtWorkerSlotResultSchema>;

export const fullCourtWorkerGameResultSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-game-result'),
  outcome: playoffGameOutcomeSchema,
});
export type FullCourtWorkerGameResultMessage = z.infer<typeof fullCourtWorkerGameResultSchema>;

export const fullCourtWorkerPracticeResultSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-practice-result'),
  report: fullCourtPracticeReportSchema,
});
export type FullCourtWorkerPracticeResultMessage = z.infer<
  typeof fullCourtWorkerPracticeResultSchema
>;

export const fullCourtWorkerErrorSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-error'),
  code: z.enum(['lock-missing', 'internal']),
  message: z.string().min(1).max(512),
});
export type FullCourtWorkerErrorMessage = z.infer<typeof fullCourtWorkerErrorSchema>;

export const fullCourtWorkerUserSlotResultSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-user-slot-result'),
  outcome: userSlotOutcomeSchema,
});
export type FullCourtWorkerUserSlotResultMessage = z.infer<
  typeof fullCourtWorkerUserSlotResultSchema
>;

export const fullCourtWorkerAiGamesResultSchema = fullCourtWorkerBase.extend({
  type: z.literal('full-court-ai-games-result'),
  chunk: aiGameChunkSchema,
});
export type FullCourtWorkerAiGamesResultMessage = z.infer<
  typeof fullCourtWorkerAiGamesResultSchema
>;

export const fullCourtWorkerMessageSchema = z.discriminatedUnion('type', [
  fullCourtWorkerSlotResultSchema,
  fullCourtWorkerUserSlotResultSchema,
  fullCourtWorkerAiGamesResultSchema,
  fullCourtWorkerGameResultSchema,
  fullCourtWorkerPracticeResultSchema,
  fullCourtWorkerErrorSchema,
]);
export type FullCourtWorkerMessage = z.infer<typeof fullCourtWorkerMessageSchema>;

export interface FullCourtWorkerSlotRequestInput {
  readonly schemaVersion: typeof FULL_COURT_WORKER_WIRE_SCHEMA_VERSION;
  readonly type: 'full-court-simulate-slot';
  readonly requestId: string;
  readonly runId: string;
  readonly lockDigest: Seed;
  readonly lock?: FullCourtSeasonLock;
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly options?: FullCourtSeasonSlotOptions;
}

export type FullCourtWorkerPlayoffPayloadInput = Omit<FullCourtPlayoffLock, 'seasonLock'> & {
  readonly seasonLockDigest: Seed;
  readonly seasonLock?: FullCourtSeasonLock;
};

export interface FullCourtWorkerGameRequestInput {
  readonly schemaVersion: typeof FULL_COURT_WORKER_WIRE_SCHEMA_VERSION;
  readonly type: 'full-court-simulate-game';
  readonly requestId: string;
  readonly runId: string;
  readonly lockDigest: Seed;
  readonly playoffLock?: FullCourtWorkerPlayoffPayloadInput;
  readonly checkpoint: FullCourtPlayoffCheckpoint;
  readonly options?: FullCourtSeasonSlotOptions;
}

export interface FullCourtWorkerPracticeRequestInput {
  readonly schemaVersion: typeof FULL_COURT_WORKER_WIRE_SCHEMA_VERSION;
  readonly type: 'full-court-simulate-practice';
  readonly requestId: string;
  readonly runId: string;
  readonly lockDigest: Seed;
  readonly lock?: FullCourtSeasonLock;
  readonly seed: Seed;
  readonly opponentTeamId: string;
  readonly options?: FullCourtTrainingCampOptions;
}

export interface FullCourtWorkerUserSlotRequestInput {
  readonly schemaVersion: typeof FULL_COURT_WORKER_WIRE_SCHEMA_VERSION;
  readonly type: 'full-court-simulate-user-slot';
  readonly requestId: string;
  readonly runId: string;
  readonly lockDigest: Seed;
  readonly lock?: FullCourtSeasonLock;
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly options?: FullCourtSeasonSlotOptions;
}

export interface FullCourtWorkerAiGamesRequestInput {
  readonly schemaVersion: typeof FULL_COURT_WORKER_WIRE_SCHEMA_VERSION;
  readonly type: 'full-court-simulate-ai-games';
  readonly requestId: string;
  readonly runId: string;
  readonly lockDigest: Seed;
  readonly lock?: FullCourtSeasonLock;
  readonly checkpoint: FullCourtSeasonCheckpoint;
  readonly gameIds: readonly string[];
}

export type FullCourtWorkerRequestInput =
  | FullCourtWorkerSlotRequestInput
  | FullCourtWorkerUserSlotRequestInput
  | FullCourtWorkerAiGamesRequestInput
  | FullCourtWorkerGameRequestInput
  | FullCourtWorkerPracticeRequestInput;
