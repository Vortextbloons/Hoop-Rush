import { z } from 'zod';
import { playerIdSchema } from './ids.ts';
import { positionSchema } from './positions.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  HAVOC_COMPARISON_VERSION,
  HAVOC_MVP_INDEX_WEIGHTS,
  HAVOC_MVP_INDEX_VERSION,
  HAVOC_REPORT_VERSION,
  HAVOC_SCHEMA_VERSION,
  havocVersionSetSchema,
} from './havoc-versions.ts';
import {
  havocHighlightSchema,
  havocParticipantKindSchema,
  havocStatLineSchema,
} from './havoc-game.ts';
import { havocMutationEntrySchema, havocMutationIdSchema } from './havoc-mutations.ts';

export const havocMatchedGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  opponentId: z.string().min(1).max(64),
  humanHome: z.boolean(),
  havoc: z.object({
    humanScore: z.number().int(),
    opponentScore: z.number().int(),
    outcome: z.enum(['win', 'loss']),
    resultDigest: z.string().min(1).max(64),
  }),
  normal: z.object({
    humanScore: z.number().int(),
    opponentScore: z.number().int(),
    outcome: z.enum(['win', 'loss']),
    resultDigest: z.string().min(1).max(64),
  }),
  deltas: z.object({
    pointsFor: z.number().int(),
    pointsAgainst: z.number().int(),
    margin: z.number().int(),
  }),
  flips: z.object({
    havocWinNormalLoss: z.boolean(),
    normalWinHavocLoss: z.boolean(),
  }),
  highlights: z.array(havocHighlightSchema).max(8),
});
export type HavocMatchedGame = z.infer<typeof havocMatchedGameSchema>;

export const havocSlotParticipantLineSchema = z.object({
  kind: havocParticipantKindSchema,
  instanceId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(96),
  line: havocStatLineSchema,
});
export type HavocSlotParticipantLine = z.infer<typeof havocSlotParticipantLineSchema>;

export const havocSlotSideSchema = z.object({
  combined: havocStatLineSchema,
  lines: z.array(havocSlotParticipantLineSchema).min(1).max(3),
});
export type HavocSlotSide = z.infer<typeof havocSlotSideSchema>;

export const havocStatDeltaSchema = z.object({
  secondsPlayed: z.number().int(),
  minutes: z.number().int(),
  points: z.number().int(),
  fieldGoalsMade: z.number().int(),
  fieldGoalAttempts: z.number().int(),
  threesMade: z.number().int(),
  threesAttempted: z.number().int(),
  freeThrowsMade: z.number().int(),
  freeThrowsAttempted: z.number().int(),
  rebounds: z.number().int(),
  offensiveRebounds: z.number().int(),
  defensiveRebounds: z.number().int(),
  assists: z.number().int(),
  steals: z.number().int(),
  blocks: z.number().int(),
  turnovers: z.number().int(),
  fouls: z.number().int(),
  adjustments: z.number().int(),
  productionIndex: z.number().int(),
});
export type HavocStatDelta = z.infer<typeof havocStatDeltaSchema>;

export const havocSlotComparisonSchema = z.object({
  slot: positionSchema,
  displayName: z.string().min(1).max(96),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  havoc: havocSlotSideSchema,
  normal: havocSlotSideSchema,
  deltas: havocStatDeltaSchema,
  productionIndex: z.object({
    havoc: z.number().int(),
    normal: z.number().int(),
    gain: z.number().int(),
  }),
});
export type HavocSlotComparison = z.infer<typeof havocSlotComparisonSchema>;

export const havocMutationStatSchema = z.object({
  mutationId: havocMutationIdSchema,
  ownerCount: z.number().int().nonnegative(),
  triggers: z.number().int().nonnegative(),
  pointsDelta: z.number().int(),
  freeThrowsGranted: z.number().int().nonnegative(),
  turnoversCancelled: z.number().int().nonnegative(),
  extraPossessionsEarned: z.number().int().nonnegative(),
  extraPossessionsUsed: z.number().int().nonnegative(),
  extraPossessionsExpired: z.number().int().nonnegative(),
  swapPoints: z.number().int(),
  swapSeconds: z.number().int().nonnegative(),
  capSeconds: z.number().int().nonnegative(),
  ratingChanges: z.number().int().nonnegative(),
});
export type HavocMutationStat = z.infer<typeof havocMutationStatSchema>;

export const havocSeasonTotalsSchema = z.object({
  games: z.number().int().min(0).max(82),
  wins: z.number().int().min(0).max(82),
  losses: z.number().int().min(0).max(82),
  pointsFor: z.number().int(),
  pointsAgainst: z.number().int(),
  differential: z.number().int(),
  averagePointsFor: z.number(),
  averagePointsAgainst: z.number(),
  largestPointsFor: z.number().int(),
  largestPointsAgainst: z.number().int(),
  adjustments: z.number().int(),
});
export type HavocSeasonTotals = z.infer<typeof havocSeasonTotalsSchema>;

export const havocMvpSchema = z.object({
  slot: positionSchema,
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  displayName: z.string().min(1).max(96),
  havocIndex: z.number().int(),
  normalIndex: z.number().int(),
  gain: z.number().int(),
});
export type HavocMvp = z.infer<typeof havocMvpSchema>;

export const havocMvpWeightsSchema = z.object({
  points: z.literal(HAVOC_MVP_INDEX_WEIGHTS.points),
  rebounds: z.literal(HAVOC_MVP_INDEX_WEIGHTS.rebounds),
  assists: z.literal(HAVOC_MVP_INDEX_WEIGHTS.assists),
  steals: z.literal(HAVOC_MVP_INDEX_WEIGHTS.steals),
  blocks: z.literal(HAVOC_MVP_INDEX_WEIGHTS.blocks),
  turnovers: z.literal(HAVOC_MVP_INDEX_WEIGHTS.turnovers),
});
export type HavocMvpWeights = z.infer<typeof havocMvpWeightsSchema>;

export const havocDifferenceSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  opponentId: z.string().min(1).max(64),
  humanScore: z.number().int(),
  opponentScore: z.number().int(),
  pointsDelta: z.number().int(),
  outcome: z.enum(['win', 'loss']),
});
export type HavocDifference = z.infer<typeof havocDifferenceSchema>;

export const havocWildGameSchema = z.object({
  gameNumber: z.number().int().min(1).max(82),
  opponentId: z.string().min(1).max(64),
  humanScore: z.number().int(),
  opponentScore: z.number().int(),
  adjustments: z.number().int(),
  absoluteMargin: z.number().int().nonnegative(),
});
export type HavocWildGame = z.infer<typeof havocWildGameSchema>;

export const havocComparisonSchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  comparisonVersion: z.literal(HAVOC_COMPARISON_VERSION),
  mvpIndexVersion: z.literal(HAVOC_MVP_INDEX_VERSION),
  runId: z.string().min(1).max(64),
  havoc: havocSeasonTotalsSchema,
  normal: havocSeasonTotalsSchema,
  winsGained: z.number().int(),
  differentialDelta: z.number().int(),
  games: z.array(havocMatchedGameSchema).length(82),
  slots: z.array(havocSlotComparisonSchema).length(5),
  mutations: z.array(havocMutationStatSchema),
  mvp: havocMvpSchema,
  mvpIndexWeights: havocMvpWeightsSchema,
  largestPositiveDifferences: z.array(havocDifferenceSchema).max(5),
  largestNegativeDifferences: z.array(havocDifferenceSchema).max(5),
});
export type HavocComparison = z.infer<typeof havocComparisonSchema>;

export const havocReportLineupEntrySchema = z.object({
  slot: positionSchema,
  displayName: z.string().min(1).max(96),
  nickname: z.string().min(1).max(64),
  playerId: playerIdSchema,
  playerVersionId: playerVersionIdSchema.nullable(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  mutations: z.array(havocMutationEntrySchema).min(1).max(3),
});
export type HavocReportLineupEntry = z.infer<typeof havocReportLineupEntrySchema>;

export const havocReportSchema = z.object({
  schemaVersion: z.literal(HAVOC_SCHEMA_VERSION),
  reportVersion: z.literal(HAVOC_REPORT_VERSION),
  runId: z.string().min(1).max(64),
  versions: havocVersionSetSchema,
  status: z.enum(['comparison-pending', 'complete']),
  lineup: z.array(havocReportLineupEntrySchema).length(5),
  havoc: havocSeasonTotalsSchema,
  normal: havocSeasonTotalsSchema.nullable(),
  perfectSeason: z.boolean(),
  directMutationPoints: z.number().int(),
  mvp: havocMvpSchema.nullable(),
  comparison: havocComparisonSchema.nullable(),
  topGains: z.array(havocDifferenceSchema).max(5),
  topLosses: z.array(havocDifferenceSchema).max(5),
  wildestGames: z.array(havocWildGameSchema).max(5),
});
export type HavocReport = z.infer<typeof havocReportSchema>;
