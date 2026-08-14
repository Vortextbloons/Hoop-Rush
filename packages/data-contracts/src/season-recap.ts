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

/**
 * Block recap (spec/2.0/02 recap, spec/2.0/11 block recap, M2.5,
 * season-recap-v3; M2.6.5 season-recap-v4). Every claim derives from saved
 * league facts: game summaries, standings, aggregates, the block-level
 * effects evidence (M2.4), the block-level injury, objective, trade, and
 * Influence evidence (M2.5), and — since v4 — the block-level free-agency
 * evidence (signings, human Influence delta, season signing/spend counts).
 * All arrays are bounded.
 */

/** Block-level effects evidence for one mechanism on one side (M2.4). */
export const seasonBlockEffectsEvidenceSchema = z.object({
  mechanism: seasonMechanismSchema,
  side: seasonEffectsSideSchema,
  /** Total opportunities for the mechanism across the block's games. */
  blockOpportunities: z.number().int().min(0).max(10_000_000),
  /** Accumulated probability delta in integer millionths (may be negative). */
  blockDeltaTotal: z.number().int().min(-10_000_000_000_000).max(10_000_000_000_000),
});
export type SeasonBlockEffectsEvidence = z.infer<typeof seasonBlockEffectsEvidenceSchema>;

/**
 * M2.5 block-level injury evidence, counted from the block's summary injury
 * events and the health state at block end. `humanTeamInjuries` is the
 * compact per-game list for the human franchise's games.
 */
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

/**
 * M2.5 evaluated objective evidence for the block: the locked objective,
 * its recorded success, and the saved evaluation facts (no invented
 * numbers). Null for the final two-game block 8.
 */
export const seasonBlockObjectiveEvidenceSchema = z.object({
  objectiveId: seasonObjectiveIdSchema,
  success: z.boolean(),
  evaluationFacts: seasonObjectiveEvaluationFactsSchema,
});
export type SeasonBlockObjectiveEvidence = z.infer<typeof seasonBlockObjectiveEvidenceSchema>;

/** M2.5 block-level trade evidence (human + AI accepted trades, human delta). */
export const seasonBlockTradeEvidenceSchema = z.object({
  /** Block-level accepted trades (human + AI). */
  tradesAccepted: z.number().int().nonnegative(),
  /** The human franchise's Influence delta this block (may be negative). */
  influenceDelta: z.number().int(),
});
export type SeasonBlockTradeEvidence = z.infer<typeof seasonBlockTradeEvidenceSchema>;

/**
 * M2.6.5 block-level free-agency evidence (season-recap-v4): the window
 * resolved this block (if any), its signings, the human franchise's
 * Influence delta from free agency this block, and the human franchise's
 * season signing/spend counts (caps 3/6).
 */
export const seasonBlockFreeAgencyEvidenceSchema = z.object({
  /** The window resolved this block, when one was. */
  windowIndex: z.number().int().min(0).max(2).nullable(),
  /** Signings recorded this block, each with its franchise and band. */
  signings: z.array(
    z.object({
      franchiseId: franchiseIdSchema,
      playerVersionId: playerVersionIdSchema,
      band: seasonFreeAgencyBandSchema,
      influenceCost: z.number().int().min(1).max(3),
    }),
  ),
  /** The human franchise's free-agency Influence delta this block (≤ 0). */
  influenceDelta: z.number().int(),
  /** The human franchise's season signing count after this block (cap 3). */
  seasonSignings: z.number().int().min(0).max(3),
  /** The human franchise's season free-agency spend after this block (cap 6). */
  seasonSpend: z.number().int().min(0).max(6),
});
export type SeasonBlockFreeAgencyEvidence = z.infer<typeof seasonBlockFreeAgencyEvidenceSchema>;

/**
 * M2.5 recap Influence balance (LEAD DECISION: recap shows the human
 * balance only; the ledger is the authoritative source).
 */
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
  /** Provisional display position (wins, differential, franchise id). */
  positionBefore: z.number().int().min(1),
  positionAfter: z.number().int().min(1),
});
export type SeasonRecordMovement = z.infer<typeof seasonRecordMovementSchema>;

/** One notable block performance, from a single saved game summary. */
export const seasonNotablePerformanceSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  gameId: seasonGameIdSchema,
  points: z.number().int().nonnegative(),
  rebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  /** Human-team performances are ranked ahead of league ones. */
  humanTeam: z.boolean(),
});
export type SeasonNotablePerformance = z.infer<typeof seasonNotablePerformanceSchema>;

/** Current winning or losing streak, from ordered game results. */
export const seasonStreakSchema = z.object({
  franchiseId: franchiseIdSchema,
  kind: z.enum(['wins', 'losses']),
  length: z.number().int().min(2),
});
export type SeasonStreak = z.infer<typeof seasonStreakSchema>;

/**
 * Version-versus-version spotlight: two versions of the same person
 * (same person id, distinct playerVersionIds) both played in the block.
 * `sameTeam` records whether they share one roster; the simulation grants no
 * special chemistry.
 */
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
  /** Block meetings between the two teams. */
  headToHeadGames: z.number().int().nonnegative(),
  headToHeadWinsA: z.number().int().nonnegative(),
  headToHeadWinsB: z.number().int().nonnegative(),
});
export type SeasonVersionSpotlight = z.infer<typeof seasonVersionSpotlightSchema>;

/** The human team's next games after this block (final block: next opponents). */
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
  /** Rounds completed when this recap was built. */
  completedRounds: z.number().int().min(0).max(82),
  humanRecord: seasonRecordMovementSchema.nullable(),
  /** Movement for every franchise, sorted by franchiseId. */
  standingsMovement: z.array(seasonRecordMovementSchema).max(30),
  notablePerformances: z.array(seasonNotablePerformanceSchema).max(10),
  streaks: z.array(seasonStreakSchema).max(10),
  versionSpotlights: z.array(seasonVersionSpotlightSchema).max(5),
  /** Human games in the upcoming block (empty when the season is complete). */
  upcomingHumanGames: z.array(seasonUpcomingHumanGameSchema).max(10),
  /**
   * M2.4 block-level effects evidence (at most one row per mechanism per
   * side). Optional so M2.3 recaps parse unchanged; a block with the zero
   * profile emits no evidence.
   */
  effectsEvidence: z.array(seasonBlockEffectsEvidenceSchema).max(12).optional(),
  /** M2.5: block-level injury evidence. */
  injuryEvidence: seasonBlockInjuryEvidenceSchema,
  /** M2.5: evaluated objective evidence; null for the final two-game block 8. */
  objectiveEvidence: seasonBlockObjectiveEvidenceSchema.nullable(),
  /** M2.5: block-level trade evidence. */
  tradeEvidence: seasonBlockTradeEvidenceSchema,
  /** M2.6.5: block-level free-agency evidence. */
  freeAgencyEvidence: seasonBlockFreeAgencyEvidenceSchema,
  /** M2.5: human Influence balance at block end. */
  influenceBalance: seasonBlockInfluenceBalanceSchema,
});
export type SeasonBlockRecap = z.infer<typeof seasonBlockRecapSchema>;
