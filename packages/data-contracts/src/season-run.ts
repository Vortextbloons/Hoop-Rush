import { z } from 'zod';
import { contentHashSchema, eraIdSchema, franchiseIdSchema, idSchema, seedSchema } from './ids.ts';
import { seasonCheckpointDigestSchema } from './season-digests.ts';
import { seasonLeagueSchema } from './season-league.ts';
import { seasonGameSchema } from './season-game.ts';
import { seasonStandingsSchema } from './season-standings.ts';
import { seasonCursorSchema } from './season-cursor.ts';
import { seasonPostseasonStateSchema } from './season-postseason.ts';
import { seasonAwardsSchema } from './season-awards.ts';
import { playerVersionIdSchema } from './season-identity.ts';
import { seasonCheckpointStateSchema } from './season-checkpoint.ts';
import { seasonHealthStateSchema } from './season-health.ts';
import { seasonInfluenceStateSchema } from './season-influence.ts';
import { seasonObjectiveStateSchema } from './season-objective.ts';
import { seasonCampaignStateSchema } from './season-campaign.ts';
import { seasonTradeStateSchema } from './season-trade.ts';
import { seasonTransactionEntrySchema } from './season-transactions.ts';
import {
  PLAYER_VERSION_ID_VERSION,
  SEASON_AI_V2,
  SEASON_AI_VERSION,
  SEASON_AGGREGATES_VERSION,
  SEASON_ALMANAC_VERSION,
  SEASON_AWARDS_VERSION,
  SEASON_BLOCK_VERSION,
  SEASON_CHECKPOINT_VERSION,
  SEASON_CHEMISTRY_VERSION,
  SEASON_COMMAND_LOG_VERSION,
  SEASON_DRAFT_LEGACY_VERSION,
  SEASON_DRAFT_VERSION,
  SEASON_EFFECT_TARGETS_LEGACY_VERSION,
  SEASON_EFFECT_TARGETS_VERSION,
  SEASON_FREE_AGENCY_INDEX_VERSION,
  SEASON_FREE_AGENCY_TARGETS_VERSION,
  SEASON_FREE_AGENCY_VERSION,
  SEASON_GAME_COUNT,
  SEASON_GAME_SUMMARY_VERSION,
  SEASON_GAME_TARGETS_VERSION,
  SEASON_GAME_VERSION,
  SEASON_HEALTH_VERSION,
  SEASON_CAMPAIGN_TARGETS_VERSION,
  SEASON_CAMPAIGN_VERSION,
  SEASON_HOME_COURT_VERSION,
  SEASON_INFLUENCE_TARGETS_VERSION,
  SEASON_INFLUENCE_VERSION,
  SEASON_INJURY_TARGETS_VERSION,
  SEASON_LEAGUE_VERSION,
  SEASON_LEADERS_VERSION,
  SEASON_MINUTE_POLICY_VERSION,
  SEASON_OBJECTIVE_VERSION,
  SEASON_POSTSEASON_SUMMARY_VERSION,
  SEASON_POSTSEASON_TARGETS_VERSION,
  SEASON_POSTSEASON_VERSION,
  SEASON_RECAP_VERSION,
  SEASON_REPLAY_EXPORT_VERSION,
  SEASON_ROSTER_GENERATION_V2,
  SEASON_ROSTER_GENERATION_VERSION,
  SEASON_ROSTER_RULES_VERSION,
  SEASON_ROSTER_TARGETS_V2,
  SEASON_ROSTER_TARGETS_VERSION,
  SEASON_DRAFT_SIZE,
  SEASON_ROTATION_PLANNER_VERSION,
  SEASON_ROTATION_VERSION,
  SEASON_RUN_SCHEMA_VERSION,
  SEASON_SCHEDULE_FORMULA_VERSION,
  SEASON_SCHEDULE_VERSION,
  SEASON_SEED_DERIVATION_VERSION,
  SEASON_STAMINA_LEGACY_VERSION,
  SEASON_STAMINA_VERSION,
  SEASON_STANDINGS_VERSION,
  SEASON_TEAM_COUNT,
  SEASON_TIEBREAK_VERSION,
  SEASON_TRADE_GRADE_VERSION,
  SEASON_TRADE_TARGETS_VERSION,
  SEASON_TRADE_VERSION,
} from './season-versions.ts';
import { seasonRosterSchema, seasonOwnershipSchema } from './season-roster.ts';
import { seasonFreeAgencyStateSchema } from './season-free-agency.ts';
import {
  seasonAiAssignmentSchema,
  seasonAiPoolSchema,
  seasonGenerationDiagnosticsSchema,
  seasonRosterEvaluationSchema,
} from './season-ai.ts';
import { seasonRotationSchema } from './season-rotation.ts';

export {
  seasonRosterEntrySchema,
  seasonRosterSchema,
  seasonOwnershipSchema,
} from './season-roster.ts';
export type { SeasonRosterEntry, SeasonRoster, SeasonOwnership } from './season-roster.ts';

export const seasonRunStageSchema = z.enum(['regular-season', 'play-in', 'playoffs', 'completed']);
export type SeasonRunStage = z.infer<typeof seasonRunStageSchema>;

export const seasonRunCompletionSchema = z.object({
  championFranchiseId: franchiseIdSchema,
  almanacDigest: seasonCheckpointDigestSchema,
  finalizedAtStateRevision: z.number().int().nonnegative(),
});
export type SeasonRunCompletion = z.infer<typeof seasonRunCompletionSchema>;

export const seasonLegacyDraftFactsSchema = z.object({
  draftVersion: z.literal(SEASON_DRAFT_LEGACY_VERSION),
  participants: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: franchiseIdSchema,

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

export const seasonGlobalDraftFactsSchema = z.object({
  draftVersion: z.literal(SEASON_DRAFT_VERSION),
  participants: z.array(
    z.object({
      participantId: z.string().min(1).max(64),
      franchiseId: franchiseIdSchema,

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

export const seasonDraftFactsSchema = z.discriminatedUnion('draftVersion', [
  seasonGlobalDraftFactsSchema,
  seasonLegacyDraftFactsSchema,
]);
export type SeasonDraftFacts = z.infer<typeof seasonDraftFactsSchema>;

export const seasonGenerationAuditSchema = z.object({
  seed: seedSchema,
  aiVersion: z.union([z.literal(SEASON_AI_V2), z.literal(SEASON_AI_VERSION)]),
  rosterGenerationVersion: z.union([
    z.literal(SEASON_ROSTER_GENERATION_V2),
    z.literal(SEASON_ROSTER_GENERATION_VERSION),
  ]),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),

  minutePolicyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),
  rosterTargetsVersion: z.union([
    z.literal(SEASON_ROSTER_TARGETS_V2),
    z.literal(SEASON_ROSTER_TARGETS_VERSION),
  ]),

  digest: seasonCheckpointDigestSchema,
  diagnostics: seasonGenerationDiagnosticsSchema,
});
export type SeasonGenerationAudit = z.infer<typeof seasonGenerationAuditSchema>;

export const seasonScheduleReferenceSchema = z.object({
  leagueVersion: z.literal(SEASON_LEAGUE_VERSION),
  scheduleVersion: z.literal(SEASON_SCHEDULE_VERSION),
  formulaVersion: z.literal(SEASON_SCHEDULE_FORMULA_VERSION),
  generationSeed: seedSchema,

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

  draftVersion: z.union([z.literal(SEASON_DRAFT_VERSION), z.literal(SEASON_DRAFT_LEGACY_VERSION)]),
  rosterRulesVersion: z.literal(SEASON_ROSTER_RULES_VERSION),
  rosterGenerationVersion: z.union([
    z.literal(SEASON_ROSTER_GENERATION_V2),
    z.literal(SEASON_ROSTER_GENERATION_VERSION),
  ]),
  aiVersion: z.union([z.literal(SEASON_AI_V2), z.literal(SEASON_AI_VERSION)]),
  rotationVersion: z.literal(SEASON_ROTATION_VERSION),

  minutePolicyVersion: z.literal(SEASON_MINUTE_POLICY_VERSION),

  rotationPlannerVersion: z.literal(SEASON_ROTATION_PLANNER_VERSION),

  gameVersion: z.literal(SEASON_GAME_VERSION),

  gameTargetsVersion: z.literal(SEASON_GAME_TARGETS_VERSION),
  rosterTargetsVersion: z.union([
    z.literal(SEASON_ROSTER_TARGETS_V2),
    z.literal(SEASON_ROSTER_TARGETS_VERSION),
  ]),

  blockVersion: z.literal(SEASON_BLOCK_VERSION),
  summaryVersion: z.literal(SEASON_GAME_SUMMARY_VERSION),
  aggregatesVersion: z.literal(SEASON_AGGREGATES_VERSION),
  recapVersion: z.literal(SEASON_RECAP_VERSION),
  leadersVersion: z.literal(SEASON_LEADERS_VERSION),

  homeCourtVersion: z.literal(SEASON_HOME_COURT_VERSION),

  checkpointVersion: z.literal(SEASON_CHECKPOINT_VERSION),

  staminaVersion: z.union([
    z.literal(SEASON_STAMINA_VERSION),
    z.literal(SEASON_STAMINA_LEGACY_VERSION),
  ]),

  chemistryVersion: z.literal(SEASON_CHEMISTRY_VERSION),

  effectsTargetsVersion: z.union([
    z.literal(SEASON_EFFECT_TARGETS_VERSION),
    z.literal(SEASON_EFFECT_TARGETS_LEGACY_VERSION),
  ]),

  healthVersion: z.literal(SEASON_HEALTH_VERSION),

  tradeVersion: z.literal(SEASON_TRADE_VERSION),

  influenceVersion: z.literal(SEASON_INFLUENCE_VERSION),

  objectiveVersion: z.literal(SEASON_OBJECTIVE_VERSION),

  campaignVersion: z.literal(SEASON_CAMPAIGN_VERSION).optional(),
  campaignTargetsVersion: z.literal(SEASON_CAMPAIGN_TARGETS_VERSION).optional(),

  injuryTargetsVersion: z.literal(SEASON_INJURY_TARGETS_VERSION),

  tradeTargetsVersion: z.literal(SEASON_TRADE_TARGETS_VERSION),

  influenceTargetsVersion: z.literal(SEASON_INFLUENCE_TARGETS_VERSION),

  tiebreakVersion: z.literal(SEASON_TIEBREAK_VERSION),

  postseasonSummaryVersion: z.literal(SEASON_POSTSEASON_SUMMARY_VERSION),

  awardsVersion: z.literal(SEASON_AWARDS_VERSION),

  tradeGradeVersion: z.literal(SEASON_TRADE_GRADE_VERSION),

  commandLogVersion: z.literal(SEASON_COMMAND_LOG_VERSION),

  almanacVersion: z.literal(SEASON_ALMANAC_VERSION),

  replayExportVersion: z.literal(SEASON_REPLAY_EXPORT_VERSION),

  postseasonTargetsVersion: z.literal(SEASON_POSTSEASON_TARGETS_VERSION),

  freeAgencyVersion: z.literal(SEASON_FREE_AGENCY_VERSION),

  freeAgencyIndexVersion: z.literal(SEASON_FREE_AGENCY_INDEX_VERSION),

  freeAgencyTargetsVersion: z.literal(SEASON_FREE_AGENCY_TARGETS_VERSION),
});
export type SeasonRunVersions = z.infer<typeof seasonRunVersionsSchema>;

export const seasonRunSchema = z
  .object({
    schemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
    runId: idSchema,
    rootSeed: seedSchema,
    versions: seasonRunVersionsSchema,
    league: seasonLeagueSchema,

    rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),

    ownership: z
      .array(seasonOwnershipSchema)
      .min(SEASON_TEAM_COUNT * SEASON_DRAFT_SIZE)
      .max(SEASON_TEAM_COUNT * 15),
    schedule: seasonScheduleReferenceSchema,

    games: z.array(seasonGameSchema).length(SEASON_GAME_COUNT),
    standings: seasonStandingsSchema,
    cursor: seasonCursorSchema,

    stage: seasonRunStageSchema,

    postseason: seasonPostseasonStateSchema,

    awards: seasonAwardsSchema.nullable(),

    completion: seasonRunCompletionSchema.nullable(),

    draft: seasonDraftFactsSchema,

    aiAssignments: z.array(seasonAiAssignmentSchema).length(SEASON_TEAM_COUNT),

    aiPools: z.array(seasonAiPoolSchema).min(28).max(29),

    rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),

    generationAudit: seasonGenerationAuditSchema,

    evaluations: z.array(seasonRosterEvaluationSchema).length(SEASON_TEAM_COUNT),

    trade: seasonTradeStateSchema.nullable(),

    freeAgency: seasonFreeAgencyStateSchema,

    objectives: seasonObjectiveStateSchema,
    campaign: seasonCampaignStateSchema.optional(),

    health: seasonHealthStateSchema,

    transactions: z.array(seasonTransactionEntrySchema),

    influence: seasonInfluenceStateSchema,

    checkpointState: seasonCheckpointStateSchema.nullable(),

    stateRevision: z.number().int().nonnegative(),

    stateDigest: seasonCheckpointDigestSchema,
  })
  .superRefine((run, ctx) => {
    if (run.stage === 'completed') {
      if (run.completion === null) {
        ctx.addIssue({ code: 'custom', message: 'a completed run must carry completion state' });
      }
      if (run.postseason.championFranchiseId === null) {
        ctx.addIssue({ code: 'custom', message: 'a completed run must carry a champion' });
      }
    } else if (run.completion !== null) {
      ctx.addIssue({
        code: 'custom',
        message: `an active ${run.stage} run must not carry completion state`,
      });
    }
    if (run.completion !== null) {
      if (run.completion.championFranchiseId !== run.postseason.championFranchiseId) {
        ctx.addIssue({
          code: 'custom',
          message: 'completion champion must match the postseason champion',
        });
      }
    }

    if (run.awards !== null && (run.stage === 'regular-season' || run.stage === 'play-in')) {
      ctx.addIssue({
        code: 'custom',
        message: `awards cannot exist before the playoffs (run stage: ${run.stage})`,
      });
    }
  });
export type SeasonRun = z.infer<typeof seasonRunSchema>;

export const seasonBlockRunContextSchema = z.object({
  schemaVersion: z.literal(SEASON_RUN_SCHEMA_VERSION),
  runId: idSchema,
  rootSeed: seedSchema,
  versions: seasonRunVersionsSchema,
  league: seasonLeagueSchema,
  rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),
  rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
  cursor: seasonCursorSchema,
});
export type SeasonBlockRunContext = z.infer<typeof seasonBlockRunContextSchema>;
