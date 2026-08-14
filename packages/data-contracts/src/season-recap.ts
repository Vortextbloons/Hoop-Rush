import { z } from 'zod';
import { franchiseIdSchema, seasonGameIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonCompactInjuryEventSchema, seasonInjurySeveritySchema } from './season-health.ts';
import { seasonEffectsSideSchema, seasonMechanismSchema } from './season-effects.ts';
import { seasonFreeAgencyBandSchema } from './season-free-agency.ts';
import {
  seasonObjectiveEvaluationFactsSchema,
  seasonObjectiveIdSchema,
} from './season-objective.ts';
import { SEASON_RECAP_VERSION } from './season-versions.ts';

export const seasonBlockEffectsEvidenceSchema = z.object({
  mechanism: seasonMechanismSchema,
  side: seasonEffectsSideSchema,

  blockOpportunities: z.number().int().min(0).max(10_000_000),

  blockDeltaTotal: z.number().int().min(-10_000_000_000_000).max(10_000_000_000_000),
});
export type SeasonBlockEffectsEvidence = z.infer<typeof seasonBlockEffectsEvidenceSchema>;

export const seasonBlockInjuryEvidenceSchema = z.object({
  injuries: z.number().int().nonnegative(),
  bySeverity: z.record(seasonInjurySeveritySchema, z.number().int().nonnegative()),
  sameGameReturns: z.number().int().nonnegative(),
  seasonEnding: z.number().int().nonnegative(),
  returnedThisBlock: z.number().int().nonnegative(),
  activeAtBlockEnd: z.number().int().nonnegative(),
  humanTeamInjuries: z.array(seasonCompactInjuryEventSchema).max(40),
});
export type SeasonBlockInjuryEvidence = z.infer<typeof seasonBlockInjuryEvidenceSchema>;

export const seasonBlockObjectiveEvidenceSchema = z.object({
  objectiveId: seasonObjectiveIdSchema,
  success: z.boolean(),
  evaluationFacts: seasonObjectiveEvaluationFactsSchema,
});
export type SeasonBlockObjectiveEvidence = z.infer<typeof seasonBlockObjectiveEvidenceSchema>;

export const seasonBlockTradeEvidenceSchema = z.object({
  tradesAccepted: z.number().int().nonnegative(),

  influenceDelta: z.number().int(),
});
export type SeasonBlockTradeEvidence = z.infer<typeof seasonBlockTradeEvidenceSchema>;

export const seasonBlockFreeAgencyEvidenceSchema = z.object({
  windowIndex: z.number().int().min(0).max(2).nullable(),

  signings: z.array(
    z.object({
      franchiseId: franchiseIdSchema,
      playerVersionId: playerVersionIdSchema,
      band: seasonFreeAgencyBandSchema,
      influenceCost: z.number().int().min(1).max(3),
    }),
  ),

  influenceDelta: z.number().int(),

  seasonSignings: z.number().int().min(0).max(3),

  seasonSpend: z.number().int().min(0).max(6),
});
export type SeasonBlockFreeAgencyEvidence = z.infer<typeof seasonBlockFreeAgencyEvidenceSchema>;

export const seasonBlockInfluenceBalanceSchema = z.object({
  humanBalance: z.number().int(),
});
export type SeasonBlockInfluenceBalance = z.infer<typeof seasonBlockInfluenceBalanceSchema>;

export const seasonRecordMovementSchema = z.object({
  franchiseId: franchiseIdSchema,
  winsBefore: z.number().int().nonnegative(),
  lossesBefore: z.number().int().nonnegative(),
  winsAfter: z.number().int().nonnegative(),
  lossesAfter: z.number().int().nonnegative(),

  positionBefore: z.number().int().min(1),
  positionAfter: z.number().int().min(1),
});
export type SeasonRecordMovement = z.infer<typeof seasonRecordMovementSchema>;

export const seasonNotablePerformanceSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  gameId: seasonGameIdSchema,
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),

  humanTeam: z.boolean(),
});
export type SeasonNotablePerformance = z.infer<typeof seasonNotablePerformanceSchema>;

export const seasonStreakSchema = z.object({
  franchiseId: franchiseIdSchema,
  kind: z.enum(['wins', 'losses']),
  length: z.number().int().min(2),
});
export type SeasonStreak = z.infer<typeof seasonStreakSchema>;

export const seasonVersionSpotlightSchema = z.object({
  versionA: playerVersionIdSchema,
  versionB: playerVersionIdSchema,
  sameTeam: z.boolean(),
  gamesPlayedA: z.number().int().nonnegative(),
  gamesPlayedB: z.number().int().nonnegative(),
  pointsA: z.number().int().nonnegative(),
  pointsB: z.number().int().nonnegative(),
  reboundsA: z.number().int().nonnegative(),
  reboundsB: z.number().int().nonnegative(),
  assistsA: z.number().int().nonnegative(),
  assistsB: z.number().int().nonnegative(),

  headToHeadGames: z.number().int().nonnegative(),
  headToHeadWinsA: z.number().int().nonnegative(),
  headToHeadWinsB: z.number().int().nonnegative(),
});
export type SeasonVersionSpotlight = z.infer<typeof seasonVersionSpotlightSchema>;

export const seasonUpcomingHumanGameSchema = z.object({
  gameId: seasonGameIdSchema,
  round: z.number().int().min(1).max(82),
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,
  humanIsHome: z.boolean(),
  opponentFranchiseId: franchiseIdSchema,
});
export type SeasonUpcomingHumanGame = z.infer<typeof seasonUpcomingHumanGameSchema>;

export const seasonBlockRecapSchema = z.object({
  schemaVersion: z.literal(1),
  recapVersion: z.literal(SEASON_RECAP_VERSION),
  runId: z.string().min(1).max(64),
  blockIndex: z.number().int().min(0).max(8),

  completedRounds: z.number().int().min(0).max(82),
  humanRecord: seasonRecordMovementSchema.nullable(),

  standingsMovement: z.array(seasonRecordMovementSchema).max(30),
  notablePerformances: z.array(seasonNotablePerformanceSchema).max(10),
  streaks: z.array(seasonStreakSchema).max(10),
  versionSpotlights: z.array(seasonVersionSpotlightSchema).max(5),

  upcomingHumanGames: z.array(seasonUpcomingHumanGameSchema).max(10),

  effectsEvidence: z.array(seasonBlockEffectsEvidenceSchema).max(12).optional(),

  injuryEvidence: seasonBlockInjuryEvidenceSchema,

  objectiveEvidence: seasonBlockObjectiveEvidenceSchema.nullable(),

  tradeEvidence: seasonBlockTradeEvidenceSchema,

  freeAgencyEvidence: seasonBlockFreeAgencyEvidenceSchema,

  influenceBalance: seasonBlockInfluenceBalanceSchema,
});
export type SeasonBlockRecap = z.infer<typeof seasonBlockRecapSchema>;
