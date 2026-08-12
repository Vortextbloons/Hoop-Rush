import { z } from 'zod';
import { franchiseIdSchema } from './ids.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import {
  SEASON_AGGREGATES_VERSION,
  SEASON_LEADER_DEPTH,
  SEASON_LEADER_MIN_GAME_SHARE,
  SEASON_LEADERS_VERSION,
  SEASON_TEAM_COUNT,
} from './season-versions.ts';

/**
 * League aggregates and leaders (spec/2.0/02, M2.3, season-aggregates-v1).
 * Every aggregate value is a pure fold over compact completed-game summaries,
 * so a fresh fold always agrees with the stored checkpoint and an audit can
 * reconcile exactly. Standings wins/losses/points come from the official
 * game records (a forfeit counts 2-0); box-derived aggregate fields sum the
 * player stat lines, which are zero for forfeits. The two sources are
 * reconciled by the engine audit: standings and box points agree on every
 * non-forfeit game.
 */

/** Folding totals for one franchise over its played games. */
export const seasonTeamAggregateSchema = z.object({
  franchiseId: franchiseIdSchema,
  gamesPlayed: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  threePointersMade: z.number().int().nonnegative(),
  threePointersAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  offensiveRebounds: z.number().int().nonnegative(),
  defensiveRebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
  possessions: z.number().int().nonnegative(),
});
export type SeasonTeamAggregate = z.infer<typeof seasonTeamAggregateSchema>;

/**
 * One zeroed team aggregate row for a franchise with no played games yet
 * (every numeric fold field starts at 0). Passes `seasonTeamAggregateSchema`.
 */
export function emptySeasonTeamAggregate(franchiseId: string): SeasonTeamAggregate {
  return {
    franchiseId,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    possessions: 0,
  };
}

/** Folding totals for one drafted player-version over its played games. */
export const seasonPlayerAggregateSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  /** Owning franchise of this version (ownership is exclusive). */
  franchiseId: franchiseIdSchema,
  gamesPlayed: z.number().int().nonnegative(),
  /**
   * M2.6 awards facts: games with recorded on-court seconds greater than
   * zero (a zero-second line is not an appearance).
   */
  appearances: z.number().int().nonnegative(),
  /** Games the player was in the actual opening lineup (from the first period-1 stint). */
  started: z.number().int().nonnegative(),
  seconds: z.number().int().nonnegative(),
  points: z.number().int().nonnegative(),
  fieldGoalsMade: z.number().int().nonnegative(),
  fieldGoalsAttempted: z.number().int().nonnegative(),
  threePointersMade: z.number().int().nonnegative(),
  threePointersAttempted: z.number().int().nonnegative(),
  freeThrowsMade: z.number().int().nonnegative(),
  freeThrowsAttempted: z.number().int().nonnegative(),
  offensiveRebounds: z.number().int().nonnegative(),
  defensiveRebounds: z.number().int().nonnegative(),
  assists: z.number().int().nonnegative(),
  steals: z.number().int().nonnegative(),
  blocks: z.number().int().nonnegative(),
  turnovers: z.number().int().nonnegative(),
  fouls: z.number().int().nonnegative(),
});
export type SeasonPlayerAggregate = z.infer<typeof seasonPlayerAggregateSchema>;

/**
 * One zeroed player aggregate row for a version with no played games yet
 * (every numeric fold field starts at 0). Passes `seasonPlayerAggregateSchema`.
 */
export function emptySeasonPlayerAggregate(
  playerVersionId: string,
  franchiseId: string,
): SeasonPlayerAggregate {
  return {
    playerVersionId,
    franchiseId,
    gamesPlayed: 0,
    appearances: 0,
    started: 0,
    seconds: 0,
    points: 0,
    fieldGoalsMade: 0,
    fieldGoalsAttempted: 0,
    threePointersMade: 0,
    threePointersAttempted: 0,
    freeThrowsMade: 0,
    freeThrowsAttempted: 0,
    offensiveRebounds: 0,
    defensiveRebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
  };
}

/** Per-category leader tables (identity = playerVersionId). */
export const seasonLeaderCategorySchema = z.enum([
  'points',
  'rebounds',
  'assists',
  'steals',
  'blocks',
  'threePointersMade',
]);
export type SeasonLeaderCategory = z.infer<typeof seasonLeaderCategorySchema>;

export const seasonLeaderEntrySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  franchiseId: franchiseIdSchema,
  gamesPlayed: z.number().int().nonnegative(),
  /** Category total over eligible games. */
  value: z.number().nonnegative(),
  /** value / gamesPlayed (rate categories only; still provided). */
  perGame: z.number().nonnegative(),
});
export type SeasonLeaderEntry = z.infer<typeof seasonLeaderEntrySchema>;

export const seasonLeadersSchema = z.object({
  schemaVersion: z.literal(1),
  leadersVersion: z.literal(SEASON_LEADERS_VERSION),
  /** Eligibility and tie-break facts are frozen (see module docstring). */
  minimumGameShare: z.literal(SEASON_LEADER_MIN_GAME_SHARE),
  depth: z.literal(SEASON_LEADER_DEPTH),
  categories: z.object({
    points: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    rebounds: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    assists: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    steals: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    blocks: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
    threePointersMade: z.array(seasonLeaderEntrySchema).max(SEASON_LEADER_DEPTH),
  }),
});
export type SeasonLeaders = z.infer<typeof seasonLeadersSchema>;

/** Both aggregate tables, canonically sorted, ready for storage and digests. */
export const seasonAggregatesSchema = z.object({
  schemaVersion: z.literal(1),
  aggregatesVersion: z.literal(SEASON_AGGREGATES_VERSION),
  /** Sorted by franchiseId ascending. */
  teams: z.array(seasonTeamAggregateSchema).length(SEASON_TEAM_COUNT),
  /** Sorted by playerVersionId ascending. */
  players: z.array(seasonPlayerAggregateSchema).length(SEASON_TEAM_COUNT * 10),
});
export type SeasonAggregates = z.infer<typeof seasonAggregatesSchema>;
