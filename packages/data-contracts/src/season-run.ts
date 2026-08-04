import { z } from 'zod';
import {
  contentHashSchema,
  eraIdSchema,
  franchiseIdSchema,
  playerIdSchema,
  seasonKeySchema,
  seedSchema,
} from './ids.js';
import { seasonLeagueSchema } from './season-league.js';
import { seasonGameSchema } from './season-game.js';
import { seasonStandingsSchema } from './season-standings.js';
import { seasonCursorSchema } from './season-cursor.js';
import { seasonPostseasonStateSchema } from './season-postseason.js';
import { playerVersionIdSchema } from './season-identity.js';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_GAME_COUNT,
  SEASON_LEAGUE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TEAM_COUNT,
} from './season-versions.js';

/**
 * Complete versioned Season Run persistence snapshot (spec/2.0/07). One
 * validated record covers the frozen league, ten-player rosters, ownership,
 * schedule reference, all league games, reduced standings, the block cursor,
 * and postseason state, so a saved run can be resumed, audited, and
 * reproduced from its root seed and versions.
 */

export const seasonRosterEntrySchema = z.object({
  playerVersionId: playerVersionIdSchema,
  playerId: playerIdSchema,
  franchiseId: franchiseIdSchema,
  eraId: eraIdSchema,
  seasonKey: seasonKeySchema,
  displayName: z.string().min(1).max(96),
});
export type SeasonRosterEntry = z.infer<typeof seasonRosterEntrySchema>;

export const seasonRosterSchema = z.object({
  franchiseId: franchiseIdSchema,
  players: z.array(seasonRosterEntrySchema).length(SEASON_ROSTER_SIZE),
});
export type SeasonRoster = z.infer<typeof seasonRosterSchema>;

export const seasonOwnershipSchema = z.object({
  playerVersionId: playerVersionIdSchema,
  ownerFranchiseId: franchiseIdSchema,
});
export type SeasonOwnership = z.infer<typeof seasonOwnershipSchema>;

/** Reference to the committed schedule artifact the run plays. */
export const seasonScheduleReferenceSchema = z.object({
  leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
  scheduleVersion: z.literal(SEASON_SCHEDULE_VERSION),
  formulaVersion: z.literal(SEASON_SCHEDULE_FORMULA_VERSION),
  generationSeed: seedSchema,
  /** SHA-256 content hash of the packaged schedule artifact. */
  contentHash: contentHashSchema,
});
export type SeasonScheduleReference = z.infer<typeof seasonScheduleReferenceSchema>;

export const seasonRunVersionsSchema = z.object({
  runSchemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
  leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
  scheduleVersion: z.literal(SEASON_SCHEDULE_VERSION),
  scheduleFormulaVersion: z.literal(SEASON_SCHEDULE_FORMULA_VERSION),
  standingsVersion: z.literal(SEASON_STANDINGS_VERSION),
  postseasonVersion: z.literal(SEASON_POSTSEASON_VERSION),
  seedDerivationVersion: z.literal(SEASON_SEED_DERIVATION_VERSION),
  playerVersionIdVersion: z.literal(PLAYER_VERSION_ID_VERSION),
});
export type SeasonRunVersions = z.infer<typeof seasonRunVersionsSchema>;

export const seasonRunSchema = z.object({
  schemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
  runId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._:-]*$/),
  rootSeed: seedSchema,
  versions: seasonRunVersionsSchema,
  league: seasonLeagueSchema,
  rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),
  ownership: z.array(seasonOwnershipSchema).length(SEASON_TEAM_COUNT * SEASON_ROSTER_SIZE),
  schedule: seasonScheduleReferenceSchema,
  /** All 1,230 league games; scheduled until played. */
  games: z.array(seasonGameSchema).length(SEASON_GAME_COUNT),
  standings: seasonStandingsSchema,
  cursor: seasonCursorSchema,
  postseason: seasonPostseasonStateSchema,
});
export type SeasonRun = z.infer<typeof seasonRunSchema>;
