import { z } from 'zod';
import {
  HAVOC_GAME_COUNT,
  HAVOC_SAVE_SCHEMA_VERSION,
  commandIdSchema,
  havocCommandResultSchema,
  havocCommandSchema,
  havocComparisonSchema,
  havocComparisonStatusSchema,
  havocCompletionStateSchema,
  havocDigestSchema,
  havocGameResultSchema,
  havocGameTapeSchema,
  havocReportSchema,
  havocRunStateSchema,
  havocVariantSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const HAVOC_ACTIVE_RECORD_ID = 'active';

export const havocDigestTextSchema = z.string().min(1).max(64);
const isoDateSchema = z.iso.datetime();

export const storedHavocActiveRunSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
    recordId: z.literal(HAVOC_ACTIVE_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: havocDigestSchema,
    state: havocRunStateSchema,
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.state.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored active run id does not match its state' });
    }
    if (row.state.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored active revision does not match its state' });
    }
  });
export type StoredHavocActiveRun = z.infer<typeof storedHavocActiveRunSchema>;

export const storedHavocCommandRowSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
    commandId: commandIdSchema,
    runId: idSchema,
    command: havocCommandSchema.nullable(),
    result: havocCommandResultSchema,
    outcomeDigest: havocDigestSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.result.commandId !== row.commandId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored command result does not match its command id',
      });
    }
    if (row.result.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored command result does not match its run id' });
    }
    if (
      row.command !== null &&
      (row.command.commandId !== row.commandId || row.command.runId !== row.runId)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored command payload does not match its envelope',
      });
    }
  });
export type StoredHavocCommandRow = z.infer<typeof storedHavocCommandRowSchema>;

export const storedHavocGameRowSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    variant: havocVariantSchema,
    gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
    result: havocGameResultSchema,
    inputDigest: havocDigestTextSchema,
    resultDigest: havocDigestTextSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.result.gameNumber !== row.gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored game result number does not match its row' });
    }
    if (row.result.variant !== row.variant) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored game result variant does not match its row',
      });
    }
  });
export type StoredHavocGameRow = z.infer<typeof storedHavocGameRowSchema>;

export const storedHavocRetainedTapeSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    gameNumber: z.number().int().min(1).max(HAVOC_GAME_COUNT),
    tape: havocGameTapeSchema,
    tapeDigest: havocDigestTextSchema,
    selectedRank: z.number().int().nonnegative().nullable(),
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.tape.gameNumber !== row.gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored tape number does not match its row' });
    }
  });
export type StoredHavocRetainedTape = z.infer<typeof storedHavocRetainedTapeSchema>;

export const storedHavocCompletedRunSchema = z
  .object({
    saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    state: havocRunStateSchema,
    comparison: havocComparisonSchema.nullable(),
    report: havocReportSchema.nullable(),
    createdAtIso: isoDateSchema,
    archivedAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.state.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored completed run id does not match its state' });
    }
    if (row.comparison !== null && row.comparison.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored comparison belongs to another run' });
    }
    if (row.report !== null && row.report.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored report belongs to another run' });
    }
  });
export type StoredHavocCompletedRun = z.infer<typeof storedHavocCompletedRunSchema>;

export const havocHistoryCompletionStateSchema = havocCompletionStateSchema.exclude(['draft']);
export type HavocHistoryCompletionState = z.infer<typeof havocHistoryCompletionStateSchema>;

export const storedHavocHistoryRowSchema = z.object({
  saveSchemaVersion: z.literal(HAVOC_SAVE_SCHEMA_VERSION),
  runId: idSchema,
  createdAtIso: isoDateSchema,
  updatedAtIso: isoDateSchema,
  havocWins: z.number().int().min(0).max(HAVOC_GAME_COUNT),
  havocLosses: z.number().int().min(0).max(HAVOC_GAME_COUNT),
  perfectSeason: z.boolean(),
  comparisonStatus: havocComparisonStatusSchema,
  completionState: havocHistoryCompletionStateSchema,
});
export type StoredHavocHistoryRow = z.infer<typeof storedHavocHistoryRowSchema>;
