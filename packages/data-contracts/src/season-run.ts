import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema, seedSchema } from './ids.js';
import { seasonLeagueSchema } from './season-league.js';
import { seasonGameSchema } from './season-game.js';
import { seasonStandingsSchema } from './season-standings.js';
import { seasonCursorSchema } from './season-cursor.js';
import { seasonPostseasonStateSchema } from './season-postseason.js';
import { playerVersionIdSchema } from './season-identity.js';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_AI_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_GAME_COUNT,
  SEASON_LEAGUE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TEAM_COUNT,
} from './season-versions.js';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.js';
import {
  seasonAiAssignmentSchema,
  seasonGenerationDiagnosticsSchema,
  seasonRosterEvaluationSchema,
} from './season-ai.js';
import { seasonRotationSchema } from './season-rotation.js';

/**
 * Complete versioned Season Run persistence snapshot (spec/2.0/07). One
 * validated record covers the frozen league, ten-player rosters, ownership,
 * schedule reference, all league games, reduced standings, the block cursor,
 * postseason state, and — since schema version 2 (M2.1) — the completed draft
 * facts, AI assignments, generated rotations, and the generation audit
 * summary, so a saved run can be resumed, audited, and reproduced from its
 * root seed and versions.
 */

export {
  seasonRosterEntrySchema,
  seasonRosterSchema,
  seasonOwnershipSchema,
} from './season-roster.js';
export type { SeasonRosterEntry, SeasonRoster, SeasonOwnership } from './season-roster.js';

/** Completed draft facts for the human participants (M2.1). */
export const seasonDraftFactsSchema = z.object({
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  participants: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: franchiseIdSchema,
      /** Every roll attempt recorded for this participant, in order. */
      rolls: z.array(
        z.object({
          franchiseId: franchiseIdSchema,
          eraId: eraIdSchema,
          attemptIndex: z.number().int().nonnegative(),
          usable: z.boolean(),
        }),
      ),
      claims: z.array(z.object({ franchiseId: franchiseIdSchema, eraId: eraIdSchema })),
      picks: z.array(
        z.object({
          round: z.number().int().min(1).max(10),
          playerVersionId: playerVersionIdSchema,
          franchiseId: franchiseIdSchema,
          eraId: eraIdSchema,
        }),
      ),
    }),
  ),
});
export type SeasonDraftFacts = z.infer<typeof seasonDraftFactsSchema>;

/** M2.1 generation audit summary attached to the run. */
export const seasonGenerationAuditSchema = z.object({
  seed: seedSchema,
  aiVersion: z.literal(SEASON_AI_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  rosterTargetsVersion: z.literal(SEASON_ROSTER_TARGETS_VERSION),
  /** Canonical digest of the generation result (engine season/digest). */
  digest: z.string().regex(/^[0-9a-f]{32}$/),
  diagnostics: seasonGenerationDiagnosticsSchema,
});
export type SeasonGenerationAudit = z.infer<typeof seasonGenerationAuditSchema>;

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
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  rosterRulesVersion: z.literal(SEASON_ROSTER_RULES_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  aiVersion: z.literal(SEASON_AI_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  rosterTargetsVersion: z.literal(SEASON_ROSTER_TARGETS_VERSION),
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
  /** M2.1: completed human draft facts. */
  draft: seasonDraftFactsSchema,
  /** M2.1: band + identity assignment for every franchise (30 rows). */
  aiAssignments: z.array(seasonAiAssignmentSchema).length(SEASON_TEAM_COUNT),
  /** M2.1: one legal rotation per franchise (30 rows). */
  rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
  /** M2.1: generation audit summary (digest, diagnostics, versions). */
  generationAudit: seasonGenerationAuditSchema,
  /** M2.1: per-roster strength evaluations (30 rows). */
  evaluations: z.array(seasonRosterEvaluationSchema).length(SEASON_TEAM_COUNT),
});
export type SeasonRun = z.infer<typeof seasonRunSchema>;
