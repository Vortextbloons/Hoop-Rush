import { z } from 'zod';
import {
  collectionCardIdSchema,
  collectionRaritySchema,
  type CollectionRarity,
} from './collection.ts';
import {
  collectionActiveTeamSchema,
  collectionActiveTeamMinutesSchema,
} from './collection-team.ts';
import { collectionDifficultyProfileSchema } from './collection-difficulty.ts';
import {
  collectionObjectiveEvaluationSchema,
  collectionObjectiveFeasibilityFactsSchema,
  collectionObjectiveIdSchema,
  collectionObjectiveOfferSchema,
} from './collection-objective.ts';
import {
  collectionGameRewardReceiptV2Schema,
  collectionGameRewardReceiptV3Schema,
} from './collection-reward.ts';
import {
  COLLECTION_CATALOG_VERSION,
  COLLECTION_COMMAND_V1_VERSION,
  COLLECTION_GAME_COMMAND_V1_VERSION,
  COLLECTION_GAME_COMMAND_VERSION,
  COLLECTION_GAME_CPU_ROSTER_SIZE,
  COLLECTION_GAME_ENVIRONMENT_ERA_ID,
  COLLECTION_GAME_FIRST_CLEAR_COINS,
  COLLECTION_GAME_HOME_COURT_POLICY,
  COLLECTION_GAME_V2_REPLAY_VERSION,
  COLLECTION_GAME_REPLAY_VERSION,
  COLLECTION_GAME_REWARD_LOSS_COINS,
  COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS,
  COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT,
  COLLECTION_GAME_REWARD_OBJECTIVE_COINS,
  COLLECTION_GAME_REWARD_WIN_COINS,
  COLLECTION_GAME_RULES_VERSION,
  COLLECTION_GAME_V1_REPLAY_VERSION,
  COLLECTION_GAME_V1_RULES_VERSION,
  COLLECTION_GAME_V1_VERSION,
  COLLECTION_GAME_V2_VERSION,
  COLLECTION_GAME_VERSION,
  COLLECTION_DIFFICULTY_VERSION,
  COLLECTION_OBJECTIVE_VERSION,
  COLLECTION_PLAY_SAVE_V2_VERSION,
  COLLECTION_PLAY_SAVE_VERSION,
  COLLECTION_REWARD_V1_VERSION,
  COLLECTION_REWARD_V2_VERSION,
  COLLECTION_REWARD_VERSION,
  COLLECTION_SCHEMA_VERSION,
  COLLECTION_TEAM_VERSION,
} from './collection-versions.ts';
import {
  collectionChallengeEvaluationSchema,
  collectionChallengeIdSchema,
  collectionChallengePreparedSnapshotSchema,
  collectionChallengeValidationFactsSchema,
} from './collection-challenge.ts';
import { commandIdSchema, contentHashSchema, idSchema, seedSchema } from './ids.ts';
import { REQUIRED_RATING_KEYS } from './simulation.ts';
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
    rewardVersion: z.literal(COLLECTION_REWARD_V1_VERSION),
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
    pointsScored: z.number().int().min(0).max(10),
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

export const collectionGameForfeitTriggerSchema = z.enum([
  'no-legal-five-tipoff',
  'no-legal-five-after-removal',
]);
export type CollectionGameForfeitTrigger = z.infer<typeof collectionGameForfeitTriggerSchema>;

const collectionGameResultV1BaseSchema = z.object({
  gameVersion: z.literal(COLLECTION_GAME_V1_VERSION),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  rulesVersion: z.literal(COLLECTION_GAME_V1_RULES_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
});

const collectionGameResultV2BaseSchema = z.object({
  gameVersion: z.literal(COLLECTION_GAME_V2_VERSION),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
});

const collectionGameResultV3BaseSchema = z.object({
  gameVersion: z.literal(COLLECTION_GAME_VERSION),
  gameId: collectionGameIdSchema,
  gameSequence: z.number().int().nonnegative(),
  catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
  rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
  engineVersion: z.string().min(1).max(64),
  profileVersion: z.string().min(1).max(64),
  winner: z.enum(['home', 'away']),
});

function resultVariants<T extends z.ZodRawShape>(base: z.ZodObject<T>) {
  return [
    base.extend({
      outcome: z.literal('completed'),
      overtimePeriods: z.number().int().min(0),
      home: collectionGameSideResultSchema,
      away: collectionGameSideResultSchema,
      substitutions: z.array(collectionGameSubstitutionSchema),
      unitStints: z.array(collectionGameUnitStintSchema),
      deviations: z.array(collectionGameDeviationSchema),
      foulOuts: z.array(collectionGameFoulOutSchema),
    }),
    base.extend({
      outcome: z.literal('forfeit'),
      losingTeamId: z.string().min(1).max(64),
      trigger: collectionGameForfeitTriggerSchema,
      homeScore: z.union([z.literal(0), z.literal(2)]),
      awayScore: z.union([z.literal(0), z.literal(2)]),
    }),
  ] as const;
}

export const collectionGameResultV1Schema = z.discriminatedUnion(
  'outcome',
  resultVariants(collectionGameResultV1BaseSchema),
);
export type CollectionGameResultV1 = z.infer<typeof collectionGameResultV1Schema>;

export const collectionGameResultV2Schema = z.discriminatedUnion(
  'outcome',
  resultVariants(collectionGameResultV2BaseSchema),
);
export type CollectionGameResultV2 = z.infer<typeof collectionGameResultV2Schema>;

export const collectionGameResultV3Schema = z.discriminatedUnion(
  'outcome',
  resultVariants(collectionGameResultV3BaseSchema),
);
export type CollectionGameResultV3 = z.infer<typeof collectionGameResultV3Schema>;

export const collectionGameResultUnionSchema = z.union([
  collectionGameResultV1Schema,
  collectionGameResultV2Schema,
  collectionGameResultV3Schema,
]);
export type CollectionGameResultUnion = z.infer<typeof collectionGameResultUnionSchema>;

export const collectionGameResultV1V2UnionSchema = z.union([
  collectionGameResultV1Schema,
  collectionGameResultV2Schema,
]);
export type CollectionGameResultV1V2Union = z.infer<typeof collectionGameResultV1V2UnionSchema>;

export const collectionGameResultSchema = collectionGameResultV2Schema;
export type CollectionGameResult = CollectionGameResultV2;

export const collectionGameSeedPathsV1Schema = z
  .object({
    game: z.array(z.string().min(1).max(128)).min(1),
    cpuTeam: z.array(z.string().min(1).max(128)).min(1),
  })
  .strict();

export const collectionGameSeedPathsV2Schema = z
  .object({
    game: z.array(z.string().min(1).max(128)).min(1),
    cpuTeam: z.array(z.string().min(1).max(128)).min(1),
    difficulty: z.array(z.string().min(1).max(128)).min(1),
    identity: z.array(z.string().min(1).max(128)).min(1),
    candidate: z.array(z.string().min(1).max(128)).min(1),
    objectives: z.array(z.string().min(1).max(128)).min(1),
  })
  .strict();
export type CollectionGameSeedPathsV2 = z.infer<typeof collectionGameSeedPathsV2Schema>;

export const collectionPreparedGameV1Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_V1_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_V1_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_V1_REPLAY_VERSION),
    rulesVersion: z.literal(COLLECTION_GAME_V1_RULES_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    rootSeed: seedSchema,
    seedPaths: collectionGameSeedPathsV1Schema,
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
export type CollectionPreparedGameV1 = z.infer<typeof collectionPreparedGameV1Schema>;

export const collectionRatingKeySchema = z.enum(REQUIRED_RATING_KEYS);
export type CollectionRatingKey = z.infer<typeof collectionRatingKeySchema>;

export const collectionRatingAdjustmentEntrySchema = z
  .object({
    rating: collectionRatingKeySchema,
    before: z.number().int().min(0).max(100),
    after: z.number().int().min(0).max(100),
  })
  .strict();
export type CollectionRatingAdjustmentEntry = z.infer<typeof collectionRatingAdjustmentEntrySchema>;

export const collectionRatingAdjustmentFactSchema = z
  .object({
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    mechanism: z.literal('difficulty-rating-shift'),
    side: z.literal('away'),
    cardId: collectionCardIdSchema,
    requestedDelta: z.number().int().min(-20).max(20),
    ratings: z.array(collectionRatingAdjustmentEntrySchema).length(REQUIRED_RATING_KEYS.length),
    boundedRatings: z.array(collectionRatingKeySchema),
  })
  .strict()
  .superRefine((fact, ctx) => {
    const seen = new Set<string>();
    for (const entry of fact.ratings) {
      if (seen.has(entry.rating)) {
        ctx.addIssue({ code: 'custom', message: `duplicate rating entry ${entry.rating}` });
      }
      seen.add(entry.rating);
    }
    for (const rating of REQUIRED_RATING_KEYS) {
      if (!seen.has(rating)) {
        ctx.addIssue({ code: 'custom', message: `missing rating entry ${rating}` });
      }
    }
    const bounded = new Set<CollectionRatingKey>();
    for (const entry of fact.ratings) {
      const raw = entry.before + fact.requestedDelta;
      const expected = Math.min(100, Math.max(0, raw));
      if (entry.after !== expected) {
        ctx.addIssue({
          code: 'custom',
          message: `rating ${entry.rating} after ${String(entry.after)} != clamped ${String(expected)}`,
        });
      }
      if (raw < 0 || raw > 100) bounded.add(entry.rating);
    }
    const declared = new Set(fact.boundedRatings);
    if (declared.size !== fact.boundedRatings.length) {
      ctx.addIssue({ code: 'custom', message: 'duplicate bounded rating' });
    }
    if (declared.size !== bounded.size || [...bounded].some((rating) => !declared.has(rating))) {
      ctx.addIssue({
        code: 'custom',
        message: 'boundedRatings does not match the clamped entries',
      });
    }
  });
export type CollectionRatingAdjustmentFact = z.infer<typeof collectionRatingAdjustmentFactSchema>;

export const collectionRatingAdjustmentsSchema = z
  .object({
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    mechanism: z.literal('difficulty-rating-shift'),
    requestedDelta: z.number().int().min(-20).max(20),
    facts: z.array(collectionRatingAdjustmentFactSchema),
  })
  .strict()
  .superRefine((adjustments, ctx) => {
    const seen = new Set<string>();
    for (const fact of adjustments.facts) {
      if (seen.has(fact.cardId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate adjustment for ${fact.cardId}` });
      }
      seen.add(fact.cardId);
      if (fact.requestedDelta !== adjustments.requestedDelta) {
        ctx.addIssue({ code: 'custom', message: 'fact delta disagrees with the wrapper delta' });
      }
    }
    if (adjustments.requestedDelta === 0 && adjustments.facts.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'a zero shift must not emit per-card facts' });
    }
    if (adjustments.requestedDelta !== 0 && adjustments.facts.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'a nonzero shift must emit per-card facts' });
    }
  });
export type CollectionRatingAdjustments = z.infer<typeof collectionRatingAdjustmentsSchema>;

export const collectionCpuScorePartsSchema = z
  .object({
    meanOverallMillionths: z.number().int().nonnegative(),
    fiveCoreMillionths: z.number().int().nonnegative(),
    identityFitMillionths: z.number().int().nonnegative(),
    lineupScoreMillionths: z.number().int().nonnegative(),
    topEightOverallMillionths: z.number().int().nonnegative(),
    rosterScoreMillionths: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionCpuScoreParts = z.infer<typeof collectionCpuScorePartsSchema>;

export const collectionCpuCandidateSchema = z
  .object({
    candidateIndex: z.number().int().nonnegative(),
    score: collectionCpuScorePartsSchema,
  })
  .strict();
export type CollectionCpuCandidate = z.infer<typeof collectionCpuCandidateSchema>;

export const collectionRarityCountsSchema = z
  .object({
    Ember: z.number().int().nonnegative(),
    Eruption: z.number().int().nonnegative(),
    Apex: z.number().int().nonnegative(),
    Titan: z.number().int().nonnegative(),
    Eclipse: z.number().int().nonnegative(),
    Immortal: z.number().int().nonnegative(),
  })
  .strict();
export type CollectionRarityCounts = z.infer<typeof collectionRarityCountsSchema>;

export const collectionCpuConstructionFactsSchema = z
  .object({
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    identity: z.enum(['balanced', 'shooting', 'pressure-defense', 'interior']),
    candidateCount: z.number().int().min(1).max(16),
    chosenCandidateIndex: z.number().int().nonnegative(),
    candidates: z.array(collectionCpuCandidateSchema).min(1).max(16),
    rarityCounts: collectionRarityCountsSchema,
    specialCount: z.number().int().nonnegative(),
    starters: z.array(collectionCardIdSchema).length(5),
    bench: z.array(collectionCardIdSchema).max(COLLECTION_GAME_CPU_ROSTER_SIZE - 5),
    targetMinutes: z
      .array(collectionActiveTeamMinutesSchema)
      .min(COLLECTION_GAME_CPU_ROSTER_SIZE)
      .max(COLLECTION_GAME_CPU_ROSTER_SIZE),
    closingFive: z.array(collectionCardIdSchema).length(5),
  })
  .strict()
  .superRefine((facts, ctx) => {
    if (facts.candidates.length !== facts.candidateCount) {
      ctx.addIssue({ code: 'custom', message: 'candidateCount does not match the candidate list' });
    }
    for (let index = 0; index < facts.candidates.length; index += 1) {
      if (facts.candidates[index]?.candidateIndex !== index) {
        ctx.addIssue({ code: 'custom', message: 'candidate indices must be canonical 0..n-1' });
        break;
      }
    }
    if (facts.chosenCandidateIndex >= facts.candidateCount) {
      ctx.addIssue({ code: 'custom', message: 'chosen candidate index is out of range' });
    }
    const roster = [...facts.starters, ...facts.bench];
    if (roster.length !== COLLECTION_GAME_CPU_ROSTER_SIZE) {
      ctx.addIssue({
        code: 'custom',
        message: `construction roster ${String(roster.length)} != ${String(COLLECTION_GAME_CPU_ROSTER_SIZE)}`,
      });
    }
    if (new Set(roster).size !== roster.length) {
      ctx.addIssue({ code: 'custom', message: 'construction roster has duplicates' });
    }
    const minuteIds = new Map(facts.targetMinutes.map((entry) => [entry.cardId, entry.minutes]));
    if (minuteIds.size !== facts.targetMinutes.length) {
      ctx.addIssue({ code: 'custom', message: 'construction minutes have duplicates' });
    }
    let total = 0;
    for (const cardId of roster) {
      const minutes = minuteIds.get(cardId);
      if (minutes === undefined) {
        ctx.addIssue({ code: 'custom', message: `construction minutes miss ${cardId}` });
        continue;
      }
      total += minutes;
      if (facts.starters.includes(cardId) && minutes < 1) {
        ctx.addIssue({ code: 'custom', message: `starter ${cardId} needs at least one minute` });
      }
    }
    if (total !== 240) {
      ctx.addIssue({
        code: 'custom',
        message: `construction minutes total ${String(total)} != 240`,
      });
    }
    for (const cardId of minuteIds.keys()) {
      if (!roster.includes(cardId)) {
        ctx.addIssue({
          code: 'custom',
          message: `construction minutes include unrostered ${cardId}`,
        });
      }
    }
    if (new Set(facts.closingFive).size !== 5) {
      ctx.addIssue({ code: 'custom', message: 'closing five must be five distinct cards' });
    }
    for (const cardId of facts.closingFive) {
      if (!roster.includes(cardId)) {
        ctx.addIssue({ code: 'custom', message: `closing five includes unrostered ${cardId}` });
      }
    }
    let rarityTotal = 0;
    for (const rarity of Object.keys(facts.rarityCounts) as CollectionRarity[]) {
      rarityTotal += facts.rarityCounts[rarity];
    }
    if (rarityTotal !== roster.length) {
      ctx.addIssue({ code: 'custom', message: 'rarity counts do not match the roster size' });
    }
  });
export type CollectionCpuConstructionFacts = z.infer<typeof collectionCpuConstructionFactsSchema>;

export const collectionObjectiveFactsSchema = z
  .object({
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    seedPath: z.array(z.string().min(1).max(128)).min(1),
    offers: z.array(collectionObjectiveOfferSchema).length(3),
    selectedObjectiveId: collectionObjectiveIdSchema.nullable(),
    feasibility: collectionObjectiveFeasibilityFactsSchema,
  })
  .strict()
  .superRefine((facts, ctx) => {
    const seen = new Set<string>();
    for (const offer of facts.offers) {
      if (seen.has(offer.objectiveId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate objective offer ${offer.objectiveId}` });
      }
      seen.add(offer.objectiveId);
    }
    if (facts.selectedObjectiveId !== null && !seen.has(facts.selectedObjectiveId)) {
      ctx.addIssue({ code: 'custom', message: 'selected objective is not among the offers' });
    }
  });
export type CollectionObjectiveFacts = z.infer<typeof collectionObjectiveFactsSchema>;

export const collectionPreparedGameV2Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_V2_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_V2_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_V2_REPLAY_VERSION),
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    rootSeed: seedSchema,
    seedPaths: collectionGameSeedPathsV2Schema,
    seed: seedSchema,
    playerTeam: collectionActiveTeamSchema,
    cpuTeam: collectionActiveTeamSchema,
    difficulty: collectionDifficultyProfileSchema,
    construction: collectionCpuConstructionFactsSchema,
    adjustments: collectionRatingAdjustmentsSchema,
    objectives: collectionObjectiveFactsSchema,
    firstClearEligible: z.boolean(),
    environmentEraId: z.literal(COLLECTION_GAME_ENVIRONMENT_ERA_ID),
    profileVersion: z.string().min(1).max(64),
    profileHash: contentHashSchema,
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    catalogHash: contentHashSchema,
    rulesHash: contentHashSchema,
    homeCourtPolicy: z.literal(COLLECTION_GAME_HOME_COURT_POLICY),
    inputDigest: seasonCheckpointDigestSchema,
  })
  .strict()
  .superRefine((prepared, ctx) => {
    if (prepared.adjustments.requestedDelta !== prepared.difficulty.ratingShift) {
      ctx.addIssue({
        code: 'custom',
        message: 'adjustment delta disagrees with the profile shift',
      });
    }
    if (
      prepared.objectives.selectedObjectiveId !== null &&
      !prepared.objectives.offers.some(
        (offer) => offer.objectiveId === prepared.objectives.selectedObjectiveId,
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'selected objective is not offered' });
    }
    const cpuTeamIds = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
    const constructionIds = [...prepared.construction.starters, ...prepared.construction.bench];
    if (
      cpuTeamIds.length !== constructionIds.length ||
      cpuTeamIds.some((cardId, index) => cardId !== constructionIds[index])
    ) {
      ctx.addIssue({ code: 'custom', message: 'cpu team and construction rosters disagree' });
    }
    const cpuMinutes = prepared.cpuTeam.targetMinutes;
    const constructionMinutes = prepared.construction.targetMinutes;
    if (JSON.stringify(cpuMinutes) !== JSON.stringify(constructionMinutes)) {
      ctx.addIssue({ code: 'custom', message: 'cpu team and construction minutes disagree' });
    }
  });
export type CollectionPreparedGameV2 = z.infer<typeof collectionPreparedGameV2Schema>;

export const collectionPreparedGameV3Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_REPLAY_VERSION),
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    rootSeed: seedSchema,
    seedPaths: collectionGameSeedPathsV2Schema,
    seed: seedSchema,
    playerTeam: collectionActiveTeamSchema,
    cpuTeam: collectionActiveTeamSchema,
    difficulty: collectionDifficultyProfileSchema,
    construction: collectionCpuConstructionFactsSchema,
    adjustments: collectionRatingAdjustmentsSchema,
    objectives: collectionObjectiveFactsSchema,
    firstClearEligible: z.boolean(),
    challenge: collectionChallengePreparedSnapshotSchema,
    environmentEraId: z.literal(COLLECTION_GAME_ENVIRONMENT_ERA_ID),
    profileVersion: z.string().min(1).max(64),
    profileHash: contentHashSchema,
    catalogVersion: z.literal(COLLECTION_CATALOG_VERSION),
    catalogHash: contentHashSchema,
    rulesHash: contentHashSchema,
    homeCourtPolicy: z.literal(COLLECTION_GAME_HOME_COURT_POLICY),
    inputDigest: seasonCheckpointDigestSchema,
  })
  .strict()
  .superRefine((prepared, ctx) => {
    if (prepared.adjustments.requestedDelta !== prepared.difficulty.ratingShift) {
      ctx.addIssue({
        code: 'custom',
        message: 'adjustment delta disagrees with the profile shift',
      });
    }
    if (
      prepared.objectives.selectedObjectiveId !== null &&
      !prepared.objectives.offers.some(
        (offer) => offer.objectiveId === prepared.objectives.selectedObjectiveId,
      )
    ) {
      ctx.addIssue({ code: 'custom', message: 'selected objective is not offered' });
    }
    const cpuTeamIds = [...prepared.cpuTeam.starters, ...prepared.cpuTeam.bench];
    const constructionIds = [...prepared.construction.starters, ...prepared.construction.bench];
    if (
      cpuTeamIds.length !== constructionIds.length ||
      cpuTeamIds.some((cardId, index) => cardId !== constructionIds[index])
    ) {
      ctx.addIssue({ code: 'custom', message: 'cpu team and construction rosters disagree' });
    }
    const cpuMinutes = prepared.cpuTeam.targetMinutes;
    const constructionMinutes = prepared.construction.targetMinutes;
    if (JSON.stringify(cpuMinutes) !== JSON.stringify(constructionMinutes)) {
      ctx.addIssue({ code: 'custom', message: 'cpu team and construction minutes disagree' });
    }
    if (prepared.difficulty.difficultyId !== prepared.challenge.difficultyId) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge difficulty is fixed and must match the prepared difficulty',
      });
    }
    const rosterIds = prepared.challenge.validation.activeRoster.map((entry) => entry.cardId);
    const teamIds = [...prepared.playerTeam.starters, ...prepared.playerTeam.bench];
    if (
      rosterIds.length !== teamIds.length ||
      rosterIds.some((cardId, index) => cardId !== teamIds[index])
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge validation roster disagrees with the committed team',
      });
    }
  });
export type CollectionPreparedGameV3 = z.infer<typeof collectionPreparedGameV3Schema>;

export const collectionPreparedGameSchema = collectionPreparedGameV2Schema;
export type CollectionPreparedGame = CollectionPreparedGameV2;
export type CollectionCurrentPreparedGame = CollectionPreparedGameV2 | CollectionPreparedGameV3;

export const collectionPreparedGameUnionSchema = z.union([
  collectionPreparedGameV1Schema,
  collectionPreparedGameV2Schema,
  collectionPreparedGameV3Schema,
]);
export type CollectionPreparedGameUnion = z.infer<typeof collectionPreparedGameUnionSchema>;

export const collectionPreparedGameV1V2UnionSchema = z.union([
  collectionPreparedGameV1Schema,
  collectionPreparedGameV2Schema,
]);
export type CollectionPreparedGameV1V2Union = z.infer<typeof collectionPreparedGameV1V2UnionSchema>;

export const collectionGameRecordV1Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_V1_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    prepared: collectionPreparedGameV1Schema,
    result: collectionGameResultV1Schema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    reward: collectionGameRewardSchema,
    completedAtIso: z.string().min(1).max(64),
  })
  .strict();
export type CollectionGameRecordV1 = z.infer<typeof collectionGameRecordV1Schema>;

export const collectionGameRecordV2Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_V2_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    prepared: collectionPreparedGameV2Schema,
    result: collectionGameResultV2Schema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    objectiveEvaluation: collectionObjectiveEvaluationSchema,
    reward: collectionGameRewardReceiptV2Schema,
    completedAtIso: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((record, ctx) => {
    const prepared = record.prepared;
    if (prepared.gameId !== record.gameId || prepared.gameSequence !== record.gameSequence) {
      ctx.addIssue({
        code: 'custom',
        message: 'record identity does not match the prepared input',
      });
    }
    if (record.result.gameId !== record.gameId) {
      ctx.addIssue({ code: 'custom', message: 'result identity does not match the record' });
    }
    if (record.reward.difficultyId !== prepared.difficulty.difficultyId) {
      ctx.addIssue({
        code: 'custom',
        message: 'reward difficulty does not match the prepared input',
      });
    }
    if (record.reward.firstClearEligible !== prepared.firstClearEligible) {
      ctx.addIssue({ code: 'custom', message: 'reward first-clear eligibility mismatch' });
    }
    if (record.reward.playerWin !== (record.result.winner === 'home')) {
      ctx.addIssue({ code: 'custom', message: 'reward winner does not match the result' });
    }
    if (record.reward.gameOutcome !== record.result.outcome) {
      ctx.addIssue({ code: 'custom', message: 'reward outcome does not match the result' });
    }
    if (record.result.outcome === 'completed') {
      const margin = Math.abs(record.result.home.score - record.result.away.score);
      if (record.reward.scoreMargin !== margin) {
        ctx.addIssue({ code: 'custom', message: 'reward score margin does not match the result' });
      }
    } else if (record.reward.scoreMargin !== null) {
      ctx.addIssue({ code: 'custom', message: 'forfeit rewards must not record a score margin' });
    }
    const evaluation = record.objectiveEvaluation;
    if (evaluation.kind === 'not-selected') {
      if (prepared.objectives.selectedObjectiveId !== null) {
        ctx.addIssue({ code: 'custom', message: 'evaluation skips the selected objective' });
      }
      if (record.reward.objectiveId !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'reward references an objective that was not selected',
        });
      }
    } else if (evaluation.objectiveId !== prepared.objectives.selectedObjectiveId) {
      ctx.addIssue({
        code: 'custom',
        message: 'evaluation objective does not match the selection',
      });
    }
    if (evaluation.kind === 'forfeit' && record.result.outcome !== 'forfeit') {
      ctx.addIssue({ code: 'custom', message: 'forfeit evaluation requires a forfeit result' });
    }
    if (evaluation.kind === 'evaluated' && record.result.outcome !== 'completed') {
      ctx.addIssue({ code: 'custom', message: 'completed evaluation requires a completed result' });
    }
  });
export type CollectionGameRecordV2 = z.infer<typeof collectionGameRecordV2Schema>;

export const collectionGameRecordV3Schema = z
  .object({
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    collectionId: idSchema,
    gameId: collectionGameIdSchema,
    gameSequence: z.number().int().nonnegative(),
    prepared: collectionPreparedGameV3Schema,
    result: collectionGameResultV3Schema,
    events: z.array(collectionGameEventSchema).min(1),
    eventDigest: seasonCheckpointDigestSchema,
    resultDigest: seasonCheckpointDigestSchema,
    objectiveEvaluation: collectionObjectiveEvaluationSchema,
    challengeEvaluation: collectionChallengeEvaluationSchema,
    reward: collectionGameRewardReceiptV3Schema,
    completedAtIso: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((record, ctx) => {
    const prepared = record.prepared;
    if (prepared.gameId !== record.gameId || prepared.gameSequence !== record.gameSequence) {
      ctx.addIssue({
        code: 'custom',
        message: 'record identity does not match the prepared input',
      });
    }
    if (record.result.gameId !== record.gameId) {
      ctx.addIssue({ code: 'custom', message: 'result identity does not match the record' });
    }
    if (record.reward.difficultyId !== prepared.difficulty.difficultyId) {
      ctx.addIssue({
        code: 'custom',
        message: 'reward difficulty does not match the prepared input',
      });
    }
    if (record.reward.firstClearEligible !== prepared.firstClearEligible) {
      ctx.addIssue({ code: 'custom', message: 'reward first-clear eligibility mismatch' });
    }
    if (record.reward.playerWin !== (record.result.winner === 'home')) {
      ctx.addIssue({ code: 'custom', message: 'reward winner does not match the result' });
    }
    if (record.reward.gameOutcome !== record.result.outcome) {
      ctx.addIssue({ code: 'custom', message: 'reward outcome does not match the result' });
    }
    if (record.result.outcome === 'completed') {
      const margin = Math.abs(record.result.home.score - record.result.away.score);
      if (record.reward.scoreMargin !== margin) {
        ctx.addIssue({ code: 'custom', message: 'reward score margin does not match the result' });
      }
    } else if (record.reward.scoreMargin !== null) {
      ctx.addIssue({ code: 'custom', message: 'forfeit rewards must not record a score margin' });
    }
    const evaluation = record.objectiveEvaluation;
    if (evaluation.kind === 'not-selected') {
      if (prepared.objectives.selectedObjectiveId !== null) {
        ctx.addIssue({ code: 'custom', message: 'evaluation skips the selected objective' });
      }
      if (record.reward.objectiveId !== null) {
        ctx.addIssue({
          code: 'custom',
          message: 'reward references an objective that was not selected',
        });
      }
    } else if (evaluation.objectiveId !== prepared.objectives.selectedObjectiveId) {
      ctx.addIssue({
        code: 'custom',
        message: 'evaluation objective does not match the selection',
      });
    }
    if (evaluation.kind === 'forfeit' && record.result.outcome !== 'forfeit') {
      ctx.addIssue({ code: 'custom', message: 'forfeit evaluation requires a forfeit result' });
    }
    if (evaluation.kind === 'evaluated' && record.result.outcome !== 'completed') {
      ctx.addIssue({ code: 'custom', message: 'completed evaluation requires a completed result' });
    }
    const challenge = record.challengeEvaluation;
    if (challenge.challengeId !== prepared.challenge.challengeId) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge evaluation references a different challenge',
      });
    }
    if (challenge.difficultyId !== prepared.challenge.difficultyId) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge evaluation difficulty does not match the prepared challenge',
      });
    }
    if (challenge.firstClearEligible !== prepared.challenge.firstClearEligible) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge evaluation first-clear eligibility mismatch',
      });
    }
    if (record.reward.challengeId !== prepared.challenge.challengeId) {
      ctx.addIssue({
        code: 'custom',
        message: 'reward challenge id does not match the prepared input',
      });
    }
    if (
      record.reward.challengeFirstClearEligible !== prepared.challenge.firstClearEligible ||
      record.reward.challengeFirstClearGranted !== challenge.firstClearGranted ||
      record.reward.challengeComponentKind !== challenge.componentKind
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge reward facts do not match the challenge evaluation',
      });
    }
    if (
      challenge.componentKind !== null &&
      (record.result.outcome !== 'completed' || record.result.winner !== 'home')
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'challenge rewards require a completed player win',
      });
    }
  });
export type CollectionGameRecordV3 = z.infer<typeof collectionGameRecordV3Schema>;

export const collectionGameRecordSchema = collectionGameRecordV2Schema;
export type CollectionGameRecord = CollectionGameRecordV2;

export const collectionGameRecordUnionSchema = z.union([
  collectionGameRecordV1Schema,
  collectionGameRecordV2Schema,
  collectionGameRecordV3Schema,
]);
export type CollectionGameRecordUnion = z.infer<typeof collectionGameRecordUnionSchema>;

export const collectionPlayStateV1Schema = z
  .object({
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_V1_VERSION),
    collectionId: idSchema,
    activeTeam: collectionActiveTeamSchema,
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    nextGameSequence: z.number().int().nonnegative(),
    pendingGame: collectionPreparedGameV1Schema.nullable(),
  })
  .strict();
export type CollectionPlayStateV1 = z.infer<typeof collectionPlayStateV1Schema>;

export const collectionPlayStateV2Schema = z
  .object({
    saveVersion: z.literal(COLLECTION_PLAY_SAVE_V2_VERSION),
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_V2_VERSION),
    collectionId: idSchema,
    activeTeam: collectionActiveTeamSchema,
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    nextGameSequence: z.number().int().nonnegative(),
    pendingGame: collectionPreparedGameUnionSchema.nullable(),
    clearedDifficultyIds: z.array(z.enum(['street', 'pro', 'legend'])).max(3),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (new Set(state.clearedDifficultyIds).size !== state.clearedDifficultyIds.length) {
      ctx.addIssue({ code: 'custom', message: 'cleared difficulty ids must be unique' });
    }
  });
export type CollectionPlayStateV2 = z.infer<typeof collectionPlayStateV2Schema>;

export const collectionPlayStateV3Schema = z
  .object({
    saveVersion: z.literal(COLLECTION_PLAY_SAVE_VERSION),
    schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_VERSION),
    collectionId: idSchema,
    activeTeam: collectionActiveTeamSchema,
    revision: z.number().int().nonnegative(),
    digest: seasonCheckpointDigestSchema,
    nextGameSequence: z.number().int().nonnegative(),
    pendingGame: collectionPreparedGameUnionSchema.nullable(),
    clearedDifficultyIds: z.array(z.enum(['street', 'pro', 'legend'])).max(3),
    clearedChallengeIds: z.array(collectionChallengeIdSchema),
  })
  .strict()
  .superRefine((state, ctx) => {
    if (new Set(state.clearedDifficultyIds).size !== state.clearedDifficultyIds.length) {
      ctx.addIssue({ code: 'custom', message: 'cleared difficulty ids must be unique' });
    }
    const seen = new Set<string>();
    let previous = '';
    for (const challengeId of state.clearedChallengeIds) {
      if (seen.has(challengeId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate cleared challenge ${challengeId}` });
      }
      if (seen.size > 0 && challengeId <= previous) {
        ctx.addIssue({ code: 'custom', message: 'cleared challenge ids must be canonical sorted' });
      }
      seen.add(challengeId);
      previous = challengeId;
    }
  });
export type CollectionPlayStateV3 = z.infer<typeof collectionPlayStateV3Schema>;

export const collectionPlayStateSchema = collectionPlayStateV3Schema;
export type CollectionPlayState = CollectionPlayStateV3;

export const collectionPlayStateUnionSchema = z.union([
  collectionPlayStateV1Schema,
  collectionPlayStateV2Schema,
  collectionPlayStateV3Schema,
]);
export type CollectionPlayStateUnion = z.infer<typeof collectionPlayStateUnionSchema>;

const collectionGameCommandV1BaseSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_COMMAND_V1_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});

const collectionGameCommandV2BaseSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_GAME_COMMAND_V1_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});

const collectionGameCommandV3BaseSchema = z.object({
  schemaVersion: z.literal(COLLECTION_SCHEMA_VERSION),
  commandVersion: z.literal(COLLECTION_GAME_COMMAND_VERSION),
  commandId: commandIdSchema,
  collectionId: idSchema,
  expectedRevision: z.number().int().nonnegative(),
  expectedDigest: seasonCheckpointDigestSchema,
});

export const collectionSetActiveTeamCommandV1Schema = collectionGameCommandV1BaseSchema.extend({
  command: z.literal('set-active-team'),
  team: collectionActiveTeamSchema,
});
export type CollectionSetActiveTeamCommandV1 = z.infer<
  typeof collectionSetActiveTeamCommandV1Schema
>;

export const collectionSetActiveTeamCommandSchema = collectionGameCommandV2BaseSchema.extend({
  command: z.literal('set-active-team'),
  team: collectionActiveTeamSchema,
});
export type CollectionSetActiveTeamCommand = z.infer<typeof collectionSetActiveTeamCommandSchema>;

export const collectionPrepareBasicGameCommandV1Schema = collectionGameCommandV1BaseSchema.extend({
  command: z.literal('prepare-basic-game'),
});
export type CollectionPrepareBasicGameCommandV1 = z.infer<
  typeof collectionPrepareBasicGameCommandV1Schema
>;

export const collectionPrepareBasicGameCommandSchema = collectionGameCommandV2BaseSchema.extend({
  command: z.literal('prepare-basic-game'),
  difficultyId: z.enum(['street', 'pro', 'legend']),
  objectiveId: collectionObjectiveIdSchema.nullable(),
});
export type CollectionPrepareBasicGameCommand = z.infer<
  typeof collectionPrepareBasicGameCommandSchema
>;

export const collectionAbandonBasicGameCommandV1Schema = collectionGameCommandV1BaseSchema.extend({
  command: z.literal('abandon-basic-game'),
  gameId: collectionGameIdSchema,
});
export type CollectionAbandonBasicGameCommandV1 = z.infer<
  typeof collectionAbandonBasicGameCommandV1Schema
>;

export const collectionAbandonBasicGameCommandSchema = collectionGameCommandV2BaseSchema.extend({
  command: z.literal('abandon-basic-game'),
  gameId: collectionGameIdSchema,
});
export type CollectionAbandonBasicGameCommand = z.infer<
  typeof collectionAbandonBasicGameCommandSchema
>;

export const collectionAcceptBasicGameResultCommandV1Schema =
  collectionGameCommandV1BaseSchema.extend({
    command: z.literal('accept-basic-game-result'),
    gameId: collectionGameIdSchema,
    result: collectionGameResultV1Schema,
    events: z.array(collectionGameEventSchema).min(1),
    completedAtIso: z.string().min(1).max(64),
  });
export type CollectionAcceptBasicGameResultCommandV1 = z.infer<
  typeof collectionAcceptBasicGameResultCommandV1Schema
>;

export const collectionAcceptBasicGameResultCommandSchema =
  collectionGameCommandV2BaseSchema.extend({
    command: z.literal('accept-basic-game-result'),
    gameId: collectionGameIdSchema,
    result: collectionGameResultUnionSchema,
    events: z.array(collectionGameEventSchema).min(1),
    completedAtIso: z.string().min(1).max(64),
  });
export type CollectionAcceptBasicGameResultCommand = z.infer<
  typeof collectionAcceptBasicGameResultCommandSchema
>;

export const collectionGameCommandV1Schema = z.discriminatedUnion('command', [
  collectionSetActiveTeamCommandV1Schema,
  collectionPrepareBasicGameCommandV1Schema,
  collectionAbandonBasicGameCommandV1Schema,
  collectionAcceptBasicGameResultCommandV1Schema,
]);
export type CollectionGameCommandV1 = z.infer<typeof collectionGameCommandV1Schema>;

export const collectionGameCommandV2Schema = z.discriminatedUnion('command', [
  collectionSetActiveTeamCommandSchema,
  collectionPrepareBasicGameCommandSchema,
  collectionAbandonBasicGameCommandSchema,
  collectionAcceptBasicGameResultCommandSchema,
]);
export type CollectionGameCommandV2 = z.infer<typeof collectionGameCommandV2Schema>;

export const collectionPrepareChallengeGameCommandSchema = collectionGameCommandV3BaseSchema.extend(
  {
    command: z.literal('prepare-challenge-game'),
    challengeId: collectionChallengeIdSchema,
    objectiveId: collectionObjectiveIdSchema.nullable(),
  },
);
export type CollectionPrepareChallengeGameCommand = z.infer<
  typeof collectionPrepareChallengeGameCommandSchema
>;

export const collectionAbandonChallengeGameCommandSchema = collectionGameCommandV3BaseSchema.extend(
  {
    command: z.literal('abandon-challenge-game'),
    gameId: collectionGameIdSchema,
  },
);
export type CollectionAbandonChallengeGameCommand = z.infer<
  typeof collectionAbandonChallengeGameCommandSchema
>;

export const collectionAcceptChallengeGameResultCommandSchema =
  collectionGameCommandV3BaseSchema.extend({
    command: z.literal('accept-challenge-game-result'),
    gameId: collectionGameIdSchema,
    result: collectionGameResultV3Schema,
    events: z.array(collectionGameEventSchema).min(1),
    completedAtIso: z.string().min(1).max(64),
  });
export type CollectionAcceptChallengeGameResultCommand = z.infer<
  typeof collectionAcceptChallengeGameResultCommandSchema
>;

export const collectionGameCommandV3Schema = z.discriminatedUnion('command', [
  collectionPrepareChallengeGameCommandSchema,
  collectionAbandonChallengeGameCommandSchema,
  collectionAcceptChallengeGameResultCommandSchema,
]);
export type CollectionGameCommandV3 = z.infer<typeof collectionGameCommandV3Schema>;

export const collectionGameCommandSchema = z.union([
  collectionGameCommandV1Schema,
  collectionGameCommandV2Schema,
  collectionGameCommandV3Schema,
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
  z.object({ code: z.literal('unknown-difficulty'), difficultyId: z.string() }).strict(),
  z.object({ code: z.literal('objective-not-offered'), objectiveId: z.string() }).strict(),
  z.object({ code: z.literal('infeasible-objective'), objectiveId: z.string() }).strict(),
  z.object({ code: z.literal('invalid-adjustment-facts'), detail: z.string() }).strict(),
  z.object({ code: z.literal('invalid-reward-facts'), detail: z.string() }).strict(),
  z.object({ code: z.literal('first-clear-divergence'), detail: z.string() }).strict(),
  z.object({ code: z.literal('unknown-challenge'), challengeId: z.string() }).strict(),
  z
    .object({
      code: z.literal('challenge-team-ineligible'),
      challengeId: z.string(),
      validation: collectionChallengeValidationFactsSchema,
    })
    .strict(),
  z.object({ code: z.literal('challenge-difficulty-divergence'), detail: z.string() }).strict(),
  z.object({ code: z.literal('challenge-version-mismatch'), detail: z.string() }).strict(),
  z.object({ code: z.literal('challenge-first-clear-divergence'), detail: z.string() }).strict(),
  z.object({ code: z.literal('challenge-reward-divergence'), detail: z.string() }).strict(),
]);
export type CollectionGameRejection = z.infer<typeof collectionGameRejectionSchema>;

export const collectionCpuRarityWeightsSchema = z.record(
  collectionRaritySchema,
  z.number().positive(),
);
export type CollectionCpuRarityWeights = z.infer<typeof collectionCpuRarityWeightsSchema>;

export const collectionGameRulesV1Schema = z
  .object({
    rulesVersion: z.literal(COLLECTION_GAME_V1_RULES_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_V1_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_V1_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_V1_REPLAY_VERSION),
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
export type CollectionGameRulesV1 = z.infer<typeof collectionGameRulesV1Schema>;

export const collectionRewardTableSchema = z
  .object({
    winCoins: z.literal(COLLECTION_GAME_REWARD_WIN_COINS),
    lossCoins: z.literal(COLLECTION_GAME_REWARD_LOSS_COINS),
    objectiveCoins: z.literal(COLLECTION_GAME_REWARD_OBJECTIVE_COINS),
    marginCoinPerPoint: z.literal(COLLECTION_GAME_REWARD_MARGIN_COIN_PER_POINT),
    marginCapPoints: z.literal(COLLECTION_GAME_REWARD_MARGIN_CAP_POINTS),
    firstClearCoins: z
      .object({
        street: z.literal(COLLECTION_GAME_FIRST_CLEAR_COINS.street),
        pro: z.literal(COLLECTION_GAME_FIRST_CLEAR_COINS.pro),
        legend: z.literal(COLLECTION_GAME_FIRST_CLEAR_COINS.legend),
      })
      .strict(),
  })
  .strict();
export type CollectionRewardTable = z.infer<typeof collectionRewardTableSchema>;

const OBJECTIVE_CONDITION_KIND: Record<string, string> = {
  'obj-three-barrage-v1': 'player-team-three-pointers-made',
  'obj-lock-score-v1': 'cpu-team-points-at-most',
  'obj-bench-spark-v1': 'player-bench-points-at-least',
  'obj-ball-pressure-v1': 'cpu-team-turnovers-at-least',
  'obj-own-glass-v1': 'player-rebound-margin-at-least',
  'obj-box-score-star-v1': 'player-double-stat',
};

export const collectionGameRulesV2Schema = z
  .object({
    rulesVersion: z.literal(COLLECTION_GAME_RULES_VERSION),
    gameVersion: z.literal(COLLECTION_GAME_V2_VERSION),
    teamVersion: z.literal(COLLECTION_TEAM_VERSION),
    rewardVersion: z.literal(COLLECTION_REWARD_V2_VERSION),
    replayVersion: z.literal(COLLECTION_GAME_V2_REPLAY_VERSION),
    difficultyVersion: z.literal(COLLECTION_DIFFICULTY_VERSION),
    objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
    cpuRosterSize: z.literal(COLLECTION_GAME_CPU_ROSTER_SIZE),
    eligibleScope: z.literal('full-catalog'),
    difficulties: z.array(collectionDifficultyProfileSchema).length(3),
    objectives: z.array(
      z
        .object({
          objectiveVersion: z.literal(COLLECTION_OBJECTIVE_VERSION),
          objectiveId: collectionObjectiveIdSchema,
          title: z.string().min(1).max(64),
          threshold: z.number().int(),
        })
        .strict(),
    ),
    rewardTable: collectionRewardTableSchema,
    environmentEraId: z.literal(COLLECTION_GAME_ENVIRONMENT_ERA_ID),
    homeCourtPolicy: z.literal(COLLECTION_GAME_HOME_COURT_POLICY),
    engineVersion: z.string().min(1).max(64),
    profileVersion: z.string().min(1).max(64),
  })
  .strict()
  .superRefine((rules, ctx) => {
    const order = ['street', 'pro', 'legend'];
    for (let index = 0; index < order.length; index += 1) {
      if (rules.difficulties[index]?.difficultyId !== order[index]) {
        ctx.addIssue({
          code: 'custom',
          message: 'difficulties must be ordered street, pro, legend',
        });
        break;
      }
    }
    const shift = rules.difficulties.map((profile) => profile.ratingShift);
    const multiplier = rules.difficulties.map((profile) => profile.rewardMultiplierBp);
    for (let index = 1; index < shift.length; index += 1) {
      if ((shift[index] ?? 0) <= (shift[index - 1] ?? 0)) {
        ctx.addIssue({ code: 'custom', message: 'rating shifts must increase with difficulty' });
        break;
      }
    }
    for (let index = 1; index < multiplier.length; index += 1) {
      if ((multiplier[index] ?? 0) <= (multiplier[index - 1] ?? 0)) {
        ctx.addIssue({
          code: 'custom',
          message: 'reward multipliers must increase with difficulty',
        });
        break;
      }
    }
    const objectiveIds = new Set<string>();
    for (const objective of rules.objectives) {
      if (objectiveIds.has(objective.objectiveId)) {
        ctx.addIssue({ code: 'custom', message: `duplicate objective ${objective.objectiveId}` });
      }
      objectiveIds.add(objective.objectiveId);
    }
    for (const objectiveId of Object.keys(OBJECTIVE_CONDITION_KIND)) {
      if (!objectiveIds.has(objectiveId)) {
        ctx.addIssue({ code: 'custom', message: `missing objective definition ${objectiveId}` });
      }
    }
  });
export type CollectionGameRulesV2 = z.infer<typeof collectionGameRulesV2Schema>;

export const collectionGameRulesSchema = collectionGameRulesV2Schema;
export type CollectionGameRules = CollectionGameRulesV2;

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
