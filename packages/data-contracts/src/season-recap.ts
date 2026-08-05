import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { SEASON_RECAP_VERSION } from './season-versions.ts';

/**
 * Block recap (spec/2.0/02 recap, spec/2.0/11 block recap, M2.3,
 * season-recap-v1). Every claim derives from saved league facts: game
 * summaries, standings, and aggregates. M2.3 recaps do not report injuries,
 * trades, Influence, stamina, or chemistry claims; those systems ship in
 * later milestones. All arrays are bounded.
 */

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
  gameId: z.string().regex(/^s[0-9]{6}$/),
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
  gameId: z.string().regex(/^s[0-9]{6}$/),
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
});
export type SeasonBlockRecap = z.infer<typeof seasonBlockRecapSchema>;
