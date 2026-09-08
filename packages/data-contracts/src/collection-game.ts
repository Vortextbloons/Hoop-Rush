import { z } from 'zod';
import {
  collectionCardIdSchema,
  collectionRaritySchema,
  type CollectionRarity,
} from './collection.ts';
import { collectionActiveTeamSchema } from './collection-team.ts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_COMMAND_VERSION,
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  COLLECTION_GAME_ENVIRONMENT_ERA_ID,
  COLLECTION_GAME_HOME_COURT_POLICY,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_TEAM_VERSION,
} from './collection-versions.ts';
import { commandIdSchema, contentHashSchema, idSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import {
  seasonGamePlayerResultSchema,
  seasonGameSideResultSchema,
  seasonRotationDeviationReasonSchema,
  seasonSubstitutionReasonSchema,
} from './season-game-simulation.ts';

export const collectionGameIdSchema = z.string().regex(/^game-[0-9a-f]{32}$/);
export type CollectionGameId = z.infer<typeof collectionGameIdSchema>;

export const collectionGameRewardReasonSchema = z.enum(['game-win-reward', 'game-loss-reward']);
export type CollectionGameRewardReason = z.infer<typeof collectionGameRewardReasonSchema>;

export const collectionGameRewardSchema = z
  .object({
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    reason: collectionGameRewardReasonSchema,
    currency: z.literal('Coins'),
    amount: z.number().int().positive(),
    transactionId: z.string().regex(/^txn-[0-9a-f]{32}$/),
  })
  .strict();
export type CollectionGameReward = z.infer<typeof collectionGameRewardSchema>;

export const collectionGameStatDeltaSchema = z
  .object({
    side: z.enum(['home', 'away']),
    cardId: collectionCardIdSchema,
    points: z.number().int().nonnegative(),
    fieldGoalsMade: z.number().int().nonnegative(),
    fieldGoalsAttempted: z.number().int().nonnegative(),
    threePointMade: z.number().int().nonnegative(),
    threePointAttempted: z.number().int().nonnegative(),
    freeThrowMade: z.number().int().nonnegative(),
    freeThrowAttempted: z.number().int().nonnegative(),
    offensiveRebounds: z.number().int().nonnegative(),
    defensiveRebounds: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    steals: z.number().int().nonnegative(),
    blocks: z.number().int().nonnegative(),
    turnovers: z.number().int().nonnegative(),
    fouls: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionGameStatDelta = z.infer<typeof collectionGameStatDeltaSchema>;

const collectionGameEventBaseSchema = z.object({
  eventOrder: z.number().int().nonnegative(),
  period: z.number().int().min(1).max(30),
  secondsRemaining: z.number().int().min(0).max(720),
  homeScore: z.number().int().nonnegative(),
  awayScore: z.number().int().nonnegative(),
});

export const collectionGameEventSchema = z.discriminatedUnion('kind', [
  collectionGameEventBaseSchema.extend({
    kind: z.literal('possession'),
    possessionNumber: z.number().int().positive(),
    offenseSide: z.enum(['home', 'away']),
    pointsScored: z.number().int().min(0).max(4),
    participantCardIds: z.array(collectionCardIdSchema),
    statDeltas: z.array(collectionGameStatDeltaSchema),
  }),
  collectionGameEventBaseSchema.extend({
    kind: z.literal('substitution'),
    side: z.enum(['home', 'away']),
    playerInCardId: collectionCardIdSchema,
    playerOutCardId: collectionCardIdSchema,
    reason: seasonSubstitutionReasonSchema,
    unit: z.array(collectionCardIdSchema).length(5),
  }),
  collectionGameEventBaseSchema.extend({
    kind: z.literal('period-end'),
    periodHomeScore: z.number().int().nonnegative(),
    periodAwayScore: z.number().int().nonnegative(),
  }),
  collectionGameEventBaseSchema.extend({
    kind: z.literal('final'),
    winner: z.enum(['home', 'away']),
  }),
]);
export type CollectionGameEvent = z.infer<typeof collectionGameEventSchema>;

export const collectionGamePlayerResultSchema = seasonGamePlayerResultSchema
  .omit({ playerVersionId: true })
  .extend({ cardId: collectionCardIdSchema });
export type CollectionGamePlayerResult = z.infer<typeof collectionGamePlayerResultSchema>;

export const collectionFoulLimitExceptionSchema = z
  .object({
    side: z.enum(['home', 'away']),
    cardId: collectionCardIdSchema,
    period: z.number().int().min(1).max(30),
    secondsRemaining: z.number().int().min(0).max(720),
  })
  .strict();
export type CollectionFoulLimitException = z.infer<typeof collectionFoulLimitExceptionSchema>;

export const collectionGameSideResultSchema = z
  .object({
    teamId: z.string().min(1).max(64),
    displayName: z.string().min(1).max(96),
    score: z.number().int().nonnegative(),
    periodScores: z.array(z.number().int().nonnegative()),
    box: seasonGameSideResultSchema.shape.box,
    players: z.array(collectionGamePlayerResultSchema).min(5).max(12),
    shotZones: seasonGameSideResultSchema.shape.shotZones,
    foulLimitExceptions: z.array(collectionFoulLimitExceptionSchema),
  })
  .strict();
export type CollectionGameSideResult = z.infer<typeof collectionGameSideResultSchema>;

export const collectionGameSubstitutionSchema = z
  .object({
    side: z.enum(['home', 'away']),
    period: z.number().int().min(1).max(30),
    secondsRemaining: z.number().int().min(0).max(720),
    playerInCardId: collectionCardIdSchema,
    playerOutCardId: collectionCardIdSchema,
    reason: seasonSubstitutionReasonSchema,
    unit: z.array(collectionCardIdSchema).length(5),
  })
  .strict();
export type CollectionGameSubstitution = z.infer<typeof collectionGameSubstitutionSchema>;

export const collectionGameUnitStintSchema = z
  .object({
    side: z.enum(['home', 'away']),
    period: z.number().int().min(1).max(30),
    startSecondsRemaining: z.number().int().min(0).max(720),
    endSecondsRemaining: z.number().int().min(0).max(720),
    durationSeconds: z.number().int().min(0),
    players: z.array(collectionCardIdSchema).length(5),
  })
  .strict();
export type CollectionGameUnitStint = z.infer<typeof collectionGameUnitStintSchema>;

export const collectionGameDeviationReasonSchema = z.enum([
  ...seasonRotationDeviationReasonSchema.options,
  'foul-limit-exception',
]);
export type CollectionGameDeviationReason = z.infer<typeof collectionGameDeviationReasonSchema>;

export const collectionGameDeviationSchema = z
  .object({
    side: z.enum(['home', 'away']),
    cardId: collectionCardIdSchema,
    actualSeconds: z.number().int().min(0),
    targetSeconds: z.number().int().min(0).max(2880),
    reasons: z.array(collectionGameDeviationReasonSchema).min(1),
  })
  .strict();
export type CollectionGameDeviation = z.infer<typeof collectionGameDeviationSchema>;

export const collectionGameFoulOutSchema = z
  .object({
    side: z.enum(['home', 'away']),
    cardId: collectionCardIdSchema,
    period: z.number().int().min(1).max(30),
    secondsRemaining: z.number().int().min(0).max(720),
  })
  .strict();
export type CollectionGameFoulOut = z.infer<typeof collectionGameFoulOutSchema>;

const collectionGameResultBaseSchema = z.object({
  gameVersion: z.literal(COLLECTION_GAME_VERSION),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
});

export const collectionGameForfeitTriggerSchema = z.enum([
  'no-legal-five-tipoff',
  'no-legal-five-after-removal',
]);
export type CollectionGameForfeitTrigger = z.infer<typeof collectionGameForfeitTriggerSchema>;

export const collectionGameResultSchema = z.discriminatedUnion('outcome', [
  collectionGameResultBaseSchema.extend({
    outcome: z.literal('completed'),
    overtimePeriods: z.number().int().min(0),
    home: collectionGameSideResultSchema,
    away: collectionGameSideResultSchema,
    substitutions: z.array(collectionGameSubstitutionSchema),
    unitStints: z.array(collectionGameUnitStintSchema),
    deviations: z.array(collectionGameDeviationSchema),
    foulOuts: z.array(collectionGameFoulOutSchema),
  }),
  collectionGameResultBaseSchema.extend({
    outcome: z.literal('forfeit'),
    losingTeamId: z.string().min(1).max(64),
    trigger: collectionGameForfeitTriggerSchema,
    homeScore: z.union([z.literal(0), z.literal(2)]),
    awayScore: z.union([z.literal(0), z.literal(2)]),
  }),
]);
export type CollectionGameResult = z.infer<typeof collectionGameResultSchema>;

export const collectionPreparedGameSchema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_REPLAY_VERSION),
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    rootSeed: seedSchema,
    seedPaths: z
      .object({
        game: z.array(z.string().min(1).max(128)).min(1),
        cpuTeam: z.array(z.string().min(1).max(128)).min(1),
      })
      .strict(),
    seed: seedSchema,
    playerTeam: collectionActiveTeamSchema,
    cpuTeam: collectionActiveTeamSchema,
    environmentEraId: z.literal(COLLECTION_GAME_ENVIRONMENT_ERA_ID),
    profileVersion: z.string().min(1).max(64),
    profileHash: contentHashSchema,
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    catalogHash: contentHashSchema,
    rulesHash: contentHashSchema,
    homeCourtPolicy: z.literal(COLLECTION_GAME_HOME_COURT_POLICY),
    inputDigest: seasonCheckpointDigestSchema,
  })
  .strict();
export type CollectionPreparedGame = z.infer<typeof collectionPreparedGameSchema>;

export const collectionGameRecordSchema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    prepared: collectionPreparedGameSchema,
    result: collectionGameResultSchema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    reward: collectionGameRewardSchema,
    completedAtIso: z.string().min(1).max(64),
  })
  .strict();
export type CollectionGameRecord = z.infer<typeof collectionGameRecordSchema>;

export const collectionPlayStateSchema = z
  .object({
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    collectionId: idSchema,
    activeTeam: collectionActiveTeamSchema,
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    nextGameSequence: z.number().int().nonnegative(),
    pendingGame: collectionPreparedGameSchema.nullable(),
  })
  .strict();
export type CollectionPlayState = z.infer<typeof collectionPlayStateSchema>;

export const collectionGameCommandBaseSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_COMMAND_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});
export type CollectionGameCommandBase = z.infer<typeof collectionGameCommandBaseSchema>;

export const collectionSetActiveTeamCommandSchema = collectionGameCommandBaseSchema.extend({
  command: z.literal('set-active-team'),
  team: collectionActiveTeamSchema,
});
export type CollectionSetActiveTeamCommand = z.infer<typeof collectionSetActiveTeamCommandSchema>;

export const collectionPrepareBasicGameCommandSchema = collectionGameCommandBaseSchema.extend({
  command: z.literal('prepare-basic-game'),
});
export type CollectionPrepareBasicGameCommand = z.infer<
  typeof collectionPrepareBasicGameCommandSchema
>;

export const collectionAbandonBasicGameCommandSchema = collectionGameCommandBaseSchema.extend({
  command: z.literal('abandon-basic-game'),
  gameId: collectionGameIdSchema,
});
export type CollectionAbandonBasicGameCommand = z.infer<
  typeof collectionAbandonBasicGameCommandSchema
>;

export const collectionAcceptBasicGameResultCommandSchema = collectionGameCommandBaseSchema.extend({
  command: z.literal('accept-basic-game-result'),
  gameId: collectionGameIdSchema,
  result: collectionGameResultSchema,
  events: z.array(collectionGameEventSchema).min(1),
  completedAtIso: z.string().min(1).max(64),
});
export type CollectionAcceptBasicGameResultCommand = z.infer<
  typeof collectionAcceptBasicGameResultCommandSchema
>;

export const collectionGameCommandSchema = z.discriminatedUnion('command', [
  collectionSetActiveTeamCommandSchema,
  collectionPrepareBasicGameCommandSchema,
  collectionAbandonBasicGameCommandSchema,
  collectionAcceptBasicGameResultCommandSchema,
]);
export type CollectionGameCommand = z.infer<typeof collectionGameCommandSchema>;

export const collectionGameRejectionSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('collection-mismatch'), expectedCollectionId: z.string() }).strict(),
  z.object({ code: z.literal('duplicate-command'), commandId: z.string() }).strict(),
  z
    .object({
      code: z.literal('stale-state'),
      expectedRevision: z.number().int().nonnegative(),
      expectedDigest: seasonCheckpointDigestSchema,
      currentRevision: z.number().int().nonnegative(),
      currentDigest: seasonCheckpointDigestSchema,
    })
    .strict(),
  z.object({ code: z.literal('conflicting-command-reuse'), commandId: z.string() }).strict(),
  z.object({ code: z.literal('unowned-card'), cardId: z.string() }).strict(),
  z.object({ code: z.literal('unknown-card'), cardId: z.string() }).strict(),
  z.object({ code: z.literal('duplicate-card'), cardId: z.string() }).strict(),
  z
    .object({ code: z.literal('duplicate-player'), cardId: z.string(), playerId: z.string() })
    .strict(),
  z.object({ code: z.literal('illegal-starters'), detail: z.string() }).strict(),
  z.object({ code: z.literal('invalid-minutes'), detail: z.string() }).strict(),
  z.object({ code: z.literal('too-few-cards'), count: z.number().int().nonnegative() }).strict(),
  z.object({ code: z.literal('too-many-cards'), count: z.number().int().nonnegative() }).strict(),
  z.object({ code: z.literal('pending-game-conflict'), gameId: z.string() }).strict(),
  z.object({ code: z.literal('no-pending-game') }).strict(),
  z.object({ code: z.literal('pending-game-mismatch'), gameId: z.string() }).strict(),
  z.object({ code: z.literal('missing-content'), detail: z.string() }).strict(),
  z.object({ code: z.literal('incompatible-content'), detail: z.string() }).strict(),
  z.object({ code: z.literal('invalid-result'), detail: z.string() }).strict(),
  z.object({ code: z.literal('no-legal-five'), detail: z.string() }).strict(),
  z.object({ code: z.literal('arithmetic-overflow'), detail: z.string() }).strict(),
]);
export type CollectionGameRejection = z.infer<typeof collectionGameRejectionSchema>;

export const collectionCpuRarityWeightsSchema = z.record(
  collectionRaritySchema,
  z.number().positive(),
);
export type CollectionCpuRarityWeights = z.infer<typeof collectionCpuRarityWeightsSchema>;

export const collectionGameRulesSchema = z
  .object({
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_REPLAY_VERSION),
    cpuRosterSize: z.literal(COLLECTION_GAME_CPU_ROSTER_SIZE),
    eligibleScope: z.literal('full-catalog'),
    cpuRarityWeights: collectionCpuRarityWeightsSchema,
    environmentEraId: z.literal(COLLECTION_GAME_ENVIRONMENT_ERA_ID),
    homeCourtPolicy: z.literal(COLLECTION_GAME_HOME_COURT_POLICY),
    winRewardCoins: z.literal(COLLECTION_GAME_REWARD_WIN_COINS),
    lossRewardCoins: z.literal(COLLECTION_GAME_REWARD_LOSS_COINS),
    engineVersion: z.string().min(1).max(64),
    profileVersion: z.string().min(1).max(64),
  })
  .strict();
export type CollectionGameRules = z.infer<typeof collectionGameRulesSchema>;

export function collectionCpuRarityWeightOf(
  weights: CollectionCpuRarityWeights,
  rarity: CollectionRarity,
): number {
  const weight = weights[rarity];
  if (!(weight > 0)) {
    throw new Error(`collection game rules: missing positive weight for ${rarity}`);
  }
  return weight;
}
