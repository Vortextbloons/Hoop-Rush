import { z } from 'zod';
import {
  franchiseIdSchema,
  postseasonGameIdSchema,
  seasonAcceptedBlockSchema,
  seasonActiveRunIndexSchema,
  seasonAlmanacSchema,
  seasonBlockRecapSchema,
  seasonCheckpointDigestSchema,
  seasonCheckpointStateSchema,
  seasonCommandLogEntrySchema,
  seasonCommandLogSchema,
  seasonCompactInjuryEventSchema,
  seasonEffectsStateSchema,
  seasonFreeAgencyStateSchema,
  seasonGameSimulationResultSchema,
  seasonGameSummarySchema,
  seasonHealthStateSchema,
  seasonInfluenceStateSchema,
  seasonInvalidRosterInterruptionSchema,
  seasonObjectiveStateSchema,
  seasonPendingBlockCandidateSchema,
  seasonPlayerAggregateSchema,
  seasonPostseasonPhaseSchema,
  seasonPostseasonSummarySchema,
  seasonRetainedGameDetailSchema,
  seasonRosterSchema,
  seasonRotationSchema,
  seasonRotationSetDigestSchema,
  seasonRunCompletionSchema,
  seasonRunSchema,
  seasonRunStageSchema,
  seasonStandingsSchema,
  seasonTeamAggregateSchema,
  seasonTradeStateSchema,
  seasonTransactionEntrySchema,
  seasonOwnershipSchema,
  seasonAwardsSchema,
  seasonPostseasonStateSchema,
  SEASON_ROSTER_MAX_SIZE,
  SEASON_ROSTER_MIN_SIZE,
  SEASON_RUN_SAVE_SCHEMA_VERSION,
  SEASON_TEAM_COUNT,
} from '@hoop-rush/data-contracts';

export const SEASON_RUN_RECORD_ID = 'season-run';

export const seasonRunRecordFieldsSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  saveSchemaVersion: z.literal(SEASON_RUN_SAVE_SCHEMA_VERSION),

  run: z.object(seasonRunSchema.shape).omit({ games: true }),

  completedRounds: z.number().int().min(0).max(82),

  revision: z.number().int().nonnegative(),

  lastCommandId: z.string().min(1).max(64).nullable(),

  lastRotationDigest: seasonRotationSetDigestSchema.nullable(),

  lastCheckpointDigest: seasonCheckpointDigestSchema.nullable(),

  standings: seasonStandingsSchema,

  teamAggregates: z.array(seasonTeamAggregateSchema).length(SEASON_TEAM_COUNT),

  playerAggregates: z
    .array(seasonPlayerAggregateSchema)
    .min(SEASON_TEAM_COUNT * SEASON_ROSTER_MIN_SIZE)
    .max(SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE),

  recap: seasonBlockRecapSchema.nullable(),

  effects: seasonEffectsStateSchema,

  health: seasonHealthStateSchema,

  transactions: z.array(seasonTransactionEntrySchema),

  influence: seasonInfluenceStateSchema,

  trade: seasonTradeStateSchema.nullable(),

  objectives: seasonObjectiveStateSchema,

  checkpointState: seasonCheckpointStateSchema.nullable(),

  stateRevision: z.number().int().nonnegative(),

  stateDigest: seasonCheckpointDigestSchema,

  updatedAtIso: z.iso.datetime().optional(),
});

export const storedSeasonRunRecordSchema = seasonRunRecordFieldsSchema;
export type StoredSeasonRunRecord = z.infer<typeof storedSeasonRunRecordSchema>;

export const seasonRunCursorSchema = z.object({
  run: z.object({
    runId: z.string().min(1).max(64),
    league: z.object({
      teams: z.array(
        z.object({
          franchiseId: z.string().min(1).max(64),
          control: z.enum(['human', 'ai']),
        }),
      ),
    }),

    rosters: z.array(z.unknown()).optional(),
    ownership: z.array(z.unknown()).optional(),
    rotations: z.array(z.unknown()).optional(),
  }),
  completedRounds: z.number().int().min(0).max(82),
  revision: z.number().int().nonnegative(),
  lastCommandId: z.string().min(1).max(64).nullable(),

  health: seasonHealthStateSchema,
  transactions: z.array(seasonTransactionEntrySchema),
  influence: seasonInfluenceStateSchema,
  trade: seasonTradeStateSchema.nullable(),
  objectives: seasonObjectiveStateSchema,
  checkpointState: seasonCheckpointStateSchema.nullable(),
  stateRevision: z.number().int().nonnegative(),
  stateDigest: seasonCheckpointDigestSchema,
});
export type SeasonRunCursor = z.infer<typeof seasonRunCursorSchema>;

export const seasonRunCheckpointDeltaSchema = seasonRunRecordFieldsSchema
  .pick({
    completedRounds: true,
    revision: true,
    lastCommandId: true,
    lastRotationDigest: true,
    lastCheckpointDigest: true,
    standings: true,
    teamAggregates: true,
    playerAggregates: true,
    recap: true,
    health: true,
    transactions: true,
    influence: true,
    trade: true,
    objectives: true,
    checkpointState: true,
    stateRevision: true,
    stateDigest: true,
    updatedAtIso: true,
  })
  .extend({
    run: z.object({
      rosters: z.array(seasonRosterSchema).length(SEASON_TEAM_COUNT),
      ownership: z
        .array(seasonOwnershipSchema)
        .min(SEASON_TEAM_COUNT * SEASON_ROSTER_MIN_SIZE)
        .max(SEASON_TEAM_COUNT * SEASON_ROSTER_MAX_SIZE),
      rotations: z.array(seasonRotationSchema).length(SEASON_TEAM_COUNT),
      stage: seasonRunStageSchema.optional(),
      postseason: seasonPostseasonStateSchema.optional(),
      awards: seasonAwardsSchema.nullable().optional(),
      completion: seasonRunCompletionSchema.nullable().optional(),
      freeAgency: seasonFreeAgencyStateSchema,
    }),

    effects: seasonEffectsStateSchema,
  });
export type SeasonRunCheckpointDelta = z.infer<typeof seasonRunCheckpointDeltaSchema>;

export const storedSeasonSummaryRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameId: z.string().regex(/^s[0-9]{6}$/),

  blockIndex: z.number().int().min(0).max(8),

  round: z.number().int().min(1).max(82),

  summary: seasonGameSummarySchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonSummaryRow = z.infer<typeof storedSeasonSummaryRowSchema>;

export const storedSeasonDetailRowSchema = z.object({
  runId: z.string().min(1).max(64),
  gameId: z.string().regex(/^s[0-9]{6}$/),

  round: z.number().int().min(1).max(82),

  detail: seasonRetainedGameDetailSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonDetailRow = z.infer<typeof storedSeasonDetailRowSchema>;

export const storedSeasonAcceptedBlockRowSchema = z.object({
  runId: z.string().min(1).max(64),

  blockIndex: z.number().int().min(0).max(8),

  block: seasonAcceptedBlockSchema,
  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonAcceptedBlockRow = z.infer<typeof storedSeasonAcceptedBlockRowSchema>;

export const storedSeasonActiveRunIndexSchema = z.object({
  recordId: z.literal(SEASON_RUN_RECORD_ID),
  index: seasonActiveRunIndexSchema,
});
export type StoredSeasonActiveRunIndex = z.infer<typeof storedSeasonActiveRunIndexSchema>;

export const storedSeasonPendingBlockRowSchema = z.object({
  runId: z.string().min(1).max(64),

  block: seasonPendingBlockCandidateSchema,

  interruption: seasonInvalidRosterInterruptionSchema,

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPendingBlockRow = z.infer<typeof storedSeasonPendingBlockRowSchema>;

export const storedSeasonPostseasonSummaryRowSchema = z.object({
  runId: z.string().min(1).max(64),

  gameId: z.string().min(1).max(64),

  phase: z.enum(['play-in', 'playoffs']),

  summary: seasonPostseasonSummarySchema,

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPostseasonSummaryRow = z.infer<
  typeof storedSeasonPostseasonSummaryRowSchema
>;

export const seasonPostseasonDetailSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().min(1).max(64),

  gameId: postseasonGameIdSchema,

  phase: seasonPostseasonPhaseSchema,
  homeFranchiseId: franchiseIdSchema,
  awayFranchiseId: franchiseIdSchema,

  result: seasonGameSimulationResultSchema,

  injuryEvents: z.array(seasonCompactInjuryEventSchema),
});
export type SeasonPostseasonDetail = z.infer<typeof seasonPostseasonDetailSchema>;

export const storedSeasonPostseasonDetailRowSchema = z.object({
  runId: z.string().min(1).max(64),

  gameId: z.string().min(1).max(64),

  phase: z.enum(['play-in', 'playoffs']),

  detail: seasonPostseasonDetailSchema,

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPostseasonDetailRow = z.infer<typeof storedSeasonPostseasonDetailRowSchema>;

export const storedSeasonCommandLogRowSchema = z.object({
  runId: z.string().min(1).max(64),

  ordinal: z.number().int().nonnegative(),

  entry: seasonCommandLogEntrySchema,

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonCommandLogRow = z.infer<typeof storedSeasonCommandLogRowSchema>;

export const storedSeasonAlmanacRowSchema = z.object({
  runId: z.string().min(1).max(64),

  almanac: seasonAlmanacSchema,

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonAlmanacRow = z.infer<typeof storedSeasonAlmanacRowSchema>;

export const storedSeasonCompletedRunRowSchema = z.object({
  runId: z.string().min(1).max(64),

  run: z.object(seasonRunSchema.shape).omit({ games: true }),

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonCompletedRunRow = z.infer<typeof storedSeasonCompletedRunRowSchema>;

export const storedSeasonCompletedIndexSchema = z.object({
  recordId: z.string().min(1).max(64),
  runId: z.string().min(1).max(64),
  rootSeed: z.string().regex(/^[0-9a-f]{16,64}$/),
  humanFranchiseId: z.string().min(1).max(64),
  championFranchiseId: z.string().min(1).max(64),

  almanacDigest: seasonCheckpointDigestSchema,

  commandLogDigest: seasonCheckpointDigestSchema,

  completedAtIso: z.iso.datetime(),
});
export type StoredSeasonCompletedIndex = z.infer<typeof storedSeasonCompletedIndexSchema>;

export type SeasonCompletedRunIndexEntry = StoredSeasonCompletedIndex;

export const seasonCompletedSeasonSchema = z.object({
  run: seasonRunSchema,
  almanac: seasonAlmanacSchema,
  commandLog: seasonCommandLogSchema,
  summaries: z.array(seasonGameSummarySchema),
  postseasonSummaries: z.array(seasonPostseasonSummarySchema),
});
export type SeasonCompletedSeason = z.infer<typeof seasonCompletedSeasonSchema>;

export const seasonRunPlayerSliceEntrySchema = z.object({
  playerVersionId: z.string().min(1).max(64),

  playerId: z.string().min(1).max(64),
  franchiseId: z.string().min(1).max(64),
  eraId: z.string().min(1).max(64),
  seasonKey: z.string().min(1).max(64),
  displayName: z.string().min(1).max(128),

  positionsPlayable: z.array(z.string().min(1).max(2)).min(1).max(5),

  summaryRatings: z.object({
    overallRating: z.number().int().min(0).max(100),
    offenseRating: z.number().int().min(0).max(100),
    defenseRating: z.number().int().min(0).max(100),
  }),

  staminaRating: z.number().int().min(0).max(100),

  durabilityRating: z.number().int().min(0).max(100),
});
export type SeasonRunPlayerSliceEntry = z.infer<typeof seasonRunPlayerSliceEntrySchema>;

export const storedSeasonPlayerSliceRowSchema = z.object({
  runId: z.string().min(1).max(64),

  players: z.array(seasonRunPlayerSliceEntrySchema).min(1),

  updatedAtIso: z.iso.datetime().optional(),
});
export type StoredSeasonPlayerSliceRow = z.infer<typeof storedSeasonPlayerSliceRowSchema>;
