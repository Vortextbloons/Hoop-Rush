import { z } from 'zod';
import {
  CAP_RUSH_GAME_COUNT,
  CAP_RUSH_SAVE_SCHEMA_VERSION,
  capRushCommandResultSchema,
  capRushCommandSchema,
  capRushDraftStateSchema,
  capRushDigestSchema,
  capRushHistoryEntrySchema,
  capRushReportSchema,
  capRushStoredGameSchema,
  commandIdSchema,
  idSchema,
} from '@hoop-rush/data-contracts';

export const CAP_RUSH_ACTIVE_DRAFT_RECORD_ID = 'cap-rush-draft';
const isoDateSchema = z.iso.datetime();

export const storedCapRushDraftRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    recordId: z.literal(CAP_RUSH_ACTIVE_DRAFT_RECORD_ID),
    runId: idSchema,
    revision: z.number().int().nonnegative(),
    stateDigest: capRushDigestSchema,
    draft: capRushDraftStateSchema,
    createdAtIso: isoDateSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.draft.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored draft run id does not match its row' });
    }
    if (row.draft.revision !== row.revision) {
      ctx.addIssue({ code: 'custom', message: 'stored draft revision does not match its row' });
    }
  });
export type StoredCapRushDraftRow = z.infer<typeof storedCapRushDraftRowSchema>;

export const storedCapRushCommandRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    commandId: commandIdSchema,
    runId: idSchema,
    command: capRushCommandSchema,
    result: capRushCommandResultSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.command.commandId !== row.commandId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its command id' });
    }
    if (row.command.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored command does not match its run id' });
    }
    if (row.result.commandId !== row.commandId || row.result.runId !== row.runId) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored result does not match its command envelope',
      });
    }
  });
export type StoredCapRushCommandRow = z.infer<typeof storedCapRushCommandRowSchema>;

export const storedCapRushGameRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    gameNumber: z.number().int().min(1).max(CAP_RUSH_GAME_COUNT),
    game: capRushStoredGameSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    const { game, gameNumber } = row;
    if (game.gameNumber !== gameNumber || game.summary.gameNumber !== gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored game number does not match its row' });
    }
    if (game.result.gameNumber !== gameNumber) {
      ctx.addIssue({ code: 'custom', message: 'stored game result number does not match its row' });
    }
    if (game.result.inputDigest !== game.summary.inputDigest) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored game result digest does not match its summary',
      });
    }
    const humanHome = game.summary.humanHome;
    if ((game.result.humanSide === 'home') !== humanHome) {
      ctx.addIssue({
        code: 'custom',
        message: 'stored game human side does not match its summary',
      });
    }
    const humanPoints = humanHome ? game.result.home.points : game.result.away.points;
    const opponentPoints = humanHome ? game.result.away.points : game.result.home.points;
    if (
      humanPoints !== game.summary.humanPoints ||
      opponentPoints !== game.summary.opponentPoints
    ) {
      ctx.addIssue({ code: 'custom', message: 'stored game scoreline does not match its summary' });
    }
  });
export type StoredCapRushGameRow = z.infer<typeof storedCapRushGameRowSchema>;

export const storedCapRushHistoryRowSchema = capRushHistoryEntrySchema
  .safeExtend({ saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION) })
  .superRefine((row, ctx) => {
    if (row.wins + row.losses > CAP_RUSH_GAME_COUNT) {
      ctx.addIssue({ code: 'custom', message: 'stored history wins and losses exceed a season' });
    }
  });
export type StoredCapRushHistoryRow = z.infer<typeof storedCapRushHistoryRowSchema>;

export const storedCapRushReportRowSchema = z
  .object({
    saveSchemaVersion: z.literal(CAP_RUSH_SAVE_SCHEMA_VERSION),
    runId: idSchema,
    report: capRushReportSchema,
    updatedAtIso: isoDateSchema,
  })
  .superRefine((row, ctx) => {
    if (row.report.runId !== row.runId) {
      ctx.addIssue({ code: 'custom', message: 'stored report belongs to another run' });
    }
  });
export type StoredCapRushReportRow = z.infer<typeof storedCapRushReportRowSchema>;
