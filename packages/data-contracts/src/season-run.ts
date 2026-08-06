import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema, seedSchema } from './ids.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonGameSchema } from './season-game.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonCursorSchema } from './season-cursor.ts';
import { seasonPostseasonStateSchema } from './season-postseason.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonCheckpointStateSchema } from './season-checkpoint.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonInfluenceStateSchema } from './season-influence.ts';
import { seasonObjectiveStateSchema } from './season-objective.ts';
import { seasonTradeStateSchema } from './season-trade.ts';
import { seasonTransactionEntrySchema } from './season-transactions.ts';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_AI_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_DRAFT_LEGACY_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_GAME_COUNT,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_ROSTER_SIZE,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TEAM_COUNT,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
} from './season-versions.ts';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.ts';
import {
  seasonAiAssignmentSchema,
  seasonAiPoolSchema,
  seasonGenerationDiagnosticsSchema,
  seasonRosterEvaluationSchema,
} from './season-ai.ts';
import { seasonRotationSchema } from './season-rotation.ts';

/**
 * Complete versioned Season Run persistence snapshot (spec/2.0/07). One
 * validated record covers the frozen league, ten-player rosters, ownership,
 * schedule reference, all scheduled game identities, the block cursor,
 * postseason state, and — since schema version 6 (M2.4 roster-generation-v2)
 * — the frozen roster-generation-v2/season-ai-v2/roster-targets-v2 material
 * versions and the recorded `aiPools` (one 20-player pool per AI franchise:
 * 29 solo, 28 duo; human franchises get none). Schema version 7 (M2.5)
 * adds the run-scoped `health` (season-health-v1), `transactions`,
 * `influence` (season-influence-v1), `checkpointState`,
 * `stateRevision`/`stateDigest` state chain, and freezes the seven new M2.5
 * material versions (health, trade, influence, objective, injury-targets,
 * trade-targets, influence-targets); schema 6 runs cannot continue (no
 * health, influence, or state chain exists for them). Schema version 5
 * (M2.4) added the stamina, chemistry, and effect-targets material versions;
 * schema version 4 (M2.3) added the frozen block, summary, aggregates,
 * recap, leaders, home-court, and checkpoint material versions; schema
 * version 3 (M2.2) added the rotation-planner, Season-game, and
 * Season-game-targets material versions; schema version 2 (M2.1) added the
 * completed draft facts, AI assignments, generated rotations, and the
 * generation audit summary. Completed game facts live in per-block compact
 * summary rows (season-game-summary-v3), not in this snapshot's scheduled
 * `games` array; the engine reconstructs finalized game records from the
 * schedule and summaries on demand.
 */

export {
  seasonRosterEntrySchema,
  seasonRosterSchema,
  seasonOwnershipSchema,
} from './season-roster.ts';
export type { SeasonRosterEntry, SeasonRoster, SeasonOwnership } from './season-roster.ts';

/** Legacy M2.1-M2.3 draft facts: franchise-era rolls, claims, and picks. */
export const seasonLegacyDraftFactsSchema = z.object({
  draftVersion: z.literal(SEASON_DRAFT_LEGACY_VERSION),
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
export type SeasonLegacyDraftFacts = z.infer<typeof seasonLegacyDraftFactsSchema>;

/**
 * M2.3.5 draft facts: the global eight-card offers (with safety results and
 * seed paths) and the picks taken from them. Enough recorded facts survive so
 * reload and CLI replay reproduce the board exactly.
 */
export const seasonGlobalDraftFactsSchema = z.object({
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  participants: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: franchiseIdSchema,
      /** Every drawn offer for this participant, in draw order. */
      offers: z.array(
        z.object({
          round: z.number().int().min(1).max(10),
          pickOrdinal: z.number().int().min(1).max(10),
          seedPath: z.array(z.string()).min(1),
          cards: z.array(
            z.object({
              playerVersionId: playerVersionIdSchema,
              selectable: z.boolean(),
              coverageReason: z.string().min(1).max(256).nullable(),
            }),
          ),
        }),
      ),
      picks: z.array(
        z.object({
          round: z.number().int().min(1).max(10),
          playerVersionId: playerVersionIdSchema,
          franchiseId: franchiseIdSchema,
          eraId: eraIdSchema,
          seedPath: z.array(z.string()).min(1),
        }),
      ),
    }),
  ),
});
export type SeasonGlobalDraftFacts = z.infer<typeof seasonGlobalDraftFactsSchema>;

/**
 * Completed draft facts for the human participants. Discriminated on the
 * draft version: schema 4 runs keep playing under either variant, so legacy
 * M2.3 runs and new season-draft-v2 runs both read as v4 snapshots.
 */
export const seasonDraftFactsSchema = z.discriminatedUnion('draftVersion', [
  seasonGlobalDraftFactsSchema,
  seasonLegacyDraftFactsSchema,
]);
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
  /**
   * Draft rules version: legacy M2.3 runs freeze `season-draft-v1`; new runs
   * freeze `season-draft-v2` (global eight-card offers).
   */
  draftVersion: z.union([z.literal(SEASON_DRAFT_VERSION), z.literal(SEASON_DRAFT_LEGACY_VERSION)]),
  rosterRulesVersion: z.literal(SEASON_ROSTER_RULES_VERSION),
  rosterGenerationVersion: z.literal(SEASON_ROSTER_GENERATION_VERSION),
  aiVersion: z.literal(SEASON_AI_VERSION),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),
  /** M2.2: substitution planner rules. */
  rotationPlannerVersion: z.literal(SEASON_ROTATION_PLANNER_VERSION),
  /** M2.2->M2.3: Season game controller rules (v2 adds the home-court seam). */
  gameVersion: z.literal(SEASON_GAME_VERSION),
  /** M2.2->M2.3: recalibrated Season game cohort and envelopes. */
  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  rosterTargetsVersion: z.literal(SEASON_ROSTER_TARGETS_VERSION),
  /** M2.3: block pipeline, compact summaries, aggregates, recap, leaders. */
  blockVersion: z.literal(SEASON_BLOCK_VERSION),
  summaryVersion: z.literal(SEASON_GAME_SUMMARY_VERSION),
  aggregatesVersion: z.literal(SEASON_AGGREGATES_VERSION),
  recapVersion: z.literal(SEASON_RECAP_VERSION),
  leadersVersion: z.literal(SEASON_LEADERS_VERSION),
  /** M2.3: home-court profile. */
  homeCourtVersion: z.literal(SEASON_HOME_COURT_VERSION),
  /** M2.3: canonical checkpoint contract and digest. */
  checkpointVersion: z.literal(SEASON_CHECKPOINT_VERSION),
  /** M2.4: stamina profile derivation (season-stamina-v1). */
  staminaVersion: z.literal(SEASON_STAMINA_VERSION),
  /** M2.4: pair chemistry state rules (season-chemistry-v1). */
  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),
  /** M2.4: frozen effect-size calibration targets (season-effect-targets-v1). */
  effectsTargetsVersion: z.literal(SEASON_EFFECT_TARGETS_VERSION),
  /** M2.5: injury and health state rules (season-health-v1). */
  healthVersion: z.literal(SEASON_HEALTH_VERSION),
  /** M2.5: trade contract (season-trade-v1). */
  tradeVersion: z.literal(SEASON_TRADE_VERSION),
  /** M2.5: Influence economy (season-influence-v1). */
  influenceVersion: z.literal(SEASON_INFLUENCE_VERSION),
  /** M2.5: block objectives (season-objective-v1). */
  objectiveVersion: z.literal(SEASON_OBJECTIVE_VERSION),
  /** M2.5: frozen injury calibration targets (injury-targets-v1). */
  injuryTargetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),
  /** M2.5: frozen trade calibration targets (trade-targets-v1). */
  tradeTargetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),
  /** M2.5: frozen Influence calibration targets (influence-targets-v1). */
  influenceTargetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),
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
  /** M2.4 roster-generation-v2: one pool per AI franchise (29 solo, 28 duo). */
  aiPools: z.array(seasonAiPoolSchema).min(28).max(29),
  /** M2.1: one legal rotation per franchise (30 rows). */
  rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
  /** M2.1: generation audit summary (digest, diagnostics, versions). */
  generationAudit: seasonGenerationAuditSchema,
  /** M2.1: per-roster strength evaluations (30 rows). */
  evaluations: z.array(seasonRosterEvaluationSchema).length(SEASON_TEAM_COUNT),
  /** M2.5: run-scoped trade-window state (null until the first window opens). */
  trade: seasonTradeStateSchema.nullable(),
  /** M2.5: run-scoped objective selections per block 0-7 (fixed catalog). */
  objectives: seasonObjectiveStateSchema,
  /**
   * M2.5: run-scoped health state (append-only injury records; availability
   * is derived, never stored separately).
   */
  health: seasonHealthStateSchema,
  /** M2.5: append-only run-scoped transaction log entries. */
  transactions: z.array(seasonTransactionEntrySchema),
  /** M2.5: Influence economy state (balances, ledger, windows, rehabs). */
  influence: seasonInfluenceStateSchema,
  /** M2.5: latest accepted checkpoint facts; null until the first block commits. */
  checkpointState: seasonCheckpointStateSchema.nullable(),
  /** M2.5: increments on every committed block AND every applied run command. */
  stateRevision: z.number().int().nonnegative(),
  /** M2.5: canonical digest of the mutable run state (32-hex, self-excluded). */
  stateDigest: z.string().regex(/^[0-9a-f]{32}$/),
});
export type SeasonRun = z.infer<typeof seasonRunSchema>;

/**
 * The run facts the Season block pipeline reads at a submission boundary
 * (spec/2.0/07): identity, cursor, league, rosters, locked rotations, and
 * versions. The worker wire carries only this context; the scheduled `games`
 * array, `standings`, `draft`, `ownership`, `postseason`, `aiAssignments`,
 * `aiPools`, `evaluations`, and `generationAudit` stay in the persisted
 * snapshot and never cross the worker boundary. `aiPools` in particular are
 * persistence-only: simulation consumes the final rosters, never the pools,
 * so this context deliberately does not gain an `aiPools` field. A full
 * `SeasonRun` satisfies this shape.
 */
export const seasonBlockRunContextSchema = z.object({
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
  rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
  cursor: seasonCursorSchema,
});
export type SeasonBlockRunContext = z.infer<typeof seasonBlockRunContextSchema>;
